// Tests de non-régression (sans dépendance) : node test/run-tests.js
const assert = require('assert');
const { CoincheGame, getTeam } = require('../game');
const bot = require('../ai/coinche-bot');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  -', name); }
  catch (e) { console.error('  FAIL -', name); console.error(e); process.exitCode = 1; }
}
const C = (rank, suit) => ({ rank, suit });

function newGame() {
  const g = new CoincheGame('T');
  for (const p of ['sud', 'ouest', 'nord', 'est']) g.addPlayer('id-' + p, p, p);
  return g;
}

// Met la partie en phase de jeu avec des mains et un contrat imposés.
function setupPlaying({ hands, contract, dealer = 'sud', leader }) {
  const g = newGame();
  g.dealer = dealer;
  g.startNewRound();
  g.hands = JSON.parse(JSON.stringify(hands));
  g.contract = { team: getTeam(contract.player), coinched: false, surcoinched: false, ...contract };
  g.lastBidder = contract.player;
  g.startPlaying();
  if (leader) g.currentPlayer = leader;
  return g;
}

console.log('Règles');

test('le joueur après le donneur entame normalement', () => {
  const g = newGame();
  g.dealer = 'sud';
  g.startNewRound();
  assert.strictEqual(g.currentPlayer, 'ouest');
  g.placeBid('ouest', { type: 'bid', points: 80, suit: 'coeur' });
  g.placeBid('nord', { type: 'pass' });
  g.placeBid('est', { type: 'pass' });
  const r = g.placeBid('sud', { type: 'pass' });
  assert.strictEqual(r.action, 'play');
  assert.strictEqual(g.currentPlayer, 'ouest');
});

test('générale : l\'annonceur entame même si ce n\'est pas son tour', () => {
  const g = newGame();
  g.dealer = 'sud';
  g.startNewRound();
  g.placeBid('ouest', { type: 'pass' });
  g.placeBid('nord', { type: 'pass' });
  g.placeBid('est', { type: 'bid', points: 500, suit: 'pique' });
  g.placeBid('sud', { type: 'pass' });
  g.placeBid('ouest', { type: 'pass' });
  const r = g.placeBid('nord', { type: 'pass' });
  assert.strictEqual(r.action, 'play');
  assert.strictEqual(g.contract.points, 500);
  assert.strictEqual(g.currentPlayer, 'est');
});

test('générale surcoinchée : l\'annonceur entame aussi', () => {
  const g = newGame();
  g.dealer = 'est';
  g.startNewRound(); // sud ouvre
  g.placeBid('sud', { type: 'pass' });
  g.placeBid('ouest', { type: 'bid', points: 500, suit: 'tout-atout' });
  g.placeBid('nord', { type: 'coinche' });
  const r = g.placeBid('est', { type: 'surcoinche' });
  assert.strictEqual(r.action, 'play');
  assert.strictEqual(g.currentPlayer, 'ouest');
});

test('coinche hors tour : un adversaire peut coincher sans attendre son tour', () => {
  const g = newGame();
  g.dealer = 'sud';
  g.startNewRound(); // ouest ouvre
  g.placeBid('ouest', { type: 'bid', points: 90, suit: 'trefle' });
  assert.strictEqual(g.currentPlayer, 'nord');
  // Est (partenaire d'ouest) ne peut pas coincher son partenaire.
  assert.strictEqual(g.placeBid('est', { type: 'coinche' }).success, false);
  // Sud (adversaire) coinche alors que c'est à Nord de parler.
  const r = g.placeBid('sud', { type: 'coinche' });
  assert.ok(r.success, r.error);
  assert.strictEqual(g.coincheBy, 'sud');
  assert.strictEqual(g.currentPlayer, 'ouest'); // la parole revient au joueur après le coincheur
  // Une enchère ou un passe restent soumis au tour.
  assert.strictEqual(g.placeBid('nord', { type: 'pass' }).success, false);
  // Pas de double coinche.
  assert.strictEqual(g.placeBid('nord', { type: 'coinche' }).success, false);
  g.placeBid('ouest', { type: 'pass' });
  g.placeBid('nord', { type: 'pass' });
  const end = g.placeBid('est', { type: 'pass' });
  assert.strictEqual(end.action, 'play');
  assert.strictEqual(g.contract.coinched, true);
  assert.strictEqual(g.contract.player, 'ouest');
});

