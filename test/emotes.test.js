// Tests des emotes en image : node test/emotes.test.js
// 1) Validation des PNG (lib/emotes.js) sur des fichiers générés à la volée.
// 2) Les emotes livrées dans public/emotes/ sont toutes valides.
// 3) Serveur réel : GET /api/emotes, diffusion dans la salle, id inconnu, anti-spam, joueur hors salle.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const {
  validatePngBuffer, scanEmotes, createEmoteRegistry, isValidEmoteId, labelFromId, MAX_EMOTE_BYTES
} = require('../lib/emotes');

const ROOT = path.join(__dirname, '..');
const SHIPPED = ['gg', 'bravo', 'rire', 'colere', 'coeur', 'oups', 'coinche', 'dodo'];

function ok(name) {
  console.log('  ok  -', name);
}

// ---------------------------------------------------------------- PNG minimal

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Image unie (pixels à zéro = transparents si alpha) au format demandé.
function makePng({ width = 256, height = 256, colorType = 6, trns = false } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = colorType;
  const rowBytes = 1 + width * CHANNELS[colorType];
  const raw = Buffer.alloc(rowBytes * height);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (colorType === 3) parts.push(chunk('PLTE', Buffer.from([0, 0, 0, 255, 201, 74])));
  if (trns) parts.push(chunk('tRNS', Buffer.from([0])));
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND'));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- serveur

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false, timeout: 3000 });
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

// Collecte les événements reçus pendant `ms` millisecondes.
function collect(socket, event, ms) {
  const got = [];
  const handler = (d) => got.push(d);
  socket.on(event, handler);
  return wait(ms).then(() => {
    socket.off(event, handler);
    return got;
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, type: res.headers['content-type'], json: JSON.parse(body) });
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------- tests

function testValidation() {
  assert.deepStrictEqual(validatePngBuffer(makePng({ colorType: 6 })).ok, true);
  assert.deepStrictEqual(validatePngBuffer(makePng({ colorType: 4 })).ok, true);
  assert.deepStrictEqual(validatePngBuffer(makePng({ colorType: 3, trns: true })).ok, true);
  ok('PNG 256x256 valides : RGBA, gris + alpha, palette + tRNS');

  let r = validatePngBuffer(makePng({ width: 128, height: 128 }));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /128x128/);
  r = validatePngBuffer(makePng({ width: 256, height: 255 }));
  assert.strictEqual(r.ok, false);
  ok('mauvaise taille refusée');

  r = validatePngBuffer(makePng({ colorType: 2 }));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /alpha/);
  r = validatePngBuffer(makePng({ colorType: 0 }));
  assert.strictEqual(r.ok, false);
  r = validatePngBuffer(makePng({ colorType: 3, trns: false }));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /tRNS/);
  ok('pas de transparence refusé (RGB, gris, palette sans tRNS)');

  r = validatePngBuffer(Buffer.from('ceci n\'est pas une image, juste du texte assez long pour passer'));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /signature/);
  assert.strictEqual(validatePngBuffer(Buffer.alloc(4)).ok, false);
  assert.strictEqual(validatePngBuffer(null).ok, false);
  ok('fichier qui n\'est pas un PNG refusé');

  assert.ok(isValidEmoteId('gg') && isValidEmoteId('coup-de_coeur2'));
  for (const bad of ['', 'GG', 'a b', '../gg', 'gg.png', 'été', 'x'.repeat(41), 42, null]) {
    assert.strictEqual(isValidEmoteId(bad), false, `id ${bad} accepté`);
  }
  assert.strictEqual(labelFromId('coup-de_coeur'), 'Coup de coeur');
  ok('identifiants et libellés par défaut');
}

