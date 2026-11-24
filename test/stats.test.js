// Statistiques des joueurs : node test/stats.test.js
// Teste lib/stats-store.js (règles de comptage, persistance, fichier corrompu)
// puis la route GET /api/stats sur un vrai serveur.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coinche-stats-'));
process.env.STATS_FILE = path.join(TMP_DIR, 'default-stats.json');

const { CoincheGame, POSITIONS } = require('../game');
const { createStatsStore, recordRoundOutcome, normalizeName } = require('../lib/stats-store');

const silentLog = { error() {}, log() {} };
let fileCounter = 0;
function tmpFile() {
  fileCounter++;
  return path.join(TMP_DIR, `stats-${fileCounter}.json`);
}
function newStore(file = tmpFile(), extra = {}) {
  return createStatsStore({ file, debounceMs: 20, log: silentLog, ...extra }).load();
}

let failures = 0;
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function fakeGame(players) {
  return { players };
}
function human(name) {
  return { id: 'id-' + name, name };
}
function bot(name) {
  return { id: 'bot-' + name, name, isBot: true };
}
function roundEnd(taker, contractMet, extra = {}) {
  return { action: 'round_end', roundResult: { contractMet, contract: { player: taker, points: 80, suit: 'coeur' } }, ...extra };
}

// ---------------------------------------------------------------- règles

test('preneur humain : contrat réussi puis raté', () => {
  const store = newStore();
  const game = fakeGame({ sud: human('Alice'), nord: human('Bob'), est: bot('IA 1'), ouest: bot('IA 2') });
  assert.strictEqual(recordRoundOutcome(store, game, roundEnd('sud', true)), 1);
  assert.strictEqual(recordRoundOutcome(store, game, roundEnd('sud', false)), 1);
  assert.strictEqual(recordRoundOutcome(store, game, roundEnd('sud', true)), 1);
  const alice = store.get('Alice');
  assert.strictEqual(alice.contractsMade, 2);
  assert.strictEqual(alice.contractsFailed, 1);
  assert.strictEqual(alice.gamesPlayed, 0, 'une fin de manche ne compte pas de partie');
  assert.strictEqual(alice.contractRate, 0.6667);
  assert.strictEqual(store.get('Bob'), null, 'Bob n\'a pas pris : rien à compter');
});

test('preneur IA ignoré', () => {
  const store = newStore();
  const game = fakeGame({ sud: human('Alice'), est: bot('IA Règles') });
  assert.strictEqual(recordRoundOutcome(store, game, roundEnd('est', true)), 0);
  assert.strictEqual(store.size, 0);
});

test('pseudo par défaut « Joueur » ignoré (casse et espaces compris)', () => {
  const store = newStore();
  for (const name of ['Joueur', ' joueur ', 'JOUEUR', '']) {
    const game = fakeGame({ sud: human(name), nord: human('Bob') });
    recordRoundOutcome(store, game, roundEnd('sud', true));
    recordRoundOutcome(store, game, { ...roundEnd('nord', true), action: 'game_over', winner: 'ns' });
  }
  assert.deepStrictEqual(store.list().map(p => p.name), ['Bob']);
});

test('fin de partie : gagnants et perdants humains, IA ignorées', () => {
  const store = newStore();
  const game = fakeGame({ sud: human('Alice'), nord: bot('IA'), est: human('Chloé'), ouest: human('Dédé') });
  const n = recordRoundOutcome(store, game, { ...roundEnd('est', false), action: 'game_over', winner: 'ns' });
  assert.strictEqual(n, 4, '1 contrat + 3 parties');
  const alice = store.get('alice');
  assert.deepStrictEqual([alice.gamesPlayed, alice.gamesWon, alice.gamesLost, alice.winRate], [1, 1, 0, 1]);
  const chloe = store.get('CHLOÉ');
  assert.deepStrictEqual([chloe.gamesPlayed, chloe.gamesWon, chloe.gamesLost, chloe.winRate], [1, 0, 1, 0]);
  assert.strictEqual(chloe.contractsFailed, 1);
  assert.strictEqual(store.get('Dédé').gamesLost, 1);
  assert.strictEqual(store.get('IA'), null);
  assert.ok(alice.lastPlayedAt && !Number.isNaN(Date.parse(alice.lastPlayedAt)));
});