test('surcoinche hors tour par l\'équipe coinchée ; coinche impossible sans enchère', () => {
  const g = newGame();
  g.dealer = 'sud';
  g.startNewRound();
  assert.strictEqual(g.placeBid('nord', { type: 'coinche' }).success, false); // aucune enchère
  g.placeBid('ouest', { type: 'bid', points: 80, suit: 'pique' });
  assert.ok(g.placeBid('nord', { type: 'coinche' }).success);
  // Les adversaires (coincheurs) ne peuvent pas surcoincher.
  assert.strictEqual(g.placeBid('sud', { type: 'surcoinche' }).success, false);
  // Ouest surcoinche alors que c'est à Est de parler.
  assert.strictEqual(g.currentPlayer, 'est');
  const r = g.placeBid('ouest', { type: 'surcoinche' });
  assert.strictEqual(r.action, 'play');
  assert.strictEqual(g.contract.surcoinched, true);
});

test('dealId est incrémenté à chaque distribution et exposé au client', () => {
  const g = newGame();
  g.startNewRound();
  const first = g.getStateForPlayer('sud').dealId;
  g.startNewRound();
  assert.strictEqual(g.getStateForPlayer('sud').dealId, first + 1);
});

test('fournir / monter à l\'atout / couper / pisser / partenaire maître', () => {
  const hands = {
    sud: [C('7', 'coeur'), C('as', 'pique'), C('8', 'pique'), C('7', 'trefle'), C('8', 'trefle'), C('9', 'trefle'), C('10', 'trefle'), C('roi', 'trefle')],
    ouest: [C('valet', 'coeur'), C('9', 'coeur'), C('7', 'pique'), C('9', 'pique'), C('10', 'pique'), C('dame', 'trefle'), C('valet', 'trefle'), C('as', 'trefle')],
    nord: [C('8', 'coeur'), C('dame', 'coeur'), C('roi', 'coeur'), C('valet', 'pique'), C('dame', 'pique'), C('roi', 'pique'), C('7', 'carreau'), C('8', 'carreau')],
    est: [C('10', 'coeur'), C('as', 'coeur'), C('9', 'carreau'), C('10', 'carreau'), C('valet', 'carreau'), C('dame', 'carreau'), C('roi', 'carreau'), C('as', 'carreau')]
  };
  const g = setupPlaying({ hands, contract: { player: 'sud', points: 80, suit: 'coeur' }, dealer: 'est', leader: 'sud' });
  // Sud entame pique (as) ; Ouest doit fournir pique.
  assert.ok(g.playCard('sud', C('as', 'pique')).success);
  const st = g.getStateForPlayer('ouest');
  assert.ok(st.playableCards.every(c => c.suit === 'pique'));
  assert.ok(g.playCard('ouest', C('7', 'pique')).success);
  // Nord : fournit pique.
  assert.ok(g.playCard('nord', C('dame', 'pique')).success);
  // Est n'a pas de pique, partenaire (ouest) pas maître -> doit couper.
  const stEst = g.getStateForPlayer('est');
  assert.ok(stEst.playableCards.length > 0 && stEst.playableCards.every(c => c.suit === 'coeur'));
  assert.strictEqual(g.playCard('est', C('roi', 'carreau')).success, false);
  assert.ok(g.playCard('est', C('10', 'coeur')).success);
});

console.log('IA - appels');

test('analyzeSignals détecte la 1re défausse faible comme appel', () => {
  const history = [
    { roundNumber: 1, trickNumber: 1, indexInTrick: 0, player: 'sud', card: C('as', 'trefle') },
    { roundNumber: 1, trickNumber: 1, indexInTrick: 1, player: 'ouest', card: C('7', 'trefle') },
    { roundNumber: 1, trickNumber: 1, indexInTrick: 2, player: 'nord', card: C('8', 'pique') }, // défausse faible
    { roundNumber: 1, trickNumber: 1, indexInTrick: 3, player: 'est', card: C('9', 'trefle') }
  ];
  const info = bot.analyzeSignals(history, 'coeur');
  assert.deepStrictEqual(info.signals.nord.suit, 'pique');
  assert.strictEqual(info.signals.nord.active, true);
  assert.ok(info.voids.nord.has('trefle'));
});

