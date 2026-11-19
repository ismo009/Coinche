// Robustesse du serveur face à des messages malformés : node test/server-robustness.js
// Lance un vrai serveur, lui envoie des données invalides sur chaque événement, puis vérifie
// qu'il est toujours vivant et qu'il répond normalement.
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;

const BAD_PAYLOADS = [undefined, null, 42, 'texte', [], [1, 2], true, { name: 123 }, { name: ['a'] }, { roomId: 7 }, { position: 'foo' }, { card: 'x' }, { card: { suit: 1 } }];
const EVENTS = [
  'create-room', 'join-room', 'create-public-room', 'reconnect-room', 'add-bot', 'join-public-room',
  'list-public-rooms', 'quick-play', 'bid', 'play-card', 'next-round', 'new-game', 'leave-room',
  'get-available-positions', 'chat-message', 'get-texture-packs'
];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false, timeout: 3000 });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout en attendant ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let exited = null;
  let stderr = '';
  server.on('exit', (code) => { exited = code; });
  server.stderr.on('data', (d) => { stderr += d.toString(); });

  try {
    // Attendre que le serveur écoute.
    for (let i = 0; i < 50; i++) {
      try {
        const s = await connect();
        s.close();
        break;
      } catch {
        await wait(100);
      }
    }

    // 1) Données invalides sur chaque événement, hors salle puis dans une salle.
    const attacker = await connect();
    for (const event of EVENTS) {
      for (const payload of BAD_PAYLOADS) attacker.emit(event, payload);
    }
    attacker.emit('create-room', { name: 'Attaquant' });
    await wait(200);
    for (const event of EVENTS) {
      if (event === 'leave-room') continue;
      for (const payload of BAD_PAYLOADS) attacker.emit(event, payload);
    }
    await wait(500);
    assert.strictEqual(exited, null, `le serveur s'est arrêté (code ${exited}).\n${stderr}`);
    console.log('  ok  - messages malformés : le serveur reste en ligne');

    // 2) Le serveur répond toujours normalement.
    const player = await connect();
    const created = once(player, 'room-created');
    player.emit('create-room', { name: '<img src=x onerror=alert(1)>', position: 'nord' });
    const room = await created;
    assert.strictEqual(room.position, 'nord');
    // Le nom est conservé tel quel (texte) : c'est au client de l'afficher en textContent.
    assert.strictEqual(room.playerName, '<img src=x onerror=a');
    console.log('  ok  - le serveur répond normalement après les attaques');

    // 3) Position invalide -> repli sur une position valide ; nom non-texte -> nom par défaut.
    const other = await connect();
    const created2 = once(other, 'room-created');
    other.emit('create-room', { name: 12345, position: 'foo' });
    const room2 = await created2;
    assert.strictEqual(room2.position, 'sud');
    assert.strictEqual(room2.playerName, 'Joueur');
    console.log('  ok  - position et nom invalides sont normalisés');

    // 4) Caractères de contrôle / bidi retirés des noms.
    const third = await connect();
    const created3 = once(third, 'room-created');
    third.emit('create-room', { name: 'A‮B\u0000C​D' });
    assert.strictEqual((await created3).playerName, 'ABCD');
    console.log('  ok  - caractères de contrôle retirés des noms');

    for (const s of [attacker, player, other, third]) s.close();
    assert.strictEqual(exited, null, 'le serveur s\'est arrêté');
    console.log('\nRobustesse serveur : OK');
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error('  FAIL -', err.message);
  process.exitCode = 1;
});