function testScanDirectory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coinche-emotes-'));
  try {
    fs.writeFileSync(path.join(dir, 'ok.png'), makePng());
    fs.writeFileSync(path.join(dir, 'coup-de_coeur.png'), makePng({ colorType: 3, trns: true }));
    fs.writeFileSync(path.join(dir, 'petit.png'), makePng({ width: 64, height: 64 }));
    fs.writeFileSync(path.join(dir, 'opaque.png'), makePng({ colorType: 2 }));
    fs.writeFileSync(path.join(dir, 'texte.png'), 'pas un png du tout, vraiment pas, non non non');
    fs.writeFileSync(path.join(dir, 'Mauvais Nom.png'), makePng());
    fs.writeFileSync(path.join(dir, 'MAJ.PNG'), makePng());
    fs.writeFileSync(path.join(dir, 'lourd.png'), Buffer.concat([makePng(), Buffer.alloc(MAX_EMOTE_BYTES)]));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignoré sans avertissement');
    fs.writeFileSync(path.join(dir, 'emotes.json'), JSON.stringify({ ok: 'Super !', petit: 'Petit' }));

    const warnings = [];
    const { valid, invalid } = scanEmotes(dir, { warn: (m) => warnings.push(m) });
    assert.deepStrictEqual(valid.map(e => e.id), ['ok', 'coup-de_coeur']); // ordre de emotes.json d'abord
    assert.deepStrictEqual(valid[0], { id: 'ok', label: 'Super !', url: '/emotes/ok.png', file: 'ok.png' });
    assert.strictEqual(valid[1].label, 'Coup de coeur');
    const reasons = Object.fromEntries(invalid.map(f => [f.file, f.reason]));
    assert.deepStrictEqual(Object.keys(reasons).sort(),
      ['MAJ.PNG', 'Mauvais Nom.png', 'lourd.png', 'opaque.png', 'petit.png', 'texte.png']);
    assert.match(reasons['Mauvais Nom.png'], /nom invalide/);
    assert.match(reasons['MAJ.PNG'], /nom invalide/);
    assert.match(reasons['lourd.png'], /trop lourd/);
    assert.match(reasons['petit.png'], /64x64/);
    assert.match(reasons['opaque.png'], /alpha/);
    assert.match(reasons['texte.png'], /PNG/);
    assert.strictEqual(warnings.length, invalid.length);
    assert.ok(warnings.every(w => w.startsWith('[emotes]')));
    ok('scan d\'un dossier : valides, invalides avec raison, libellés de emotes.json');

    fs.writeFileSync(path.join(dir, 'emotes.json'), '{ pas du json');
    const w2 = [];
    const res2 = scanEmotes(dir, { warn: (m) => w2.push(m) });
    assert.strictEqual(res2.valid.find(e => e.id === 'ok').label, 'Ok');
    assert.ok(w2.some(m => /emotes\.json/.test(m)));
    ok('emotes.json invalide : avertissement et libellés par défaut');

    // Registre : rescan quand le dossier change.
    const registry = createEmoteRegistry(dir, { warn: () => {}, checkIntervalMs: 0 });
    assert.strictEqual(registry.has('nouvelle'), false);
    fs.writeFileSync(path.join(dir, 'nouvelle.png'), makePng({ colorType: 4 }));
    assert.strictEqual(registry.has('nouvelle'), true);
    fs.unlinkSync(path.join(dir, 'ok.png'));
    assert.strictEqual(registry.has('ok'), false);
    assert.strictEqual(registry.has('../ok'), false);
    assert.ok(registry.list().some(e => e.id === 'nouvelle'));
    ok('registre : rescan quand le dossier change');

    const missing = createEmoteRegistry(path.join(dir, 'absent'), { warn: () => {} });
    assert.deepStrictEqual(missing.list(), []);
    ok('dossier absent : aucune emote, pas d\'erreur');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testShippedEmotes() {
  const { valid, invalid } = scanEmotes(path.join(ROOT, 'public', 'emotes'));
  assert.deepStrictEqual(invalid, [], `emotes invalides : ${JSON.stringify(invalid)}`);
  const ids = valid.map(e => e.id);
  for (const id of SHIPPED) assert.ok(ids.includes(id), `emote ${id} manquante`);
  ok(`les ${valid.length} emotes livrées sont valides`);
}

async function testServer() {
  const port = 4000 + Math.floor(Math.random() * 900);
  const url = `http://localhost:${port}`;
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let exited = null;
  let stderr = '';
  server.on('exit', (code) => { exited = code; });
  server.stderr.on('data', (d) => { stderr += d.toString(); });
  const sockets = [];

  try {
    for (let i = 0; i < 50; i++) {
      try {
        const s = await connect(url);
        s.close();
        break;
      } catch {
        await wait(100);
      }
    }

    // GET /api/emotes
    const res = await getJson(`${url}/api/emotes`);
    assert.strictEqual(res.status, 200);
    assert.match(res.type, /json/);
    assert.ok(Array.isArray(res.json.emotes));
    for (const id of SHIPPED) {
      const e = res.json.emotes.find(x => x.id === id);
      assert.ok(e, `emote ${id} absente de /api/emotes`);
      assert.strictEqual(e.url, `/emotes/${id}.png`);
      assert.strictEqual(typeof e.label, 'string');
    }
    assert.strictEqual(res.json.emotes.find(x => x.id === 'gg').label, 'GG');
    ok('GET /api/emotes');

    // Deux joueurs dans la même salle + un joueur dans une autre salle.
    const alice = await connect(url);
    const bob = await connect(url);
    const carol = await connect(url);
    const outsider = await connect(url);
    sockets.push(alice, bob, carol, outsider);

    const aliceRoom = once(alice, 'room-created');
    alice.emit('create-room', { name: 'Alice', position: 'sud' });
    const { roomId } = await aliceRoom;
    const bobJoined = once(bob, 'room-joined');
    bob.emit('join-room', { name: 'Bob', roomId, position: 'nord' });
    await bobJoined;
    const carolRoom = once(carol, 'room-created');
    carol.emit('create-room', { name: 'Carol', position: 'est' });
    await carolRoom;

    // Émission diffusée à toute la salle avec la position de l'émetteur.
    const carolSees = collect(carol, 'emote', 400);
    const toAlice = once(alice, 'emote');
    const toBob = once(bob, 'emote');
    alice.emit('emote', { id: 'gg' });
    assert.deepStrictEqual(await toAlice, { position: 'sud', id: 'gg' });
    assert.deepStrictEqual(await toBob, { position: 'sud', id: 'gg' });
    assert.deepStrictEqual(await carolSees, [], 'une autre salle a reçu l\'emote');
    const fromBob = once(alice, 'emote');
    bob.emit('emote', { id: 'coeur' });
    assert.deepStrictEqual(await fromBob, { position: 'nord', id: 'coeur' });
    ok('emote diffusée aux joueurs de la salle avec la bonne position (et pas ailleurs)');

    // Anti-spam : une deuxième emote dans la foulée est ignorée, puis acceptée après 1,5 s.
    await wait(1600);
    const first = once(bob, 'emote');
    alice.emit('emote', { id: 'rire' });
    assert.deepStrictEqual(await first, { position: 'sud', id: 'rire' });
    const spam = collect(bob, 'emote', 500);
    alice.emit('emote', { id: 'oups' });
    alice.emit('emote', { id: 'dodo' });
    assert.deepStrictEqual(await spam, [], 'le spam d\'emotes n\'est pas limité');
    await wait(1100);
    const later = once(bob, 'emote');
    alice.emit('emote', { id: 'bravo' });
    assert.deepStrictEqual(await later, { position: 'sud', id: 'bravo' });
    ok('anti-spam : 1 emote / 1,5 s par joueur');

    // Id inconnu ou invalide : refusé avec un message, rien n'est diffusé.
    await wait(1600);
    for (const bad of [{ id: 'inexistante' }, { id: '../server' }, { id: 42 }, {}, null, 'gg']) {
      const err = once(alice, 'error-msg');
      const none = collect(bob, 'emote', 150);
      alice.emit('emote', bad);
      assert.match((await err).message, /inconnue/);
      assert.deepStrictEqual(await none, []);
    }
    // ... et un id refusé ne consomme pas le délai anti-spam.
    const afterBad = once(bob, 'emote');
    alice.emit('emote', { id: 'coinche' });
    assert.deepStrictEqual(await afterBad, { position: 'sud', id: 'coinche' });
    ok('id d\'emote inconnu ou invalide refusé');

    // Joueur hors salle : refusé.
    const outErr = once(outsider, 'error-msg');
    const nobody = collect(bob, 'emote', 300);
    outsider.emit('emote', { id: 'gg' });
    assert.match((await outErr).message, /table/);
    assert.deepStrictEqual(await nobody, []);
    // Après avoir quitté la salle, plus d'emote possible.
    await wait(1600);
    bob.emit('leave-room');
    await wait(200);
    const leftErr = once(bob, 'error-msg');
    bob.emit('emote', { id: 'gg' });
    assert.match((await leftErr).message, /table/);
    ok('joueur hors salle refusé');

    assert.strictEqual(exited, null, `le serveur s'est arrêté.\n${stderr}`);
  } finally {
    for (const s of sockets) s.close();
    server.kill();
  }
}

async function main() {
  testValidation();
  testScanDirectory();
  testShippedEmotes();
  await testServer();
  console.log('\nEmotes : OK');
}

main().catch((err) => {
  console.error('  FAIL -', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
