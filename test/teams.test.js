// Noms d'équipe : node test/teams.test.js
// 1) Moteur (CoincheGame.setTeamName / state.teamNames).
// 2) Vrai serveur : événement 'set-team-name', commande /team, normalisation, anti-spam.
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const { CoincheGame } = require('../game');

const PORT = 4000 + Math.floor(Math.random() * 900);
const URL = `http://localhost:${PORT}`;
const COOLDOWN_WAIT_MS = 2100;

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.log(`not ok - ${name}`);
    console.log(`  ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n  ') : err}`);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ------------------------------------------------------------
// 1) Moteur
// ------------------------------------------------------------
async function engineTests() {
  await test('moteur : noms par défaut', () => {
    const game = new CoincheGame('T1');
    assert.deepStrictEqual(game.teamNames, { ns: null, eo: null });
    const state = game.getStateForPlayer('sud');
    assert.deepStrictEqual(state.teamNames, { ns: 'Nord-Sud', eo: 'Est-Ouest' });
  });

  await test('moteur : setTeamName personnalise une seule équipe', () => {
    const game = new CoincheGame('T2');
    assert.strictEqual(game.setTeamName('ns', 'Les Kings'), true);
    assert.deepStrictEqual(game.getStateForPlayer('est').teamNames, { ns: 'Les Kings', eo: 'Est-Ouest' });
    assert.strictEqual(game.teamNames.ns, 'Les Kings');
    assert.strictEqual(game.teamNames.eo, null);
  });

  await test('moteur : null / vide / espaces = retour au défaut', () => {
    const game = new CoincheGame('T3');
    for (const value of [null, '', '   ', undefined, 42]) {
      game.setTeamName('eo', 'Temp');
      game.setTeamName('eo', value);
      assert.strictEqual(game.teamNames.eo, null, `valeur ${String(value)}`);
      assert.strictEqual(game.getStateForPlayer('sud').teamNames.eo, 'Est-Ouest');
    }
  });

  await test('moteur : équipe inconnue refusée, longueur bornée à 24', () => {
    const game = new CoincheGame('T4');
    assert.strictEqual(game.setTeamName('nord', 'X'), false);
    assert.strictEqual(game.setTeamName('__proto__', 'X'), false);
    assert.deepStrictEqual(game.teamNames, { ns: null, eo: null });
    game.setTeamName('ns', 'A'.repeat(50));
    assert.strictEqual(game.teamNames.ns.length, 24);
  });

  await test('moteur : les noms survivent à une nouvelle manche / partie', () => {
    const game = new CoincheGame('T5');
    for (const [pos, name] of [['sud', 'A'], ['nord', 'B'], ['est', 'C'], ['ouest', 'D']]) {
      game.addPlayer(`id-${pos}`, name, pos);
    }
    game.setTeamName('ns', 'Les Kings');
    game.setTeamName('eo', 'Les Reines');
    game.startNewRound();
    // Même remise à zéro que le handler 'new-game' du serveur.
    game.scores = { ns: 0, eo: 0 };
    game.roundHistory = [];
    game.roundNumber = 0;
    game.startNewRound();
    assert.deepStrictEqual(game.getStateForPlayer('sud').teamNames, { ns: 'Les Kings', eo: 'Les Reines' });
  });
}

// ------------------------------------------------------------
// 2) Serveur
// ------------------------------------------------------------
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

