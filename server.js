const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const { CoincheGame, POSITIONS, getTeam } = require('./game');
const botLogic = require('./ai/coinche-bot');
const texturePackConfig = require('./texture-packs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/lobby/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Stockage des parties en cours
const games = new Map();
const PUBLIC_ROOM_PREFIX = 'PUB-';
const PUBLIC_INACTIVE_MS = 5 * 60 * 1000;
const PUBLIC_CLEANUP_INTERVAL_MS = 30 * 1000;
const PLAYER_RECONNECT_GRACE_MS = 2 * 60 * 1000;
const PHANTOM_LOBBY_GRACE_MS = 60 * 1000;

function sanitizeTexturePackName(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  // Keep folder names safe (public/cards/<packName>).
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}

function getConfiguredTexturePacks(config) {
  const seen = new Set();
  const packs = [];
  const configured = Array.isArray(config?.packs) ? config.packs : [];

  for (const item of configured) {
    const packName = sanitizeTexturePackName(item);
    if (!packName) continue;
    const key = packName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    packs.push(packName);
  }

  if (packs.length === 0) {
    packs.push('Classic');
  }

  return packs;
}

const AVAILABLE_TEXTURE_PACKS = getConfiguredTexturePacks(texturePackConfig);
const DEFAULT_TEXTURE_PACK = (() => {
  const configuredDefault = sanitizeTexturePackName(texturePackConfig?.defaultPack);
  if (!configuredDefault) return AVAILABLE_TEXTURE_PACKS[0];

  const resolved = AVAILABLE_TEXTURE_PACKS.find(
    pack => pack.toLowerCase() === configuredDefault.toLowerCase()
  );
  return resolved || AVAILABLE_TEXTURE_PACKS[0];
})();

function resolveTexturePackName(raw) {
  const requested = sanitizeTexturePackName(raw);
  if (!requested) return null;
  return AVAILABLE_TEXTURE_PACKS.find(
    pack => pack.toLowerCase() === requested.toLowerCase()
  ) || null;
}

function getTexturePackListLabel() {
  return AVAILABLE_TEXTURE_PACKS.join(', ');
}

function ensurePlayerTexturePack(player) {
  if (!player) return DEFAULT_TEXTURE_PACK;
  const resolved = resolveTexturePackName(player.texturePack) || DEFAULT_TEXTURE_PACK;
  player.texturePack = resolved;
  return resolved;
}

function emitTexturePackToSocket(socketId, player) {
  const currentPack = ensurePlayerTexturePack(player);
  io.to(socketId).emit('texture-pack', {
    pack: currentPack,
    defaultPack: DEFAULT_TEXTURE_PACK,
    availablePacks: AVAILABLE_TEXTURE_PACKS
  });
}

function getTexturePackOptionsPayload() {
  return {
    defaultPack: DEFAULT_TEXTURE_PACK,
    availablePacks: AVAILABLE_TEXTURE_PACKS
  };
}

function resolveRequestedTexturePack(rawData) {
  return resolveTexturePackName(rawData?.texturePack) || null;
}

const suitNames = {
  coeur: '♥ Coeur',
  carreau: '♦ Carreau',
  trefle: '♣ Trefle',
  pique: '♠ Pique',
  'tout-atout': 'Tout Atout',
  'sans-atout': 'Sans Atout'
};

function formatBidPoints(points) {
  if (points === 270) return 'Capot belote (270)';
  if (points === 250) return 'Capot (250)';
  if (points === 500) return 'Generale (500)';
  return `${points}`;
}

const ROOM_NAME_NOUNS = [
  'Table', 'Salon', 'Atout', 'Belote', 'Coinche', 'Pli', 'Trèfle', 'Carreau', 'Pique', 'Cœur'
];

const ROOM_NAME_ADJECTIVES = [
  'Azur', 'Émeraude', 'Saphir', 'Rubis', 'Ivoire', 'Velours', 'Lumière', 'Brume', 'Nova', 'Orage'
];

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}

