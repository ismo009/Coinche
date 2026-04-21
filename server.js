const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const { CoincheGame, POSITIONS, getTeam } = require('./game');
const botLogic = require('./ai/coinche-bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Stockage des parties en cours
const games = new Map();
const PUBLIC_ROOM_PREFIX = 'PUB-';
const PUBLIC_INACTIVE_MS = 5 * 60 * 1000;
const PUBLIC_CLEANUP_INTERVAL_MS = 30 * 1000;

const ROOM_NAME_NOUNS = [
  'Table', 'Salon', 'Atout', 'Belote', 'Coinche', 'Pli', 'Trèfle', 'Carreau', 'Pique', 'Cœur'
];

const ROOM_NAME_ADJECTIVES = [
  'Azur', 'Émeraude', 'Saphir', 'Rubis', 'Ivoire', 'Velours', 'Lumière', 'Brume', 'Nova', 'Orage'
];

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}

function sanitizeRoomName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/\s+/g, ' ').trim().slice(0, 28);
}

function generateRoomName() {
  const noun = ROOM_NAME_NOUNS[Math.floor(Math.random() * ROOM_NAME_NOUNS.length)];
  const adjective = ROOM_NAME_ADJECTIVES[Math.floor(Math.random() * ROOM_NAME_ADJECTIVES.length)];
  const suffix = Math.floor(Math.random() * 90) + 10;
  return `${noun} ${adjective} ${suffix}`;
}

function broadcastGameState(roomId) {
  const game = games.get(roomId);
  if (!game) return;

  for (const pos of POSITIONS) {
    if (game.players[pos]) {
      const playerState = game.getStateForPlayer(pos);
      io.to(game.players[pos].id).emit('game-state', playerState);
    }
  }
}

function broadcastMessage(roomId, message, type = 'info') {
  io.to(roomId).emit('message', { text: message, type });
}

function getAvailablePositions(game) {
  return POSITIONS.filter(pos => !game.players[pos]);
}

function isBotPlayer(player) {
  return !!player && player.isBot === true;
}

function isRoomOwner(game, socketId) {
  // Owner is the first human who created the room.
  return !!game && typeof game.ownerId === 'string' && game.ownerId === socketId;
}

