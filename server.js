const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const { CoincheGame, POSITIONS, getTeam } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Stockage des parties en cours
const games = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
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

function formatBidPoints(points) {
  if (points === 270) return 'Capot beloté (270)';
  if (points === 250) return 'Capot (250)';
  if (points === 500) return 'Générale (500)';
  return `${points}`;
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

    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-created', { roomId, position });
    broadcastGameState(roomId);
    broadcastMessage(roomId, `${playerName} a créé la salle (${position})`);
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
    socket.emit('room-joined', { roomId, position });
    broadcastGameState(roomId);
    broadcastMessage(roomId, `${playerName} a rejoint la salle (${position})`);

    // Démarrer si 4 joueurs
    if (game.isFull() && game.state === 'waiting') {
      game.startNewRound();
      broadcastGameState(roomId);
      broadcastMessage(roomId, 'La partie commence ! Phase d\'enchères.', 'success');
    }
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

    const suitNames = {
      'coeur': '♥ Coeur', 'carreau': '♦ Carreau', 'trefle': '♣ Trèfle',
      'pique': '♠ Pique', 'tout-atout': 'Tout Atout', 'sans-atout': 'Sans Atout'
    };

    if (data.type === 'pass') {
      broadcastMessage(currentRoom, `${playerName} passe`);
    } else if (data.type === 'coinche') {
      broadcastMessage(currentRoom, `${playerName} COINCHE !`, 'warning');
    } else if (data.type === 'surcoinche') {
      broadcastMessage(currentRoom, `${playerName} SURCOINCHE !`, 'danger');
    } else if (data.type === 'bid') {
      broadcastMessage(currentRoom, `${playerName} annonce ${formatBidPoints(data.points)} ${suitNames[data.suit] || data.suit}`);
    }

    if (result.action === 'redistribute') {
      game.startNewRound();
      broadcastMessage(currentRoom, 'Tout le monde a passé - redistribution !', 'warning');
    }

    if (result.action === 'play') {
      const suitName = suitNames[game.contract.suit] || game.contract.suit;
      let msg = `Contrat: ${formatBidPoints(game.contract.points)} ${suitName} par ${game.players[game.contract.player].name}`;
      if (game.contract.coinched) msg += ' (COINCHÉ)';
      if (game.contract.surcoinched) msg += ' (SURCOINCÉ)';
      broadcastMessage(currentRoom, msg, 'success');
    }

    broadcastGameState(currentRoom);
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
      const winnerName = game.players[result.winner].name;
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
  });

  socket.on('next-round', () => {
    if (!currentRoom) return;
    const game = games.get(currentRoom);
    if (!game) return;
    if (game.state !== 'scoring') return;

    game.startNewRound();
    broadcastGameState(currentRoom);
    broadcastMessage(currentRoom, 'Nouvelle manche ! Phase d\'enchères.');
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

  socket.on('disconnect', () => {
    console.log(`Joueur déconnecté: ${socket.id}`);
    if (currentRoom) {
      const game = games.get(currentRoom);
      if (game) {
        const pos = game.removePlayer(socket.id);
        if (pos) {
          broadcastMessage(currentRoom, `${playerName || 'Un joueur'} a quitté la salle`);
          broadcastGameState(currentRoom);

          // Supprimer la salle si vide
          const hasPlayers = POSITIONS.some(p => game.players[p]);
          if (!hasPlayers) {
            games.delete(currentRoom);
            console.log(`Salle ${currentRoom} supprimée (vide)`);
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Coinche lancé sur http://localhost:${PORT}`);
});