function generatePlayerSessionKey() {
  return crypto.randomBytes(12).toString('hex');
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

function getRoomPayload(game, roomId, position) {
  const isPublic = !!game.isPublic;
  return {
    roomId,
    position,
    isPublic,
    playerName: game.players[position]?.name,
    roomName: isPublic ? game.roomName : undefined,
    displayCode: isPublic ? game.roomName : roomId,
    sessionKey: game.players[position]?.sessionKey,
    isOwner: isRoomOwner(game, game.players[position]?.id)
  };
}

function markPlayerAsConnected(game, position, socketId) {
  const player = game?.players?.[position];
  if (!player) return null;
  const previousSocketId = player.id;
  player.id = socketId;
  player.connected = true;
  delete player.disconnectedAt;
  return previousSocketId;
}

function findPlayerPositionBySessionKey(game, sessionKey) {
  if (!game || !sessionKey) return null;
  for (const pos of POSITIONS) {
    const player = game.players[pos];
    if (!player || player.isBot === true) continue;
    if (player.sessionKey === sessionKey) return pos;
  }
  return null;
}

function isBotPlayer(player) {
  return !!player && player.isBot === true;
}

function hasConnectedHumanPlayers(game) {
  if (!game) return false;
  return POSITIONS.some(pos => {
    const player = game.players[pos];
    return !!player && player.isBot !== true && player.connected !== false;
  });
}

function clearPhantomLobbyState(game) {
  if (!game) return;
  if (typeof game.phantomDetectedAt === 'number') {
    delete game.phantomDetectedAt;
  }
}

function updatePhantomLobbyState(roomId, game, now = Date.now()) {
  if (!game) {
    return { isPhantom: false, elapsedMs: 0 };
  }

  if (hasConnectedHumanPlayers(game)) {
    clearPhantomLobbyState(game);
    return { isPhantom: false, elapsedMs: 0 };
  }

  if (typeof game.phantomDetectedAt !== 'number') {
    game.phantomDetectedAt = now;
    console.log(`Lobby phantome detectes: ${roomId}`);
  }

  return {
    isPhantom: true,
    elapsedMs: Math.max(0, now - game.phantomDetectedAt)
  };
}

function isRoomOwner(game, socketId) {
  // Owner is the first human who created the room.
  return !!game && typeof game.ownerId === 'string' && game.ownerId === socketId;
}

function getNextRoomOwnerId(game) {
  if (!game) return null;
  for (const pos of POSITIONS) {
    const player = game.players[pos];
    if (!player || player.isBot === true || player.connected === false) continue;
    return player.id;
  }
  return null;
}

function normalizePositionToken(raw) {
  if (typeof raw !== 'string') return null;
  const token = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!token) return null;

  if (token === 'nord' || token === 'n') return 'nord';
  if (token === 'sud' || token === 's') return 'sud';
  if (token === 'est' || token === 'e') return 'est';
  if (token === 'ouest' || token === 'o' || token === 'w' || token === 'west') return 'ouest';
  return null;
}

function parsePositionFromCommandArg(arg) {
  if (typeof arg !== 'string') return null;
  const firstToken = arg.split(/[\s\/\\|,;]+/).filter(Boolean)[0] || '';
  return normalizePositionToken(firstToken);
}

function positionLabelFr(position) {
  const labels = { nord: 'Nord', sud: 'Sud', est: 'Est', ouest: 'Ouest' };
  return labels[position] || position;
}

function getSafePlayerName(game, position, fallback = 'Joueur') {
  if (!game || !position) return fallback;
  return game.players?.[position]?.name || positionLabelFr(position) || fallback;
}

function emitSystemChatToSocket(socketId, text) {
  io.to(socketId).emit('chat-message', {
    from: 'Système',
    position: null,
    text,
    timestamp: Date.now()
  });
}