test('autres actions et entrées invalides ignorées', () => {
  const store = newStore();
  const game = fakeGame({ sud: human('Alice') });
  assert.strictEqual(recordRoundOutcome(store, game, { action: 'trick_complete' }), 0);
  assert.strictEqual(recordRoundOutcome(store, game, { action: 'round_end' }), 0);
  assert.strictEqual(recordRoundOutcome(store, game, { action: 'game_over', winner: 'xx', roundResult: {} }), 0);
  assert.strictEqual(recordRoundOutcome(store, null, roundEnd('sud', true)), 0);
  assert.strictEqual(store.size, 0);
});

test('clé insensible à la casse et aux espaces ; dernier pseudo d\'affichage conservé', () => {
  const store = newStore();
  assert.strictEqual(normalizeName('  Jean   Luc  '), 'jean luc');
  assert.strictEqual(normalizeName('Élodie'), normalizeName('Élodie'), 'NFC');
  recordRoundOutcome(store, fakeGame({ sud: human('jean  luc') }), roundEnd('sud', true));
  recordRoundOutcome(store, fakeGame({ nord: human('JEAN LUC') }), roundEnd('nord', false));
  assert.strictEqual(store.size, 1);
  const p = store.get('Jean Luc');
  assert.strictEqual(p.name, 'JEAN LUC');
  assert.strictEqual(p.contractsMade + p.contractsFailed, 2);
});

test('même pseudo dans les deux équipes : partie non comptée pour ce pseudo', () => {
  const store = newStore();
  const game = fakeGame({ sud: human('Max'), est: human('max'), nord: human('Nina') });
  recordRoundOutcome(store, game, { ...roundEnd('nord', true), action: 'game_over', winner: 'ns' });
  assert.strictEqual(store.get('Max'), null);
  assert.strictEqual(store.get('Nina').gamesWon, 1);
});

test('classement : victoires puis taux ; recherche ; limite', () => {
  const store = newStore();
  const now = new Date();
  // A : 2 victoires / 4 ; B : 2 victoires / 2 ; C : 3 victoires / 6
  const play = (name, wins, losses) => {
    for (let i = 0; i < wins; i++) store.recordGame(name, true, now);
    for (let i = 0; i < losses; i++) store.recordGame(name, false, now);
  };
  play('Alpha', 2, 2);
  play('Bravo', 2, 0);
  play('Charlie', 3, 3);
  assert.deepStrictEqual(store.list().map(p => p.name), ['Charlie', 'Bravo', 'Alpha']);
  assert.deepStrictEqual(store.list().map(p => p.rank), [1, 2, 3]);
  const found = store.list({ q: 'RAV' });
  assert.deepStrictEqual(found.map(p => [p.name, p.rank]), [['Bravo', 2]]);
  assert.strictEqual(store.list({ limit: 2 }).length, 2);
  assert.deepStrictEqual(store.list({ sort: 'winRate' }).map(p => p.name), ['Bravo', 'Charlie', 'Alpha']);
});

test('limite du nombre de joueurs : les moins récents sont oubliés', () => {
  const store = newStore(tmpFile(), { maxPlayers: 3 });
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  ['A1', 'A2', 'A3', 'A4'].forEach((name, i) => store.recordContract(name, true, new Date(t0 + i * 1000)));
  assert.strictEqual(store.size, 3);
  assert.strictEqual(store.get('A1'), null);
  assert.ok(store.get('A4'));
});