// Attend un événement dont la donnée vérifie `predicate`.
function waitFor(socket, event, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout en attendant ${event}`));
    }, timeoutMs);
    socket.on(event, handler);
  });
}

// Vérifie qu'aucun événement correspondant n'arrive pendant `ms`.
function expectNone(socket, event, predicate, ms = 400) {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      reject(new Error(`événement ${event} inattendu : ${JSON.stringify(data).slice(0, 200)}`));
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, ms);
    socket.on(event, handler);
  });
}

const teamIs = (team, name) => (st) => st && st.teamNames && st.teamNames[team] === name;

async function serverTests() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let exited = null;
  let stderr = '';
  server.on('exit', (code) => { exited = code; });
  server.stderr.on('data', (d) => { stderr += d.toString(); });
  const sockets = [];

  try {
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      try {
        const s = await connect();
        s.close();
        ready = true;
      } catch {
        await wait(100);
      }
    }
    assert.ok(ready, `le serveur ne démarre pas.\n${stderr}`);

    // Salle : Alice (sud, NS), Carol (nord, NS), Bob (est, EO).
    const alice = await connect();
    const bob = await connect();
    const carol = await connect();
    const outsider = await connect();
    sockets.push(alice, bob, carol, outsider);

    const created = once(alice, 'room-created');
    alice.emit('create-room', { name: 'Alice', position: 'sud' });
    const { roomId } = await created;
    let joined = once(bob, 'room-joined');
    bob.emit('join-room', { name: 'Bob', roomId, position: 'est' });
    await joined;
    const firstState = waitFor(alice, 'game-state', (st) => !!(st.players && st.players.nord));
    joined = once(carol, 'room-joined');
    carol.emit('join-room', { name: 'Carol', roomId, position: 'nord' });
    await joined;

    await test('serveur : game-state contient les noms par défaut', async () => {
      const state = await firstState;
      assert.deepStrictEqual(state.teamNames, { ns: 'Nord-Sud', eo: 'Est-Ouest' });
      outsider.emit('set-team-name', { name: 'Intrus' }); // hors salle : ignoré
      alice.emit('set-team-name', { name: '' }); // déjà par défaut : rien ne change
      await expectNone(bob, 'game-state', (st) => st.teamNames.ns !== 'Nord-Sud' || st.teamNames.eo !== 'Est-Ouest', 300);
    });

    await test('serveur : un joueur renomme son équipe, diffusé à toute la salle', async () => {
      const bobState = waitFor(bob, 'game-state', teamIs('ns', 'Les Kings'));
      const bobMsg = waitFor(bob, 'message', (m) => /Les Kings/.test(m.text));
      alice.emit('set-team-name', { name: '  Les   Kings ' });
      const state = await bobState;
      assert.strictEqual(state.teamNames.eo, 'Est-Ouest');
      const msg = await bobMsg;
      assert.strictEqual(msg.text, 'L\'équipe Nord-Sud s\'appelle désormais « Les Kings »');
    });

    await test('serveur : anti-spam (2 s par socket), le coéquipier peut renommer', async () => {
      const err = once(alice, 'error-msg');
      alice.emit('set-team-name', { name: 'Trop Vite' });
      assert.match((await err).message, /Attends/);
      // Carol (même équipe, autre socket) n'est pas bloquée.
      const st = waitFor(alice, 'game-state', teamIs('ns', 'Les Reines'));
      carol.emit('set-team-name', { name: 'Les Reines' });
      await st;
      await expectNone(bob, 'game-state', teamIs('ns', 'Trop Vite'), 200);
    });

    await test('serveur : caractères de contrôle / bidi retirés, 24 caractères max', async () => {
      const st = waitFor(carol, 'game-state', (s) => s.teamNames.eo !== 'Est-Ouest');
      bob.emit('set-team-name', { name: 'Les\u0000 Super‮ Mega​ Champions de la Coinche' });
      const state = await st;
      assert.strictEqual(state.teamNames.eo, 'Les Super Mega Champions');
      assert.strictEqual(state.teamNames.eo.length, 24);
      assert.strictEqual(state.teamNames.ns, 'Les Reines'); // l'autre équipe n'est pas touchée
    });

    await wait(COOLDOWN_WAIT_MS);

    await test('serveur : nom non-texte = retour au nom par défaut, sans planter', async () => {
      const st = waitFor(alice, 'game-state', teamIs('eo', 'Est-Ouest'));
      bob.emit('set-team-name', { name: ['<b>x</b>'] });
      await st;
      // Charges invalides : le serveur reste en ligne.
      for (const payload of [undefined, null, 42, 'texte', [], { name: { a: 1 } }]) {
        outsider.emit('set-team-name', payload);
      }
      await wait(200);
      assert.strictEqual(exited, null, `le serveur s'est arrêté.\n${stderr}`);
    });

    await test('serveur : /team <nom> renomme l\'équipe du joueur', async () => {
      const st = waitFor(bob, 'game-state', teamIs('ns', 'Les As'));
      const msg = waitFor(bob, 'message', (m) => /« Les As »/.test(m.text));
      carol.emit('chat-message', { text: '/team Les As' });
      await st;
      assert.strictEqual((await msg).text, 'L\'équipe Les Reines s\'appelle désormais « Les As »');
    });

    await test('serveur : /team seul remet le nom par défaut', async () => {
      const st = waitFor(bob, 'game-state', teamIs('ns', 'Nord-Sud'));
      alice.emit('chat-message', { text: '/team' });
      await st;
    });

    await test('serveur : /team soumis à l\'anti-spam (message système)', async () => {
      const sys = waitFor(alice, 'chat-message', (m) => /Attends/.test(m.text || ''));
      alice.emit('chat-message', { text: '/TEAM Encore' });
      await sys;
    });

    await test('serveur : /help mentionne /team', async () => {
      const line = waitFor(bob, 'chat-message', (m) => /^\/team/.test(m.text || ''));
      bob.emit('chat-message', { text: '/help' });
      await line;
    });

    // Fin de la salle d'attente : les 4 sockets jouent ensuite automatiquement une manche
    // (le premier à parler annonce 80 cœur, les autres passent ; chacun joue sa première
    // carte jouable) pour vérifier les messages de fin de manche.
    const autoplay = (socket) => (st) => {
      if (!st || st.currentPlayer !== st.myPosition) return;
      if (st.state === 'bidding') {
        const hasBid = (st.bids || []).some(b => b && b.type === 'bid');
        socket.emit('bid', hasBid ? { type: 'pass' } : { type: 'bid', points: 80, suit: 'coeur' });
      } else if (st.state === 'playing' && st.playableCards && st.playableCards.length) {
        socket.emit('play-card', { card: st.playableCards[0] });
      }
    };
    let roundEndMsg = null;

    await test('serveur : un joueur qui rejoint voit les noms personnalisés', async () => {
      await wait(COOLDOWN_WAIT_MS); // Bob a renommé il y a moins de 2 s
      const st0 = waitFor(alice, 'game-state', teamIs('eo', 'Les Ouest'));
      bob.emit('chat-message', { text: '/team Les Ouest' });
      await st0;
      const dave = await connect();
      sockets.push(dave);
      for (const sock of [alice, bob, carol, dave]) sock.on('game-state', autoplay(sock));
      roundEndMsg = waitFor(alice, 'message', (m) => /Contrat (réussi|chuté)/.test(m.text), 10000);
      roundEndMsg.catch(() => {}); // évaluée dans le test suivant
      // La salle est complète : la partie démarre, les noms sont conservés.
      const st = waitFor(dave, 'game-state', (x) => x.state === 'bidding');
      dave.emit('join-room', { name: 'Dave', roomId, position: 'ouest' });
      const state = await st;
      assert.deepStrictEqual(state.teamNames, { ns: 'Nord-Sud', eo: 'Les Ouest' });
    });

    await test('serveur : les messages de fin de manche utilisent les noms d\'équipe', async () => {
      assert.ok(roundEndMsg, 'manche non lancée');
      const msg = await roundEndMsg;
      assert.match(msg.text, /\| Nord-Sud: \+\d+ \| Les Ouest: \+\d+$/);
    });

    assert.strictEqual(exited, null, `le serveur s'est arrêté.\n${stderr}`);
  } finally {
    for (const s of sockets) s.close();
    server.kill();
  }
}

(async () => {
  try {
    await engineTests();
    await serverTests();
  } catch (err) {
    failures++;
    console.log(`not ok - ${err && err.message ? err.message : err}`);
  }
  if (failures > 0) {
    console.log(`${failures} test(s) en échec`);
    process.exitCode = 1;
  } else {
    console.log('Tous les tests des noms d\'équipe passent.');
  }
})();
