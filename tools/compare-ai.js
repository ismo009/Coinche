#!/usr/bin/env node
// ============================================================
// Compare l'IA "règles" à l'IA "legacy" sur des donnes identiques.
//
//   npm run compare-ai                 (200 paires de parties de 12 manches)
//   node tools/compare-ai.js 500       (500 paires)
//   node tools/compare-ai.js 200 1234  (graine différente)
//
// Chaque donne est jouée deux fois en échangeant les équipes (NS=règles puis
// EO=règles), ce qui annule la chance des cartes. Le résultat est l'écart moyen
// de points (règles - legacy) sur 12 manches, avec son erreur type :
// un écart inférieur à ~2 erreurs types n'est pas significatif.
// ============================================================
const { CoincheGame, getTeam } = require('../game');
const ruleBot = require('../ai/rule-bot');
const legacyBot = require('../ai/coinche-bot');

const PAIRS = Math.max(1, parseInt(process.argv[2], 10) || 200);
const SEED = parseInt(process.argv[3], 10) || 1000;
const ROUNDS = 12;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playMatch(seed, ruleTeam) {
  const game = new CoincheGame('CMP');
  game.targetScore = Infinity;
  for (const p of ['sud', 'ouest', 'nord', 'est']) game.addPlayer(p, p, p);
  // Les donnes dépendent uniquement de la graine (pas des décisions des IA).
  const dealRng = mulberry32(seed);
  const startRound = game.startNewRound.bind(game);
  game.startNewRound = () => {
    const r = Math.random;
    Math.random = dealRng;
    try { startRound(); } finally { Math.random = r; }
  };
  const botFor = (p) => (getTeam(p) === ruleTeam ? ruleBot : legacyBot);

  game.startNewRound();
  let rounds = 0;
  let guard = 0;
  while (rounds < ROUNDS && guard++ < 20000) {
    if (game.state === 'scoring') {
      rounds++;
      if (rounds < ROUNDS) game.startNewRound();
      continue;
    }
    const pos = game.currentPlayer;
    if (game.state === 'bidding') {
      const r = game.placeBid(pos, botFor(pos).chooseBid(game));
      if (!r.success) game.placeBid(pos, { type: 'pass' });
      else if (r.action === 'redistribute') game.startNewRound();
      continue;
    }
    const r = game.playCard(pos, botFor(pos).chooseCard(game, pos));
    if (!r.success) throw new Error(`coup illégal (${pos}) : ${r.error}`);
  }
  const other = ruleTeam === 'ns' ? 'eo' : 'ns';
  return game.scores[ruleTeam] - game.scores[other];
}

const t0 = Date.now();
const diffs = [];
for (let i = 0; i < PAIRS; i++) {
  const d = (playMatch(SEED + i, 'ns') + playMatch(SEED + i, 'eo')) / 2;
  diffs.push(d);
  if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${PAIRS} paires...\n`);
}
const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
const se = sd / Math.sqrt(diffs.length);
console.log(`\nRègles - Legacy : ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} points / ${ROUNDS} manches (erreur type ${se.toFixed(1)}, ${PAIRS} paires, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
if (Math.abs(mean) < 2 * se) console.log('=> Pas de différence significative.');
else console.log(mean > 0 ? '=> L\'IA règles est meilleure.' : '=> L\'IA legacy est meilleure.');
