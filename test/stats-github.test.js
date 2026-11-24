// Sauvegarde des statistiques sur GitHub : node test/stats-github.test.js
// Utilise un faux serveur d'API GitHub (en mémoire) : aucun accès réseau réel.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { createStatsStore } = require('../lib/stats-store');
const { GitHubStatsBackup, setupGitHubStatsBackup, mergeWithDeltas, mergeForRestore, readConfigFromEnv } = require('../lib/stats-github');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coinche-stats-gh-'));
const quiet = { log() {}, error() {} };
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
  }
}

// ---------------- Faux GitHub ----------------
function createFakeGitHub({ token = 'secret-token', repo = 'moi/coinche' } = {}) {
  const state = {
    refs: {}, // branch -> commit sha
    commits: {}, // sha -> { tree, parents }
    trees: {}, // sha -> { path: blobSha }
    blobs: {}, // sha -> text
    counter: 0,
    requests: 0,
    failPatchOnce: false,
    unauthorized: false,
    down: false
  };
  const newSha = (prefix) => `${prefix}${(++state.counter).toString(16).padStart(8, '0')}`;
  const prefix = `/repos/${repo}`;

  const server = http.createServer((req, res) => {
    state.requests++;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, data, raw = false) => {
        res.writeHead(status, { 'Content-Type': raw ? 'text/plain' : 'application/json' });
        res.end(raw ? data : JSON.stringify(data));
      };
      if (state.down) return send(503, { message: 'Service Unavailable' });
      if (state.unauthorized || req.headers.authorization !== `Bearer ${token}`) return send(401, { message: 'Bad credentials' });
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const json = body ? JSON.parse(body) : {};
      if (!p.startsWith(prefix)) return send(404, { message: 'Not Found' });
      const rest = p.slice(prefix.length);

      let m;
      if (req.method === 'GET' && (m = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
        const sha = state.refs[decodeURIComponent(m[1])];
        return sha ? send(200, { object: { sha } }) : send(404, { message: 'Not Found' });
      }
      if (req.method === 'GET' && (m = rest.match(/^\/contents\/(.+)$/))) {
        const branch = url.searchParams.get('ref');
        const head = state.refs[branch];
        if (!head) return send(404, { message: 'No commit found for the ref' });
        const blob = state.trees[state.commits[head].tree][decodeURIComponent(m[1])];
        return blob ? send(200, state.blobs[blob], true) : send(404, { message: 'Not Found' });
      }
      if (req.method === 'POST' && rest === '/git/blobs') {
        const sha = newSha('b');
        state.blobs[sha] = Buffer.from(json.content, 'base64').toString('utf8');
        return send(201, { sha });
      }
      if (req.method === 'POST' && rest === '/git/trees') {
        const sha = newSha('t');
        state.trees[sha] = Object.fromEntries(json.tree.map(e => [e.path, e.sha]));
        return send(201, { sha });
      }
      if (req.method === 'POST' && rest === '/git/commits') {
        const sha = newSha('c');
        state.commits[sha] = { tree: json.tree, parents: json.parents };
        return send(201, { sha });
      }
      if (req.method === 'PATCH' && (m = rest.match(/^\/git\/refs\/heads\/(.+)$/))) {
        const branch = decodeURIComponent(m[1]);
        if (state.failPatchOnce) {
          state.failPatchOnce = false;
          return send(422, { message: 'Update is not a fast forward' });
        }
        const commit = state.commits[json.sha];
        if (!commit || !commit.parents.includes(state.refs[branch])) return send(422, { message: 'Update is not a fast forward' });
        state.refs[branch] = json.sha;
        return send(200, { object: { sha: json.sha } });
      }
      if (req.method === 'POST' && rest === '/git/refs') {
        const branch = json.ref.replace('refs/heads/', '');
        if (state.refs[branch]) return send(422, { message: 'Reference already exists' });
        state.refs[branch] = json.sha;
        return send(201, { object: { sha: json.sha } });
      }
      return send(404, { message: 'Not Found' });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const api = `http://127.0.0.1:${server.address().port}`;
      resolve({
        state,
        api,
        token,
        repo,
        close: () => new Promise(r => server.close(r)),
        remoteData(branch = 'stats-data', file = 'stats.json') {
          const head = state.refs[branch];
          if (!head) return null;
          return JSON.parse(state.blobs[state.trees[state.commits[head].tree][file]]);
        }
      });
    });
  });
}