test('une coupe n\'est pas un appel ; un appel est consommé quand la couleur est rejouée', () => {
  const history = [
    { roundNumber: 1, trickNumber: 1, indexInTrick: 0, player: 'sud', card: C('as', 'trefle') },
    { roundNumber: 1, trickNumber: 1, indexInTrick: 1, player: 'ouest', card: C('7', 'coeur') }, // coupe
    { roundNumber: 1, trickNumber: 1, indexInTrick: 2, player: 'nord', card: C('8', 'pique') },
    { roundNumber: 1, trickNumber: 1, indexInTrick: 3, player: 'est', card: C('9', 'trefle') },
    { roundNumber: 1, trickNumber: 2, indexInTrick: 0, player: 'ouest', card: C('7', 'pique') },
    { roundNumber: 1, trickNumber: 2, indexInTrick: 1, player: 'nord', card: C('as', 'pique') },
    { roundNumber: 1, trickNumber: 2, indexInTrick: 2, player: 'est', card: C('9', 'pique') },
    { roundNumber: 1, trickNumber: 2, indexInTrick: 3, player: 'sud', card: C('10', 'pique') }
  ];
  const info = bot.analyzeSignals(history, 'coeur');
  assert.strictEqual(info.signals.ouest, undefined);
  assert.strictEqual(info.signals.nord.active, false);
});

test('l\'IA fait un appel (petite carte de sa couleur maîtresse) à sa 1re défausse', () => {
  // Contrat coeur pour E-O. Nord (IA) n'a plus de trèfle, son partenaire Sud est maître.
  const hands = {
    sud: [C('as', 'trefle'), C('8', 'coeur'), C('7', 'carreau'), C('8', 'carreau'), C('9', 'carreau'), C('10', 'trefle'), C('roi', 'trefle'), C('dame', 'trefle')],
    ouest: [C('7', 'trefle'), C('valet', 'coeur'), C('9', 'coeur'), C('as', 'coeur'), C('10', 'coeur'), C('roi', 'carreau'), C('dame', 'carreau'), C('valet', 'carreau')],
    nord: [C('as', 'pique'), C('7', 'pique'), C('roi', 'pique'), C('dame', 'pique'), C('7', 'coeur'), C('10', 'carreau'), C('as', 'carreau'), C('valet', 'pique')],
    est: [C('8', 'trefle'), C('9', 'trefle'), C('valet', 'trefle'), C('roi', 'coeur'), C('dame', 'coeur'), C('8', 'pique'), C('9', 'pique'), C('10', 'pique')]
  };
  const g = setupPlaying({ hands, contract: { player: 'ouest', points: 80, suit: 'coeur' }, dealer: 'est', leader: 'sud' });
  g.playCard('sud', C('as', 'trefle'));
  g.playCard('ouest', C('7', 'trefle'));
  // Nord n'a pas de trèfle, partenaire maître -> peut défausser. Maître à pique (as) et
  // à carreau (as) : il doit appeler avec la plus petite carte (7 de pique ici).
  for (let i = 0; i < 10; i++) {
    const card = bot.chooseCard(g, 'nord');
    assert.ok(card.rank === '7' && card.suit === 'pique', 'carte jouée: ' + JSON.stringify(card));
  }
});