test('partie réelle (CoincheGame) : une manche jouée jusqu\'au bout', () => {
  const store = newStore();
  const game = new CoincheGame('T');
  game.addPlayer('s', 'Sam', 'sud');
  game.addPlayer('o', 'Olga', 'ouest');
  game.addPlayer('n', 'Nora', 'nord');
  game.players.est = bot('IA');
  game.startNewRound();
  const first = game.currentPlayer;
  assert.ok(game.placeBid(first, { type: 'bid', points: 80, suit: 'coeur' }).success);
  for (let i = 0; i < 3; i++) game.placeBid(game.currentPlayer, { type: 'pass' });
  game.targetScore = 1; // la première manche termine la partie
  let result = null;
  for (let guard = 0; guard < 200 && game.state === 'playing'; guard++) {
    const pos = game.currentPlayer;
    for (const card of [...game.hands[pos]]) {
      const r = game.playCard(pos, card);
      if (r.success) { result = r; break; }
    }
  }
  assert.strictEqual(result.action, 'game_over');
  recordRoundOutcome(store, game, result);
  const takerName = game.players[first].name;
  if (first !== 'est') {
    const taker = store.get(takerName);
    assert.strictEqual(taker.contractsMade + taker.contractsFailed, 1);
    assert.strictEqual(taker.contractsMade, result.roundResult.contractMet ? 1 : 0);
  }
  const humans = ['Sam', 'Olga', 'Nora'].map(n => store.get(n));
  assert.ok(humans.every(p => p.gamesPlayed === 1));
  const winners = POSITIONS.filter(p => p !== 'est' && (result.winner === 'ns' ? ['nord', 'sud'] : ['est', 'ouest']).includes(p));
  assert.strictEqual(humans.reduce((s, p) => s + p.gamesWon, 0), winners.length);
});

// ---------------------------------------------------------------- persistance

test('persistance : flush synchrone puis relecture', () => {
  const file = tmpFile();
  const store = newStore(file);
  recordRoundOutcome(store, fakeGame({ sud: human('Zoé'), nord: human('Yann') }),
    { ...roundEnd('sud', true), action: 'game_over', winner: 'ns' });
  assert.ok(store.flush());
  assert.ok(fs.existsSync(file));
  assert.deepStrictEqual(fs.readdirSync(TMP_DIR).filter(f => f.endsWith('.tmp')), [], 'pas de fichier temporaire résiduel');
  const reloaded = newStore(file);
  assert.deepStrictEqual(reloaded.get('zoé'), store.get('Zoé'));
  assert.strictEqual(reloaded.get('Yann').gamesWon, 1);
  assert.strictEqual(reloaded.updatedAt, store.updatedAt);
});

test('persistance : écriture différée (debounce) regroupée, dossier créé au besoin', async () => {
  const file = path.join(TMP_DIR, 'sous-dossier', 'stats.json');
  const store = newStore(file);
  for (let i = 0; i < 5; i++) store.recordContract('Paul', i % 2 === 0);
  assert.ok(!fs.existsSync(file), 'pas d\'écriture immédiate');
  await new Promise(r => setTimeout(r, 150));
  while (store.writing) await store.writing;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(data.players.paul.contractsMade, 3);
  assert.strictEqual(data.players.paul.contractsFailed, 2);
  assert.ok(!store.isDirty());
});

test('fichier corrompu : renommé en .corrupt-<date>, statistiques vides, pas de crash', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{"players": {"alice": ');
  const errors = [];
  const store = createStatsStore({ file, log: { error: (...a) => errors.push(a.join(' ')) } }).load();
  assert.strictEqual(store.size, 0);
  assert.ok(!fs.existsSync(file));
  const corrupt = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(path.basename(file) + '.corrupt-'));
  assert.strictEqual(corrupt.length, 1);
  assert.ok(errors.some(e => e.includes('corrompu')));
  store.recordContract('Alice', true);
  assert.ok(store.flush());
  assert.strictEqual(newStore(file).get('alice').contractsMade, 1);
});

test('fichier à la structure inattendue ou aux valeurs invalides', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '[1,2,3]');
  assert.strictEqual(newStore(file).size, 0);
  fs.writeFileSync(file, JSON.stringify({ players: {
    a: { name: 'Ana', gamesPlayed: -3, gamesWon: 'x', contractsMade: 2.7, lastPlayedAt: 'pas une date' },
    b: { name: 'Joueur', gamesPlayed: 4 },
    c: 'n\'importe quoi'
  } }));
  const store = newStore(file);
  assert.strictEqual(store.size, 1);
  const ana = store.get('ana');
  assert.deepStrictEqual([ana.gamesPlayed, ana.gamesWon, ana.contractsMade, ana.lastPlayedAt], [0, 0, 2, null]);
});