function newStore(name) {
  return createStatsStore({ file: path.join(TMP, `${name}.json`), log: quiet, debounceMs: 60000 });
}

function makeBackup(store, gh, extra = {}) {
  return new GitHubStatsBackup(store, {
    token: gh.token,
    repo: gh.repo,
    branch: 'stats-data',
    path: 'stats.json',
    syncMs: 60000,
    apiUrl: gh.api,
    ...extra
  }, { log: quiet });
}

(async () => {
  await test('configuration : désactivée sans token, repo invalide refusé', () => {
    assert.strictEqual(readConfigFromEnv({}), null);
    assert.strictEqual(readConfigFromEnv({ STATS_GITHUB_TOKEN: 'x' }), null);
    assert.throws(() => readConfigFromEnv({ STATS_GITHUB_TOKEN: 'x', STATS_GITHUB_REPO: 'pas un repo' }));
    const c = readConfigFromEnv({ STATS_GITHUB_TOKEN: ' x ', STATS_GITHUB_REPO: 'a/b', STATS_GITHUB_SYNC_MINUTES: '2' });
    assert.strictEqual(c.token, 'x');
    assert.strictEqual(c.branch, 'stats-data');
    assert.strictEqual(c.syncMs, 2 * 60 * 1000);
    assert.strictEqual(setupGitHubStatsBackup(newStore('cfg'), { env: {}, log: quiet }), null);
  });

  await test('fusion : distant + (local - base), jamais négatif', () => {
    const e = (name, won) => ({ name, gamesPlayed: won, gamesWon: won, gamesLost: 0, contractsMade: 0, contractsFailed: 0, lastPlayedAt: null });
    const merged = mergeWithDeltas({ alice: e('Alice', 5), bob: e('Bob', 1) }, { alice: e('Alice', 4), carl: e('Carl', 2) }, { alice: e('Alice', 3) });
    assert.strictEqual(merged.alice.gamesWon, 6); // 5 distant + 1 local
    assert.strictEqual(merged.bob.gamesWon, 1); // inconnu localement : conservé
    assert.strictEqual(merged.carl.gamesWon, 2); // nouveau localement
    const restored = mergeForRestore({ alice: e('Alice', 10) }, { alice: e('Alice', 3) }, { alice: e('Alice', 5) });
    assert.strictEqual(restored.alice.gamesWon, 12); // max(10, 3) + 2 joués depuis le démarrage
  });

  const gh = await createFakeGitHub();

  await test('premier envoi : crée la branche stats-data avec stats.json', async () => {
    const store = newStore('a');
    const backup = makeBackup(store, gh);
    assert.ok(await backup.restore()); // distant vide
    store.recordContract('Alice', true);
    store.recordGame('Alice', true);
    assert.ok(await backup.sync());
    const data = gh.remoteData();
    assert.strictEqual(data.players.alice.contractsMade, 1);
    assert.strictEqual(data.players.alice.gamesWon, 1);
    assert.strictEqual(gh.state.commits[gh.state.refs['stats-data']].parents.length, 0); // branche indépendante
    assert.strictEqual(backup.needsSync(), false);
    assert.ok(await backup.sync()); // rien à envoyer : aucun commit
    assert.strictEqual(Object.keys(gh.state.commits).length, 1);
  });

  await test('nouveau serveur (dyno redémarré, disque vide) : statistiques rechargées', async () => {
    const store = newStore('b-vide');
    const backup = makeBackup(store, gh);
    assert.ok(await backup.restore());
    assert.strictEqual(store.get('alice').gamesWon, 1);
    assert.strictEqual(store.get('ALICE').contractsMade, 1);
    assert.strictEqual(backup.needsSync(), false);
  });

  await test('deux serveurs en même temps (déploiement) : aucun progrès perdu', async () => {
    const s1 = newStore('c1');
    const s2 = newStore('c2');
    const b1 = makeBackup(s1, gh);
    const b2 = makeBackup(s2, gh);
    await b1.restore();
    await b2.restore();
    s1.recordGame('Alice', true); // ancien serveur
    s2.recordContract('Alice', false); // nouveau serveur
    s2.recordGame('Bob', false);
    assert.ok(await b1.sync());
    assert.ok(await b2.sync());
    const p = gh.remoteData().players;
    assert.strictEqual(p.alice.gamesWon, 2);
    assert.strictEqual(p.alice.contractsMade, 1);
    assert.strictEqual(p.alice.contractsFailed, 1);
    assert.strictEqual(p.bob.gamesLost, 1);
    // Le premier serveur récupère aussi les progrès du second au prochain envoi.
    s1.recordGame('Carl', true);
    assert.ok(await b1.sync());
    const p2 = gh.remoteData().players;
    assert.strictEqual(p2.alice.gamesWon, 2);
    assert.strictEqual(p2.bob.gamesLost, 1);
    assert.strictEqual(p2.carl.gamesWon, 1);
  });

  await test('branche modifiée pendant l\'envoi : nouvel essai sans doublon', async () => {
    const store = newStore('d');
    const backup = makeBackup(store, gh);
    await backup.restore();
    const before = gh.remoteData().players.alice.gamesWon;
    store.recordGame('Alice', true);
    gh.state.failPatchOnce = true;
    assert.ok(await backup.sync());
    assert.strictEqual(gh.remoteData().players.alice.gamesWon, before + 1);
  });

  await test('jeton refusé : erreur signalée, pas de plantage, pas de nouvel essai', async () => {
    const store = newStore('e');
    const backup = makeBackup(store, gh, { token: 'mauvais' });
    assert.strictEqual(await backup.restore(), false);
    assert.match(backup.status.lastError, /401/);
    const n = gh.state.requests;
    store.recordGame('Zed', true);
    assert.strictEqual(await backup.sync(), false); // restauration impossible -> pas d'envoi
    assert.ok(gh.state.requests - n <= 1);
  });

  await test('GitHub indisponible au démarrage : rien envoyé, puis rattrapage sans doublon', async () => {
    const store = newStore('f');
    const backup = makeBackup(store, gh);
    gh.state.down = true;
    assert.strictEqual(await backup.restore(), false);
    const remoteBefore = gh.remoteData().players.alice.gamesWon;
    store.recordGame('Alice', true); // partie jouée pendant la panne
    assert.strictEqual(await backup.sync(), false);
    gh.state.down = false;
    assert.ok(await backup.sync()); // restaure puis envoie
    assert.strictEqual(gh.remoteData().players.alice.gamesWon, remoteBefore + 1);
    assert.strictEqual(store.get('alice').gamesWon, remoteBefore + 1);
  });

  await test('arrêt SIGTERM (comme Heroku) : dernier envoi avant de quitter', async () => {
    const file = path.join(TMP, 'sigterm.json');
    const script = `
      const { createStatsStore } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'stats-store'))});
      const { setupGitHubStatsBackup } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'stats-github'))});
      const store = createStatsStore({ file: ${JSON.stringify(file)}, debounceMs: 60000 }).load();
      store.installExitHandlers();
      const backup = setupGitHubStatsBackup(store);
      backup.ready.then(() => {
        store.recordGame('Sigterm', true);
        process.stdout.write('pret\\n');
      });
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['-e', script], {
      env: { ...process.env, STATS_GITHUB_TOKEN: gh.token, STATS_GITHUB_REPO: gh.repo, STATS_GITHUB_API: gh.api },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('processus pas prêt : ' + stderr)), 8000);
      child.stdout.on('data', (d) => { if (String(d).includes('pret')) { clearTimeout(t); resolve(); } });
    });
    child.kill('SIGTERM');
    const code = await new Promise((resolve) => child.on('exit', (c, sig) => resolve(c ?? sig)));
    assert.strictEqual(code, 143);
    assert.strictEqual(gh.remoteData().players.sigterm.gamesWon, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).players.sigterm.gamesWon, 1); // fichier local aussi
  });

  await gh.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `\n${failed} échec(s)` : `\nSauvegarde GitHub : OK (${passed} tests)`);
  if (failed) process.exitCode = 1;
})();