test('l\'IA répond à l\'appel de son partenaire en rejouant la couleur appelée', () => {
  // Contrat pique pour N-S joué par l'attaque... ici défense E-O : Est a appelé carreau.
  const hands = {
    sud: [C('8', 'trefle'), C('9', 'trefle'), C('valet', 'pique'), C('9', 'pique'), C('as', 'pique'), C('roi', 'coeur'), C('dame', 'coeur')],
    ouest: [C('7', 'carreau'), C('roi', 'carreau'), C('as', 'trefle'), C('10', 'trefle'), C('8', 'coeur'), C('9', 'coeur'), C('7', 'coeur')],
    nord: [C('roi', 'trefle'), C('dame', 'trefle'), C('valet', 'trefle'), C('10', 'pique'), C('roi', 'pique'), C('dame', 'pique'), C('8', 'pique')],
    est: [C('as', 'carreau'), C('10', 'carreau'), C('dame', 'carreau'), C('valet', 'carreau'), C('as', 'coeur'), C('10', 'coeur'), C('valet', 'coeur')]
  };
  const g = setupPlaying({ hands, contract: { player: 'sud', points: 80, suit: 'pique' }, dealer: 'est', leader: 'sud' });
  // Pli 1 déjà joué : Sud a entamé coeur... on injecte un historique avec l'appel d'Est.
  g.playHistory = [
    { roundNumber: 1, trickNumber: 1, indexInTrick: 0, player: 'sud', card: C('7', 'pique') },
    { roundNumber: 1, trickNumber: 1, indexInTrick: 1, player: 'ouest', card: C('dame', 'coeur') },
    { roundNumber: 1, trickNumber: 1, indexInTrick: 2, player: 'nord', card: C('7', 'trefle') },
    { roundNumber: 1, trickNumber: 1, indexInTrick: 3, player: 'est', card: C('8', 'carreau') } // appel carreau
  ];
  g.trickNumber = 2;
  g.lastTrickWinner = 'ouest';
  g.currentPlayer = 'ouest';
  for (let i = 0; i < 10; i++) {
    const card = bot.chooseCard(g, 'ouest');
    assert.ok(card.suit === 'carreau' && card.rank === '7', 'carte jouée: ' + JSON.stringify(card));
  }
});

console.log('Parties complètes IA');

test('50 parties complètes entre IA sans coup illégal', () => {
  for (let n = 0; n < 50; n++) {
    const g = newGame();
    g.startNewRound();
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 20000) {
      const pos = g.currentPlayer;
      if (g.state === 'scoring') { g.startNewRound(); continue; }
      if (g.state === 'bidding') {
        const r = g.placeBid(pos, bot.chooseBid(g));
        assert.ok(r.success, r.error);
        if (r.action === 'redistribute') g.startNewRound();
        if (r.action === 'play' && g.contract.points === 500) assert.strictEqual(g.currentPlayer, g.contract.player);
        continue;
      }
      const r = g.playCard(pos, bot.chooseCard(g, pos));
      assert.ok(r.success, r.error);
    }
    assert.strictEqual(g.state, 'finished');
    assert.ok(g.scores.ns >= g.targetScore || g.scores.eo >= g.targetScore);
  }
});

console.log('IA à règles');

const fs = require('fs');
const os = require('os');
const path = require('path');
const ruleEngine = require('../ai/rules/engine');
const ruleBot = require('../ai/rule-bot');
const X = require('../ai/rules/expression');

test('expressions : évaluation (logique, ternaire, listes, lambdas, probabilités)', () => {
  const ev = (src, values = {}) => X.evaluate(X.parse(src), { values, functions: {} });
  assert.strictEqual(ev('1 + 2 * 3'), 7);
  assert.strictEqual(ev("a == 'x' && b > 2 ? 10 : 0", { a: 'x', b: 3 }), 10);
  assert.strictEqual(ev('count(l, c => c.v >= 2)', { l: [{ v: 1 }, { v: 2 }, { v: 3 }] }), 2);
  assert.strictEqual(ev("'as' in ['10', 'as']"), true);
  assert.strictEqual(ev('max(1, 5, 3) - min(4, 2)'), 3);
  assert.ok(Math.abs(ev('pAtLeastOne(24, 2, 16)') - (1 - (8 * 7) / (24 * 23))) < 1e-9);
  assert.strictEqual(ev('x.y.z', { x: null }), null); // lecture sûre de champs absents
  assert.throws(() => X.parse('a +'), /inattendu/);
});

test('les fichiers de règles livrés sont tous valides', () => {
  const report = ruleEngine.buildReport({ reload: true });
  assert.strictEqual(report.fileErrors.length, 0, JSON.stringify(report.fileErrors));
  assert.strictEqual(report.invalid.length, 0, JSON.stringify(report.invalid));
  assert.ok(report.total >= 30);
});