function maybeProcessBotTurn(roomId) {
  const game = games.get(roomId);
  if (!game) return;

  const currentPos = game.currentPlayer;
  if (!currentPos) return;
  const player = game.players[currentPos];
  if (!isBotPlayer(player)) return;

  // Small delay to keep UX smooth and avoid tight recursion.
  setTimeout(() => {
    const latest = games.get(roomId);
    if (!latest) return;

    const pos = latest.currentPlayer;
    const p = latest.players[pos];
    if (!isBotPlayer(p)) return;

    if (latest.state === 'bidding') {
      const bid = botLogic.chooseBid(latest);
      const result = latest.placeBid(pos, bid);
      if (result?.success) {
        const botName = p.name || 'IA';
        if (bid.type === 'coinche') {
          broadcastMessage(roomId, `${botName} COINCHE !`, 'warning');
        } else if (bid.type === 'surcoinche') {
          broadcastMessage(roomId, `${botName} SURCOINCHE !`, 'danger');
        }

        if (result.action === 'redistribute') {
          broadcastMessage(roomId, 'Tout le monde passe. Redistribution des cartes.', 'info');
          latest.startNewRound();
        }

        broadcastGameState(roomId);
        touchRoom(roomId);
        maybeProcessBotTurn(roomId);
      }
      return;
    }

    if (latest.state === 'playing') {
      const card = botLogic.chooseCard(latest, pos);
      if (!card) return;

      const result = latest.playCard(pos, card);
      if (!result?.success) return;

      const botName = p.name || 'IA';

      if (result.beloteAnnounce) {
        broadcastMessage(roomId, `${botName}: ${result.beloteAnnounce} !`, 'success');
      }

      if (result.action === 'round_end' || result.action === 'game_over') {
        const rr = result.roundResult;
        let msg = rr.contractMet ? '✓ Contrat réussi !' : '✗ Contrat chuté !';
        msg += ` | NS: +${rr.scoreNS} | EO: +${rr.scoreEO}`;
        broadcastMessage(roomId, msg, rr.contractMet ? 'success' : 'danger');

        if (result.action === 'game_over') {
          const teamNames = { ns: 'Nord-Sud', eo: 'Est-Ouest' };
          const winnerTeam = teamNames[result.winner];
          broadcastMessage(roomId, `🏆 ${winnerTeam} remporte la partie !`, 'success');
        }
      }

      broadcastGameState(roomId);
      touchRoom(roomId);
      maybeProcessBotTurn(roomId);
    }
  }, 450);
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function findOpenPublicRoom() {
  for (const [roomId, game] of games.entries()) {
    if (!game.isPublic) continue;
    if (game.state !== 'waiting') continue;
    if (game.isFull()) continue;
    return { roomId, game };
  }
  return null;
}

function createPublicRoom() {
  const roomId = `${PUBLIC_ROOM_PREFIX}${generateRoomCode()}`;
  const game = new CoincheGame(roomId);
  game.isPublic = true;
  game.roomName = generateRoomName();
  game.createdAt = Date.now();
  game.lastActivityAt = Date.now();
  games.set(roomId, game);
  return { roomId, game };
}

function touchRoom(roomId) {
  const game = games.get(roomId);
  if (game && game.isPublic) {
    game.lastActivityAt = Date.now();
  }
}

function getPublicRoomList() {
  const rooms = [];
  const now = Date.now();

  for (const [roomId, game] of games.entries()) {
    if (!game.isPublic) continue;
    if (game.state !== 'waiting') continue;
    if (game.isFull()) continue;

    const playerCount = POSITIONS.filter(pos => !!game.players[pos]).length;
    rooms.push({
      roomId,
      roomName: game.roomName || roomId.replace(PUBLIC_ROOM_PREFIX, ''),
      playerCount,
      freeSeats: 4 - playerCount,
      idleSeconds: Math.max(0, Math.floor((now - (game.lastActivityAt || now)) / 1000))
    });
  }

  return rooms;
}

io.on('connection', (socket) => {
  console.log(`Joueur connecté: ${socket.id}`);

  let currentRoom = null;
  let playerName = null;

  socket.on('create-room', (data) => {
    const roomId = generateRoomCode();
    const game = new CoincheGame(roomId);
    games.set(roomId, game);

    playerName = (data.name || 'Joueur').slice(0, 20);
    const position = data.position || 'sud';

    if (!game.addPlayer(socket.id, playerName, position)) {
      socket.emit('error-msg', { message: 'Position déjà prise' });
      return;
    }

    // Owner = creator (first human).
    game.ownerId = socket.id;

    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-created', { roomId, position, isPublic: false, displayCode: roomId });
    broadcastGameState(roomId);
    broadcastMessage(roomId, `${playerName} a créé la salle (${position})`);
    touchRoom(roomId);
  });

  socket.on('join-room', (data) => {
    const roomId = (data.roomId || '').toUpperCase().trim();
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error-msg', { message: 'Salle introuvable' });
      return;
    }

    if (game.isFull()) {
      socket.emit('error-msg', { message: 'La salle est pleine' });
      return;
    }

    playerName = (data.name || 'Joueur').slice(0, 20);
    const position = data.position;

    if (!position || !POSITIONS.includes(position)) {
      socket.emit('error-msg', { message: 'Position invalide' });
      return;
    }

    if (!game.addPlayer(socket.id, playerName, position)) {
      socket.emit('error-msg', { message: 'Position déjà prise' });
      return;
    }

    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-joined', { roomId, position, isPublic: false, displayCode: roomId });
    broadcastGameState(roomId);
    broadcastMessage(roomId, `${playerName} a rejoint la salle (${position})`);
    touchRoom(roomId);

    // Démarrer si 4 joueurs
    if (game.isFull() && game.state === 'waiting') {
      game.startNewRound();
      broadcastGameState(roomId);
      broadcastMessage(roomId, 'La partie commence ! Phase d\'enchères.', 'success');
      maybeProcessBotTurn(roomId);
    }
  });

  function startIfRoomReady(roomId, game) {
    if (game.isFull() && game.state === 'waiting') {
      game.startNewRound();
      broadcastGameState(roomId);
      broadcastMessage(roomId, 'La partie commence ! Phase d\'enchères.', 'success');
      touchRoom(roomId);
    }
  }

  function addSocketToPublicRoom({ createIfMissing, preferredRoomId = null, createdByPlayer = false }) {
    if (currentRoom) return;

    let room = null;

    if (preferredRoomId) {
      const preferredGame = games.get(preferredRoomId);
      if (!preferredGame || !preferredGame.isPublic || preferredGame.state !== 'waiting' || preferredGame.isFull()) {
        socket.emit('error-msg', { message: 'Cette salle publique n\'est plus disponible.' });
        return;
      }
      room = { roomId: preferredRoomId, game: preferredGame };
    } else {
      room = findOpenPublicRoom();
    }

    if (!room && createIfMissing) {
      room = createPublicRoom();
    }

    if (!room) {
      socket.emit('error-msg', { message: 'Aucune salle publique disponible. Créez-en une.' });
      return;
    }

    const { roomId, game } = room;
    const availablePositions = getAvailablePositions(game);
    const position = pickRandom(availablePositions);

    if (!position) {
      socket.emit('error-msg', { message: 'Aucune place disponible, réessaie.' });
      return;
    }

    if (!game.addPlayer(socket.id, playerName, position)) {
      socket.emit('error-msg', { message: 'Impossible de rejoindre la salle publique.' });
      return;
    }

    currentRoom = roomId;
    socket.join(roomId);

    const createdByThisPlayer = createdByPlayer || (createIfMissing && game.players[position] && Object.keys(game.players).length === 1);
    if (createdByThisPlayer) {
      socket.emit('room-created', {
        roomId,
        position,
        isPublic: true,
        roomName: game.roomName,
        displayCode: game.roomName
      });
      broadcastMessage(roomId, `${playerName} a créé une salle publique (${position})`);
    } else {
      socket.emit('room-joined', {
        roomId,
        position,
        isPublic: true,
        roomName: game.roomName,
        displayCode: game.roomName
      });
      broadcastMessage(roomId, `${playerName} rejoint la partie publique (${position})`);
    }

    broadcastGameState(roomId);
    touchRoom(roomId);
    startIfRoomReady(roomId, game);
  }

  socket.on('create-public-room', (data) => {
    playerName = (data?.name || 'Joueur').slice(0, 20);
    const room = createPublicRoom();
    // Owner = creator (first human).
    room.game.ownerId = socket.id;
    room.game.roomName = sanitizeRoomName(data?.roomName) || room.game.roomName;
    addSocketToPublicRoom({ createIfMissing: false, preferredRoomId: room.roomId, createdByPlayer: true });
  });

  socket.on('add-bot', (data) => {
    if (!currentRoom) return;
    const game = games.get(currentRoom);
    if (!game) return;

    if (!isRoomOwner(game, socket.id)) {
      socket.emit('error-msg', { message: 'Seul le propriétaire de la room peut ajouter une IA.' });
      return;
    }

    if (game.state !== 'waiting') {
      socket.emit('error-msg', { message: 'Impossible d\'ajouter une IA après le démarrage.' });
      return;
    }

    const availablePositions = getAvailablePositions(game);
    const position = pickRandom(availablePositions);
    if (!position) {
      socket.emit('error-msg', { message: 'Aucune place disponible.' });
      return;
    }

    const botName = (data?.name || 'IA').toString().slice(0, 20);
    const botId = `BOT:${crypto.randomBytes(6).toString('hex')}`;
    game.players[position] = { id: botId, name: botName, isBot: true };

    broadcastMessage(currentRoom, `${botName} (IA) rejoint la salle (${position})`, 'info');
    broadcastGameState(currentRoom);
    touchRoom(currentRoom);

    if (game.isFull() && game.state === 'waiting') {
      game.startNewRound();
      broadcastGameState(currentRoom);
      broadcastMessage(currentRoom, 'La partie commence ! Phase d\'enchères.', 'success');
      maybeProcessBotTurn(currentRoom);
    }
  });

  socket.on('join-public-room', (data) => {
    playerName = (data?.name || 'Joueur').slice(0, 20);
    const roomId = (data?.roomId || '').toUpperCase().trim();
    addSocketToPublicRoom({ createIfMissing: false, preferredRoomId: roomId || null });
  });

  socket.on('list-public-rooms', () => {
    socket.emit('public-rooms', { rooms: getPublicRoomList() });
  });

  socket.on('quick-play', (data) => {
    // Alias historique: quick-play = rejoindre public, ou créer si aucune salle ouverte.
    playerName = (data?.name || 'Joueur').slice(0, 20);
    addSocketToPublicRoom({ createIfMissing: true, preferredRoomId: null });
  });

  socket.on('bid', (data) => {
    if (!currentRoom) return;
    const game = games.get(currentRoom);
    if (!game) return;

    const position = game.getPlayerPosition(socket.id);
    if (!position) return;

    const result = game.placeBid(position, data);

    if (!result.success) {
      socket.emit('error-msg', { message: result.error });
      return;
    }

    if (data.type === 'coinche') {
      broadcastMessage(currentRoom, `${playerName} COINCHE !`, 'warning');
    } else if (data.type === 'surcoinche') {
      broadcastMessage(currentRoom, `${playerName} SURCOINCHE !`, 'danger');
    }

    if (result.action === 'redistribute') {
      broadcastMessage(currentRoom, 'Tout le monde passe. Redistribution des cartes.', 'info');
      game.startNewRound();
    }

    broadcastGameState(currentRoom);
    touchRoom(currentRoom);
    maybeProcessBotTurn(currentRoom);
  });

  socket.on('play-card', (data) => {
    if (!currentRoom) return;
    const game = games.get(currentRoom);
    if (!game) return;

    const position = game.getPlayerPosition(socket.id);
    if (!position) return;

    const result = game.playCard(position, data.card);

    if (!result.success) {
      socket.emit('error-msg', { message: result.error });
      return;
    }

    if (result.beloteAnnounce) {
      broadcastMessage(currentRoom, `${playerName}: ${result.beloteAnnounce} !`, 'success');
    }

    if (result.action === 'round_end' || result.action === 'game_over') {
      const rr = result.roundResult;
      const teamNames = { ns: 'Nord-Sud', eo: 'Est-Ouest' };
      let msg = rr.contractMet ? '✓ Contrat réussi !' : '✗ Contrat chuté !';
      msg += ` | NS: +${rr.scoreNS} | EO: +${rr.scoreEO}`;
      broadcastMessage(currentRoom, msg, rr.contractMet ? 'success' : 'danger');

      if (result.action === 'game_over') {
        const winnerTeam = teamNames[result.winner];
        broadcastMessage(currentRoom, `🏆 ${winnerTeam} remporte la partie !`, 'success');
      }
    }

    broadcastGameState(currentRoom);
    touchRoom(currentRoom);
    maybeProcessBotTurn(currentRoom);
  });

  socket.on('next-round', () => {
    if (!currentRoom) return;
    const game = games.get(currentRoom);
    if (!game) return;
    if (game.state !== 'scoring') return;

    game.startNewRound();
    broadcastGameState(currentRoom);
    broadcastMessage(currentRoom, 'Nouvelle manche ! Phase d\'enchères.');
    touchRoom(currentRoom);
    maybeProcessBotTurn(currentRoom);
  });

  socket.on('new-game', () => {
    if (!currentRoom) return;
    const game = games.get(currentRoom);
    if (!game) return;
    if (game.state !== 'finished') return;

    game.scores = { ns: 0, eo: 0 };
    game.dealer = 'sud';
    game.roundHistory = [];
    game.roundNumber = 0;
    game.startNewRound();
    broadcastGameState(currentRoom);
    broadcastMessage(currentRoom, 'Nouvelle partie !', 'success');
    touchRoom(currentRoom);
    maybeProcessBotTurn(currentRoom);
  });

  socket.on('get-available-positions', (data) => {
    const roomId = (data.roomId || '').toUpperCase().trim();
    const game = games.get(roomId);

    if (!game) {
      socket.emit('available-positions', { positions: [], error: 'Salle introuvable' });
      return;
    }

    const available = POSITIONS.filter(pos => !game.players[pos]);
    socket.emit('available-positions', { positions: available });
  });

  socket.on('chat-message', (data) => {
    if (!currentRoom) return;
    const game = games.get(currentRoom);
    if (!game) return;

    const position = game.getPlayerPosition(socket.id);
    if (!position) return;

    const rawText = typeof data?.text === 'string' ? data.text : '';
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!text) return;

    const senderName = game.players[position]?.name || playerName || 'Joueur';
    io.to(currentRoom).emit('chat-message', {
      from: senderName,
      position,
      text,
      timestamp: Date.now()
    });
    touchRoom(currentRoom);
  });

  socket.on('disconnect', () => {
    console.log(`Joueur déconnecté: ${socket.id}`);
    if (currentRoom) {
      const game = games.get(currentRoom);
      if (game) {
        const pos = game.removePlayer(socket.id);
        if (pos) {
          broadcastMessage(currentRoom, `${playerName || 'Un joueur'} a quitté la salle`);
          broadcastGameState(currentRoom);

          // Supprimer la salle si vide (aucun joueur) OU si plus aucun humain n'est présent.
          const hasPlayers = POSITIONS.some(p => game.players[p]);
          const hasHumanPlayers = POSITIONS.some(p => {
            const pl = game.players[p];
            return !!pl && pl.isBot !== true;
          });

          if (!hasPlayers || !hasHumanPlayers) {
            // Inform remaining human sockets (if any) that the room is closing.
            for (const p of POSITIONS) {
              const pl = game.players[p];
              if (!pl || pl.isBot === true) continue;
              io.to(pl.id).emit('error-msg', { message: 'Salle fermée (plus aucun joueur humain).' });
              if (game.isPublic) {
                io.to(pl.id).emit('public-room-closed', { roomId: currentRoom });
              }
            }

            games.delete(currentRoom);
            console.log(`Salle ${currentRoom} supprimée (plus aucun humain)`);
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

setInterval(() => {
  const now = Date.now();
  for (const [roomId, game] of games.entries()) {
    if (!game.isPublic) continue;
    if (game.state !== 'waiting') continue;
    const lastActivity = game.lastActivityAt || game.createdAt || now;
    if (now - lastActivity < PUBLIC_INACTIVE_MS) continue;

    for (const pos of POSITIONS) {
      const player = game.players[pos];
      if (!player) continue;
      io.to(player.id).emit('error-msg', { message: 'Salle publique inactive supprimée (5 min).' });
      io.to(player.id).emit('public-room-closed', { roomId });
    }

    games.delete(roomId);
    console.log(`Salle publique ${roomId} supprimée (inactive 5 min)`);
  }
}, PUBLIC_CLEANUP_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`Serveur Coinche lancé sur http://localhost:${PORT}`);
});