function addBotAtPosition(roomId, game, position, botName = 'IA') {
  if (!game) return { success: false, error: 'Salle introuvable.' };
  if (!POSITIONS.includes(position)) return { success: false, error: 'Position invalide.' };
  if (game.players[position]) return { success: false, error: `La position ${positionLabelFr(position)} est déjà occupée.` };

  const safeName = (botName || 'IA').toString().slice(0, 20);
  const botId = `BOT:${crypto.randomBytes(6).toString('hex')}`;
  game.players[position] = { id: botId, name: safeName, isBot: true, connected: true };

  broadcastMessage(roomId, `${safeName} (IA) rejoint la salle (${position})`, 'info');
  broadcastGameState(roomId);
  touchRoom(roomId);

  if (game.isFull() && game.state === 'waiting') {
    game.startNewRound();
    broadcastGameState(roomId);
    broadcastMessage(roomId, 'La partie commence ! Phase d\'enchères.', 'success');
    maybeProcessBotTurn(roomId);
  }

  return { success: true };
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

        if (result.action === 'play') {
          const suitName = suitNames[latest.contract.suit] || latest.contract.suit;
          const bidderName = getSafePlayerName(latest, latest.contract.player);
          let msg = `Contrat: ${formatBidPoints(latest.contract.points)} ${suitName} par ${bidderName}`;
          if (latest.contract.coinched) msg += ' (COINCHÉ)';
          if (latest.contract.surcoinched) msg += ' (SURCOINCÉ)';
          broadcastMessage(roomId, msg, 'success');
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

        if (result.action === 'trick_complete') {
          const winnerName = getSafePlayerName(latest, result.winner);
          broadcastMessage(roomId, `${winnerName} remporte le pli (+${result.points} pts)`);
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
  let requestedTexturePack = null;

  socket.emit('texture-pack-options', getTexturePackOptionsPayload());

  socket.on('get-texture-packs', () => {
    socket.emit('texture-pack-options', getTexturePackOptionsPayload());
  });

  socket.on('create-room', (data) => {
    const roomId = generateRoomCode();
    const game = new CoincheGame(roomId);
    games.set(roomId, game);
    requestedTexturePack = resolveRequestedTexturePack(data);

    playerName = (data.name || 'Joueur').slice(0, 20);
    const position = data.position || 'sud';

    if (!game.addPlayer(socket.id, playerName, position)) {
      socket.emit('error-msg', { message: 'Position déjà prise' });
      return;
    }
    game.players[position].sessionKey = generatePlayerSessionKey();
    game.players[position].connected = true;
    game.players[position].texturePack = requestedTexturePack || DEFAULT_TEXTURE_PACK;
    ensurePlayerTexturePack(game.players[position]);
    clearPhantomLobbyState(game);

    // Owner = creator (first human).
    game.ownerId = socket.id;

    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-created', getRoomPayload(game, roomId, position));
    emitTexturePackToSocket(socket.id, game.players[position]);
    broadcastGameState(roomId);
    broadcastMessage(roomId, `${playerName} a créé la salle (${position})`);
    touchRoom(roomId);
  });

  socket.on('join-room', (data) => {
    const roomId = (data.roomId || '').toUpperCase().trim();
    const game = games.get(roomId);
    requestedTexturePack = resolveRequestedTexturePack(data);

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
    game.players[position].sessionKey = generatePlayerSessionKey();
    game.players[position].connected = true;
    game.players[position].texturePack = requestedTexturePack || DEFAULT_TEXTURE_PACK;
    ensurePlayerTexturePack(game.players[position]);
    clearPhantomLobbyState(game);

    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-joined', getRoomPayload(game, roomId, position));
    emitTexturePackToSocket(socket.id, game.players[position]);
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
    game.players[position].sessionKey = generatePlayerSessionKey();
    game.players[position].connected = true;
    game.players[position].texturePack = requestedTexturePack || DEFAULT_TEXTURE_PACK;
    ensurePlayerTexturePack(game.players[position]);
    clearPhantomLobbyState(game);

    currentRoom = roomId;
    socket.join(roomId);

    const createdByThisPlayer = createdByPlayer || (createIfMissing && game.players[position] && Object.keys(game.players).length === 1);
    if (createdByThisPlayer) {
      socket.emit('room-created', getRoomPayload(game, roomId, position));
      broadcastMessage(roomId, `${playerName} a créé une salle publique (${position})`);
    } else {
      socket.emit('room-joined', getRoomPayload(game, roomId, position));
      broadcastMessage(roomId, `${playerName} rejoint la partie publique (${position})`);
    }
    emitTexturePackToSocket(socket.id, game.players[position]);

    broadcastGameState(roomId);
    touchRoom(roomId);
    startIfRoomReady(roomId, game);
  }

  socket.on('create-public-room', (data) => {
    requestedTexturePack = resolveRequestedTexturePack(data);
    playerName = (data?.name || 'Joueur').slice(0, 20);
    const room = createPublicRoom();
    // Owner = creator (first human).
    room.game.ownerId = socket.id;
    room.game.roomName = sanitizeRoomName(data?.roomName) || room.game.roomName;
    addSocketToPublicRoom({ createIfMissing: false, preferredRoomId: room.roomId, createdByPlayer: true });
  });

  socket.on('reconnect-room', (data) => {
    requestedTexturePack = resolveRequestedTexturePack(data);
    const roomId = (data?.roomId || '').toString().toUpperCase().trim();
    const sessionKey = (data?.sessionKey || '').toString().trim();
    if (!roomId || !sessionKey) {
      socket.emit('reconnect-failed', { roomId });
      socket.emit('error-msg', { message: 'Reconnexion impossible (session manquante).' });
      return;
    }

    const game = games.get(roomId);
    if (!game) {
      socket.emit('reconnect-failed', { roomId });
      socket.emit('error-msg', { message: 'Cette salle n\'existe plus.' });
      return;
    }

    const position = findPlayerPositionBySessionKey(game, sessionKey);
    if (!position) {
      socket.emit('reconnect-failed', { roomId });
      socket.emit('error-msg', { message: 'Session expirée pour cette salle.' });
      return;
    }

    const player = game.players[position];
    if (!player) {
      socket.emit('reconnect-failed', { roomId });
      socket.emit('error-msg', { message: 'Position introuvable pour la reconnexion.' });
      return;
    }

    const previousSocketId = markPlayerAsConnected(game, position, socket.id);
    if (game.ownerId === previousSocketId) {
      game.ownerId = socket.id;
    }
    clearPhantomLobbyState(game);

    playerName = player.name;
    currentRoom = roomId;
    socket.join(roomId);
    if (requestedTexturePack) {
      player.texturePack = requestedTexturePack;
    }
    ensurePlayerTexturePack(player);

    socket.emit('room-reconnected', getRoomPayload(game, roomId, position));
    emitTexturePackToSocket(socket.id, player);
    broadcastMessage(roomId, `${player.name} est reconnecté.`);
    broadcastGameState(roomId);
    touchRoom(roomId);
    maybeProcessBotTurn(roomId);
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

    const result = addBotAtPosition(currentRoom, game, position, data?.name || 'IA');
    if (!result.success) {
      socket.emit('error-msg', { message: result.error || 'Impossible d\'ajouter une IA.' });
    }
  });

  socket.on('join-public-room', (data) => {
    requestedTexturePack = resolveRequestedTexturePack(data);
    playerName = (data?.name || 'Joueur').slice(0, 20);
    const roomId = (data?.roomId || '').toUpperCase().trim();
    addSocketToPublicRoom({ createIfMissing: false, preferredRoomId: roomId || null });
  });

  socket.on('list-public-rooms', () => {
    socket.emit('public-rooms', { rooms: getPublicRoomList() });
  });

  socket.on('quick-play', (data) => {
    // Alias historique: quick-play = rejoindre public, ou créer si aucune salle ouverte.
    requestedTexturePack = resolveRequestedTexturePack(data);
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

    if (result.action === 'play') {
      const suitName = suitNames[game.contract.suit] || game.contract.suit;
      const bidderName = getSafePlayerName(game, game.contract.player);
      let msg = `Contrat: ${formatBidPoints(game.contract.points)} ${suitName} par ${bidderName}`;
      if (game.contract.coinched) msg += ' (COINCHÉ)';
      if (game.contract.surcoinched) msg += ' (SURCOINCÉ)';
      broadcastMessage(currentRoom, msg, 'success');
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

    if (result.action === 'trick_complete') {
      const winnerName = getSafePlayerName(game, result.winner);
      broadcastMessage(currentRoom, `${winnerName} remporte le pli (+${result.points} pts)`);
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

  socket.on('leave-room', () => {
    if (!currentRoom) {
      socket.emit('room-left', { roomId: null });
      return;
    }

    const roomId = currentRoom;
    const game = games.get(roomId);

    socket.leave(roomId);
    currentRoom = null;

    if (!game) {
      socket.emit('room-left', { roomId });
      return;
    }

    const position = game.getPlayerPosition(socket.id);
    if (!position) {
      socket.emit('room-left', { roomId });
      return;
    }

    const leavingPlayer = game.players[position];
    const leavingName = leavingPlayer?.name || playerName || 'Un joueur';
    const wasOwner = isRoomOwner(game, socket.id);

    game.removePlayer(socket.id);

    if (wasOwner) {
      game.ownerId = getNextRoomOwnerId(game);
    }

    broadcastMessage(roomId, `${leavingName} a quitté la salle.`, 'info');
    broadcastGameState(roomId);
    touchRoom(roomId);
    updatePhantomLobbyState(roomId, game);

    socket.emit('room-left', { roomId, position });
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

    if (text.startsWith('/')) {
      const requester = game.players[position];
      const requesterName = requester?.name || playerName || 'Joueur';
      const commandLine = text.slice(1).trim();
      const [commandRaw, ...argParts] = commandLine.split(' ');
      const command = (commandRaw || '').toLowerCase();
      const arg = argParts.join(' ').trim();

      const sendHelp = () => {
        emitSystemChatToSocket(socket.id, 'Commandes disponibles :');
        emitSystemChatToSocket(socket.id, '/help - Affiche cette aide.');
        emitSystemChatToSocket(socket.id, '/host - Affiche le point cardinal de l\'hôte de la partie.');
        emitSystemChatToSocket(socket.id, '/kick Nord|Sud|Est|Ouest - Expulse un joueur de la position (créateur uniquement).');
        emitSystemChatToSocket(socket.id, '/addia Nord|Sud|Est|Ouest - Ajoute une IA sur la position (créateur uniquement).');
        emitSystemChatToSocket(socket.id, '/texture [nomPack] - Change votre pack de textures cartes (ou affiche la liste).');
      };

      if (!command) {
        emitSystemChatToSocket(socket.id, 'Commande vide. Tape /help pour voir les commandes.');
        return;
      }

      if (command === 'help') {
        sendHelp();
        touchRoom(currentRoom);
        return;
      }

      if (command === 'host') {
        const ownerPosition = game.getPlayerPosition(game.ownerId);
        if (!ownerPosition) {
          emitSystemChatToSocket(socket.id, 'Hôte introuvable pour cette partie.');
          return;
        }

        emitSystemChatToSocket(socket.id, `L'hôte est en ${positionLabelFr(ownerPosition)}.`);
        touchRoom(currentRoom);
        return;
      }

      if (command === 'kick') {
        if (!isRoomOwner(game, socket.id)) {
          emitSystemChatToSocket(socket.id, 'Seul le créateur de la partie peut utiliser /kick.');
          return;
        }

        const targetPos = parsePositionFromCommandArg(arg);
        if (!targetPos) {
          emitSystemChatToSocket(socket.id, 'Usage: /kick Nord|Sud|Est|Ouest');
          return;
        }

        if (targetPos === position) {
          emitSystemChatToSocket(socket.id, 'Tu ne peux pas te kick toi-même.');
          return;
        }

        const targetPlayer = game.players[targetPos];
        if (!targetPlayer) {
          emitSystemChatToSocket(socket.id, `Aucun joueur à la position ${positionLabelFr(targetPos)}.`);
          return;
        }

        const targetSocketId = targetPlayer.id;
        const targetName = targetPlayer.name || positionLabelFr(targetPos);
        const targetWasBot = targetPlayer.isBot === true;

        game.removePlayer(targetSocketId);

        if (!targetWasBot) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.leave(currentRoom);
          }
          io.to(targetSocketId).emit('kicked-from-room', {
            roomId: currentRoom,
            position: targetPos,
            by: requesterName
          });
          io.to(targetSocketId).emit('error-msg', { message: 'Vous avez été expulsé de la salle.' });
        }

        broadcastMessage(currentRoom, `${targetName} a été expulsé par ${requesterName} (${positionLabelFr(targetPos)}).`, 'warning');
        broadcastGameState(currentRoom);
        touchRoom(currentRoom);
        updatePhantomLobbyState(currentRoom, game);
        emitSystemChatToSocket(socket.id, `${targetName} a bien été expulsé (${positionLabelFr(targetPos)}).`);
        return;
      }

      if (command === 'addia') {
        if (!isRoomOwner(game, socket.id)) {
          emitSystemChatToSocket(socket.id, 'Seul le créateur de la partie peut utiliser /addia.');
          return;
        }

        const targetPos = parsePositionFromCommandArg(arg);
        if (!targetPos) {
          emitSystemChatToSocket(socket.id, 'Usage: /addia Nord|Sud|Est|Ouest');
          return;
        }

        const result = addBotAtPosition(currentRoom, game, targetPos, 'IA');
        if (!result.success) {
          emitSystemChatToSocket(socket.id, result.error || 'Impossible d\'ajouter une IA à cette position.');
          return;
        }

        emitSystemChatToSocket(socket.id, `IA ajoutée sur ${positionLabelFr(targetPos)}.`);
        // Si c'est le tour de cette position en cours de partie, l'IA joue immédiatement.
        maybeProcessBotTurn(currentRoom);
        return;
      }

      if (command === 'texture') {
        const requester = game.players[position];
        const currentPack = ensurePlayerTexturePack(requester);

        if (!arg || arg.toLowerCase() === 'list') {
          emitSystemChatToSocket(socket.id, `Pack actuel : ${currentPack}`);
          emitSystemChatToSocket(socket.id, `Packs disponibles : ${getTexturePackListLabel()}`);
          emitSystemChatToSocket(socket.id, 'Usage : /texture <nomPack>');
          touchRoom(currentRoom);
          return;
        }

        const nextPack = resolveTexturePackName(arg);
        if (!nextPack) {
          emitSystemChatToSocket(socket.id, `Pack inconnu : ${arg}`);
          emitSystemChatToSocket(socket.id, `Packs disponibles : ${getTexturePackListLabel()}`);
          touchRoom(currentRoom);
          return;
        }

        if (nextPack === currentPack) {
          emitSystemChatToSocket(socket.id, `Le pack ${nextPack} est déjà actif.`);
          touchRoom(currentRoom);
          return;
        }

        requester.texturePack = nextPack;
        emitTexturePackToSocket(socket.id, requester);
        emitSystemChatToSocket(socket.id, `Pack de textures actif : ${nextPack}`);
        touchRoom(currentRoom);
        return;
      }

      emitSystemChatToSocket(socket.id, `Commande inconnue: /${command}. Tape /help pour la liste.`);
      return;
    }

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
        const pos = game.getPlayerPosition(socket.id);
        if (pos) {
          const player = game.players[pos];
          const isHumanWithSession = !!player && player.isBot !== true && typeof player.sessionKey === 'string';

          if (isHumanWithSession) {
            player.connected = false;
            player.disconnectedAt = Date.now();
            broadcastMessage(currentRoom, `${player.name || 'Un joueur'} est déconnecté (reconnexion possible).`, 'warning');
            broadcastGameState(currentRoom);
            touchRoom(currentRoom);
            updatePhantomLobbyState(currentRoom, game);
          } else {
            game.removePlayer(socket.id);
            broadcastMessage(currentRoom, `${playerName || 'Un joueur'} a quitté la salle`);
            broadcastGameState(currentRoom);
            touchRoom(currentRoom);
            updatePhantomLobbyState(currentRoom, game);
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
    for (const pos of POSITIONS) {
      const player = game.players[pos];
      if (!player || player.isBot === true) continue;
      if (player.connected !== false) continue;
      const disconnectedAt = player.disconnectedAt || now;
      if (now - disconnectedAt < PLAYER_RECONNECT_GRACE_MS) continue;

      const expiredSocketId = player.id;
      const expiredName = player.name || 'Un joueur';
      game.removePlayer(expiredSocketId);
      broadcastMessage(roomId, `${expiredName} a quitté la salle (reconnexion expirée).`, 'warning');
      broadcastGameState(roomId);
    }

    const phantomState = updatePhantomLobbyState(roomId, game, now);
    if (phantomState.isPhantom && phantomState.elapsedMs >= PHANTOM_LOBBY_GRACE_MS) {
      games.delete(roomId);
      console.log(`Lobby ${roomId} supprime apres 60s sans humain reconnecte.`);
      continue;
    }
  }

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