test('IA règles : ouvre à 80 avec une main risquée mais significative', () => {
  const g = newGame();
  g.startNewRound();
  const hand = [
    C('7', 'coeur'), C('8', 'coeur'), C('9', 'coeur'), C('dame', 'coeur'),
    C('as', 'carreau'), C('7', 'carreau'), C('8', 'trefle'), C('7', 'pique')
  ];
  g.hands[g.currentPlayer] = hand;
  assert.strictEqual(bot.helpers.evaluateSuitBid(hand, 'coeur'), 0);
  assert.deepStrictEqual(ruleBot.chooseBid(g), { type: 'bid', points: 80, suit: 'coeur' });

  const weak = newGame();
  weak.startNewRound();
  weak.hands[weak.currentPlayer] = [
    C('7', 'coeur'), C('8', 'coeur'), C('7', 'carreau'), C('8', 'carreau'),
    C('7', 'trefle'), C('8', 'trefle'), C('7', 'pique'), C('8', 'pique')
  ];
  assert.deepStrictEqual(ruleBot.chooseBid(weak), { type: 'pass' });
});

test('/debug rule : règles invalides détectées et listées par id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coinche-rules-'));
  const annonce = {
    rules: [
      { id: 1, when: 'canCoinche', action: { type: 'coinche' } },
      { id: 2, when: "current.team == 'eux'", action: { type: 'pass' } },        // valeur d'énumération inconnue
      { id: 3, action: { type: 'bid', points: 'best', suit: "'coeur'" } },        // variable inconnue
      { id: 4, action: { type: 'pass' } }
    ]
  };
  const jeux = {
    rules: [
      { id: 4, action: { type: 'score', value: 'card.points' } },                  // id en double
      { id: 5, action: { type: 'play', cards: 'card.isTrump', pick: 'max' } },     // "by" manquant
      { id: 6, when: 'trick.size ==', action: { type: 'exclude', cards: 'card.isTrump' } }, // syntaxe
      { id: 7, action: { type: 'score', cards: 'card.pWin > 0.5', value: 'pGain(card, 21) * 10' } },
      { id: 8, action: { type: 'jouer' } }                                         // action inconnue
    ]
  };
  const fa = path.join(dir, 'a.json');
  const fj = path.join(dir, 'j.json');
  fs.writeFileSync(fa, JSON.stringify(annonce));
  fs.writeFileSync(fj, JSON.stringify(jeux));
  const report = ruleEngine.buildReport({ files: { annonce: fa, jeux: fj } });
  const lines = ruleEngine.formatReportLines(report);
  assert.strictEqual(lines[0], '9 rules - 3 valides - 6 invalides');
  const ids = report.invalid.map(r => r.id).sort((a, b) => a - b);
  assert.deepStrictEqual(ids, [2, 3, 4, 5, 6, 8]);
  assert.ok(lines.some(l => l.startsWith('rule 2 invalide') && l.includes("'eux'")));
  assert.ok(lines.some(l => l.startsWith('rule 4 invalide') && l.includes('déjà utilisé')));
  fs.rmSync(dir, { recursive: true, force: true });
});

function playFullGame(botFor) {
  const g = newGame();
  g.startNewRound();
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 20000) {
    const pos = g.currentPlayer;
    if (g.state === 'scoring') { g.startNewRound(); continue; }
    if (g.state === 'bidding') {
      const r = g.placeBid(pos, botFor(pos).chooseBid(g));
      assert.ok(r.success, r.error);
      if (r.action === 'redistribute') g.startNewRound();
      continue;
    }
    const r = g.playCard(pos, botFor(pos).chooseCard(g, pos));
    assert.ok(r.success, r.error);
  }
  assert.strictEqual(g.state, 'finished');
  return g;
}

test('IA règles : 15 parties complètes sans coup illégal ni repli legacy', () => {
  let fallbacks = 0;
  for (let n = 0; n < 15; n++) {
    playFullGame(() => ({
      chooseBid: (g) => ruleBot.chooseBid(g),
      chooseCard: (g, p) => {
        const c = ruleBot.chooseCard(g, p);
        if (ruleBot.lastDecision.jeux && ruleBot.lastDecision.jeux.ruleId === 'legacy') fallbacks++;
        return c;
      }
    }));
  }
  assert.strictEqual(fallbacks, 0);
});

test('partie mixte : 2 IA legacy contre 2 IA règles', () => {
  for (let n = 0; n < 10; n++) playFullGame(pos => (getTeam(pos) === 'ns' ? bot : ruleBot));
});

console.log(`\n${passed} test(s) réussi(s)`);