test('arrêt du process (SIGTERM / fin naturelle) : flush synchrone sans bloquer l\'arrêt', async () => {
  const storePath = path.join(__dirname, '..', 'lib', 'stats-store.js');
  const run = (file, keepAlive) => {
    const code = `
      const { createStatsStore } = require(${JSON.stringify(storePath)});
      const s = createStatsStore({ file: ${JSON.stringify(file)}, debounceMs: 60000 }).load();
      s.installExitHandlers();
      s.recordContract('Sig', true);
      ${keepAlive ? "setInterval(() => {}, 1000); console.log('ready');" : ''}
    `;
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise(r => child.once('exit', (codeOut, signal) => r({ code: codeOut, signal })));
    return { child, exited };
  };

  const fileA = tmpFile();
  const a = run(fileA, true);
  await new Promise((resolve) => a.child.stdout.once('data', resolve));
  a.child.kill('SIGTERM');
  const outA = await Promise.race([a.exited, new Promise(r => setTimeout(() => r('timeout'), 3000))]);
  assert.notStrictEqual(outA, 'timeout', 'le process ne s\'est pas arrêté');
  assert.strictEqual(outA.signal, 'SIGTERM');
  assert.strictEqual(newStore(fileA).get('sig').contractsMade, 1);

  const fileB = tmpFile();
  const b = run(fileB, false);
  const outB = await b.exited;
  assert.strictEqual(outB.code, 0);
  assert.strictEqual(newStore(fileB).get('sig').contractsMade, 1);
});

// ---------------------------------------------------------------- serveur

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(body) });
        } catch (err) {
          reject(new Error(`réponse non JSON (${res.statusCode}) : ${body.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

test('serveur : GET /api/stats renvoie du JSON valide, ?q= filtre', async () => {
  const file = tmpFile();
  const seed = newStore(file);
  const now = new Date();
  seed.recordGame('Alice', true, now);
  seed.recordGame('Alice', true, now);
  seed.recordContract('Alice', true, now);
  seed.recordGame('Bob', false, now);
  seed.recordGame('<b>Malin</b>', true, now);
  assert.ok(seed.flush());

  const port = 4000 + Math.floor(Math.random() * 900);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), STATS_FILE: file },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  server.stderr.on('data', (d) => { stderr += d.toString(); });
  try {
    let res = null;
    for (let i = 0; i < 50 && !res; i++) {
      try {
        res = await getJson(port, '/api/stats');
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    assert.ok(res, `le serveur ne répond pas.\n${stderr}`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.ok(Array.isArray(res.json.players));
    assert.ok(typeof res.json.updatedAt === 'string');
    assert.deepStrictEqual(res.json.players.map(p => p.name), ['Alice', '<b>Malin</b>', 'Bob']);
    const alice = res.json.players[0];
    for (const key of ['name', 'gamesPlayed', 'gamesWon', 'gamesLost', 'winRate', 'contractsMade', 'contractsFailed', 'contractRate', 'lastPlayedAt']) {
      assert.ok(key in alice, `champ ${key} manquant`);
    }
    assert.deepStrictEqual([alice.gamesPlayed, alice.gamesWon, alice.winRate, alice.contractRate], [2, 2, 1, 1]);

    const filtered = await getJson(port, '/api/stats?q=' + encodeURIComponent('BO'));
    assert.deepStrictEqual(filtered.json.players.map(p => p.name), ['Bob']);
    const none = await getJson(port, '/api/stats?q=zzz');
    assert.deepStrictEqual(none.json.players, []);
    const weird = await getJson(port, '/api/stats?q[]=a&q[]=b');
    assert.strictEqual(weird.status, 200);
    assert.strictEqual(weird.json.players.length, 3, 'q non texte ignoré');
  } finally {
    server.kill('SIGTERM');
    await new Promise(r => server.once('exit', r));
  }
  // L'arrêt par signal ne détruit pas le fichier.
  assert.strictEqual(newStore(file).get('alice').gamesWon, 2);
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('ok -', name);
    } catch (err) {
      failures++;
      console.error('FAIL -', name);
      console.error(err);
    }
  }
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  if (failures) {
    process.exitCode = 1;
    console.error(`\nStatistiques : ${failures} échec(s)`);
  } else {
    console.log('\nStatistiques : OK');
  }
})();
