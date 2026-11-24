// ============================================================
// IA "règles" : décisions pilotées par ai/rules/rule_annonce.json et
// ai/rules/rule_jeux.json (voir RULE.md).
// Ce module construit le contexte (variables + fonctions) exposé aux règles,
// puis délègue la décision au moteur (ai/rules/engine.js).
// En cas de problème (fichier invalide, aucune règle applicable), la décision
// retombe sur l'IA legacy pour ne jamais bloquer une partie.
// ============================================================
const { SUITS, getPartner, getNextPlayer, getTeam } = require('../game');
const legacy = require('./coinche-bot');
const engine = require('./rules/engine');

const H = legacy.helpers;
const POSITIONS = ['sud', 'ouest', 'nord', 'est'];
const VALID_BID_POINTS = [80, 90, 100, 110, 120, 130, 140, 150, 160, 250, 270, 500];
const CONTRACT_SUITS = [...SUITS, 'tout-atout', 'sans-atout'];
const SUIT_TRUMP_POINTS = { valet: 20, '9': 14, as: 11, '10': 10, roi: 4, dame: 3 };
const SUIT_PLAIN_POINTS = { as: 12, '10': 10, roi: 4, dame: 3, valet: 1 };

// Dernière décision (pour le débogage).
const lastDecision = { annonce: null, jeux: null };

function relation(me, other) {
  if (!other) return 'none';
  if (other === me) return 'me';
  if (other === getPartner(me)) return 'partner';
  return 'opponent';
}

function simpleCard(c, trumpSuit) {
  return { rank: c.rank, suit: c.suit, points: trumpSuit ? H.getCardValueForContract(c, trumpSuit) : 0 };
}

// ============================================================
// ANNONCES
// ============================================================
function normalizeBid(points) {
  if (!Number.isFinite(points)) return 0;
  if (points >= 500) return 500;
  if (points >= 270) return 270;
  if (points >= 250) return 250;
  if (points < 80) return 0;
  return Math.min(160, Math.round(points / 10) * 10);
}

function buildAnnonceContext(game, riskyOpenMinEstimate = 0) {
  const me = game.currentPlayer;
  const myTeam = getTeam(me);
  const hand = game.hands?.[me] || [];
  const bids = Array.isArray(game.bids) ? game.bids : [];
  const contract = game.contract;
  const coinched = !!game.coincheBy;
  const surcoinched = !!game.surcoincheBy;

  const lastBidBy = (who) => {
    for (let i = bids.length - 1; i >= 0; i--) {
      const b = bids[i];
      if (b && b.type === 'bid' && relation(me, b.player) === who) return { exists: true, points: b.points, suit: b.suit };
    }
    return { exists: false, points: 0, suit: null };
  };

  let passes = 0;
  for (let i = bids.length - 1; i >= 0 && bids[i].type === 'pass'; i--) passes++;

  const currentBy = contract ? relation(me, contract.player) : 'none';
  const currentTeam = contract ? (getTeam(contract.player) === myTeam ? 'us' : 'them') : 'none';
  const minBid = contract ? (VALID_BID_POINTS.find(p => p > contract.points) || 0) : 80;

  const firstSpeaker = getNextPlayer(game.dealer);
  let speaker = 1;
  for (let p = firstSpeaker; p !== me && speaker < 5; p = getNextPlayer(p)) speaker++;

  const estimateCache = new Map();
  const estimate = (suit) => {
    if (!CONTRACT_SUITS.includes(suit)) return 0;
    if (!estimateCache.has(suit)) {
      let v;
      if (suit === 'tout-atout') v = H.evaluateAllTrumpBid(hand);
      else if (suit === 'sans-atout') v = H.evaluateNoTrumpBid(hand);
      else v = H.evaluateSuitBid(hand, suit);
      estimateCache.set(suit, v);
    }
    return estimateCache.get(suit);
  };
  const specialRisk = (suit) => (CONTRACT_SUITS.includes(suit) ? H.estimateSpecialAnnouncementRiskPenalty(hand, suit, game, me) : 0);

  // Keep the legacy suit estimate before bid-step clamping for the risk threshold.
  const rawSuitEstimate = (suit) => {
    const trumpCards = hand.filter(c => c && c.suit === suit);
    const nbTrump = trumpCards.length;
    let points = 0;
    for (const c of hand) {
      if (!c) continue;
      points += c.suit === suit
        ? (SUIT_TRUMP_POINTS[c.rank] || 0)
        : (SUIT_PLAIN_POINTS[c.rank] || 0);
    }
    if (H.hasBelote(hand, suit)) points += 20;
    if (nbTrump >= 5) points += 15;
    if (nbTrump >= 6) points += 20;
    if (nbTrump <= 2) points -= 15;
    if (trumpCards.some(c => c.rank === 'valet')) points += 10;
    if (trumpCards.some(c => c.rank === '9')) points += 6;
    if (trumpCards.some(c => c.rank === 'as')) points += 2;
    if (trumpCards.some(c => c.rank === '10')) points += 1;
    return points - specialRisk(suit);
  };

  let best = null;
  let riskyBest = null;
  const computeBest = () => {
    if (best) return best;
    const candidates = CONTRACT_SUITS.map(suit => {
      const raw = estimate(suit);
      return { suit, raw, points: H.clampToBidSteps(raw - specialRisk(suit)) };
    });
    candidates.sort((a, b) => (b.points - a.points) || (b.raw - a.raw));
    best = candidates[0];
    return best;
  };
  const computeRiskyBest = () => {
    if (riskyBest) return riskyBest;
    riskyBest = SUITS
      .map(suit => ({ suit, raw: rawSuitEstimate(suit) }))
      .sort((a, b) => b.raw - a.raw)[0];
    return riskyBest;
  };
  const shouldRiskOpen = () => !contract
    && riskyOpenMinEstimate > 0
    && computeRiskyBest().raw >= riskyOpenMinEstimate;

  const values = {
    me: { position: me, team: myTeam },
    partner: getPartner(me),
    dealer: game.dealer,
    speaker,
    turn: bids.filter(b => b.player === me).length + 1,
    hand: hand.map(c => simpleCard(c, null)),
    current: {
      points: contract ? contract.points : 0,
      suit: contract ? contract.suit : null,
      by: currentBy,
      team: currentTeam
    },
    coinched,
    surcoinched,
    canBid: !coinched,
    canCoinche: !!contract && currentTeam === 'them' && !coinched,
    canSurcoinche: coinched && !surcoinched && currentTeam === 'us',
    minBid,
    partnerBid: lastBidBy('partner'),
    opponentBid: lastBidBy('opponent'),
    myBid: lastBidBy('me'),
    bids: bids.map(b => ({ who: relation(me, b.player), type: b.type, points: b.points || 0, suit: b.suit || null })),
    passes,
    score: {
      us: game.scores?.[myTeam] || 0,
      them: game.scores?.[myTeam === 'ns' ? 'eo' : 'ns'] || 0,
      target: game.targetScore || 2000
    }
  };

  const functions = {
    estimate,
    specialRisk,
    bestSuit: () => {
      const regular = computeBest();
      return regular.points > 0 || !shouldRiskOpen() ? regular.suit : computeRiskyBest().suit;
    },
    bestValue: () => {
      const regular = computeBest();
      return regular.points > 0 ? regular.points : shouldRiskOpen() ? 80 : regular.points;
    },
    countSuit: (suit) => hand.filter(c => c.suit === suit).length,
    countRank: (rank) => hand.filter(c => c.rank === rank).length,
    has: (rank, suit) => hand.some(c => c.rank === rank && c.suit === suit),
    hasBelote: (suit) => H.hasBelote(hand, suit),
    defensePotential: (suit) => H.estimateDefensePotentialPoints(hand, suit),
    opponentBeloteRisk: (suit, points) => H.estimateOpponentBeloteRiskPenalty(hand, suit, Number(points) || 0),
    partnerRaiseAllowed: () => H.shouldAllowPartnerRaise(game),
    partnerRaise: (suit, points) => H.computePartnerRaiseIncrement(hand, suit, Number(points) || 0),
    relayOvercalled: () => {
      const relay = H.findLatestPartnerSuitRelay(bids, me);
      const top = H.getHighestBidEntry(bids);
      if (!relay || !top || getTeam(top.player) === myTeam) return false;
      return bids.lastIndexOf(top) > relay.partnerBidIndex;
    },
    reclaimBid: () => {
      const r = H.computePartnerSuitReclaimBid(game, hand);
      return r ? r.points : 0;
    },
    reclaimSuit: () => {
      const r = H.computePartnerSuitReclaimBid(game, hand);
      return r ? r.suit : null;
    },
    bidStep: (points) => normalizeBid(Number(points) || 0)
  };

  const isLegal = (action) => {
    if (action.type === 'pass') return true;
    if (action.type === 'coinche') return values.canCoinche;
    if (action.type === 'surcoinche') return values.canSurcoinche;
    if (action.type === 'bid') {
      if (coinched) return false;
      if (!VALID_BID_POINTS.includes(action.points)) return false;
      if (!CONTRACT_SUITS.includes(action.suit)) return false;
      return !contract || action.points > contract.points;
    }
    return false;
  };

  return { values, functions, isLegal, normalizeBid };
}

function chooseBid(game) {
  try {
    const set = engine.getRuleSet('annonce');
    if (set.ordered && set.ordered.length) {
      const ctx = buildAnnonceContext(game, set.params.riskyOpenMinEstimate || 0);
      const decision = engine.runAnnonce(set, ctx);
      if (decision) {
        lastDecision.annonce = { player: game.currentPlayer, ruleId: decision.rule.id, action: decision.action };
        return decision.action;
      }
      lastDecision.annonce = { player: game.currentPlayer, ruleId: null, action: { type: 'pass' } };
      return { type: 'pass' };
    }
  } catch (err) {
    console.error('[rule-bot] erreur annonce, repli legacy :', err);
  }
  lastDecision.annonce = { player: game.currentPlayer, ruleId: 'legacy', action: null };
  return legacy.chooseBid(game);
}

// ============================================================
// JEU DE LA CARTE
// ============================================================
function orderFor(card, trumpSuit) {
  if (trumpSuit === 'tout-atout') return H.ALL_TRUMP_ORDER;
  if (trumpSuit === 'sans-atout') return H.NO_TRUMP_ORDER;
  if (card.suit === trumpSuit) return H.TRUMP_ORDER;
  return H.PLAIN_ORDER;
}

// Réponse simulée d'un joueur (même heuristique que l'IA legacy).
function simulateResponseCard(legal, playerPos, trickBefore, trumpSuit) {
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0];
  const team = getTeam(playerPos);
  let best = legal[0];
  let bestScore = -Infinity;
  for (const card of legal) {
    const projected = [...trickBefore, { player: playerPos, card }];
    const current = H.determineCurrentWinnerEntry(projected, trumpSuit);
    const pts = projected.reduce((s, p) => s + H.getCardValueForContract(p.card, trumpSuit), 0);
    let score = 0;
    if (projected.length === 4 && current) score += getTeam(current.winner.player) === team ? pts : -pts;
    else if (current) score += getTeam(current.winner.player) === team ? 4 : -4;
    score -= H.getDiscardRisk(card, trumpSuit) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }
  return best;
}

function buildJeuContext(game, position, samples) {
  const trumpSuit = game.contract.suit;
  const isSuitContract = SUITS.includes(trumpSuit);
  const hand = game.hands[position] || [];
  const state = game.getStateForPlayer(position);
  const legalCards = state.playableCards || [];
  const myTeam = getTeam(position);
  const partner = getPartner(position);
  const history = Array.isArray(state.playHistory) ? state.playHistory : [];
  const played = history.map(h => h.card).filter(Boolean);
  const trick = Array.isArray(game.currentTrick) ? game.currentTrick : [];
  const cardsLeft = state.cardsLeft || {};
  const leading = trick.length === 0;
  const ledSuit = leading ? null : trick[0].card.suit;
  const opponents = POSITIONS.filter(p => getTeam(p) !== myTeam);

  const isPlayedCard = (rank, suit) => played.some(c => c.rank === rank && c.suit === suit);
  const inHand = (rank, suit) => hand.some(c => c.rank === rank && c.suit === suit);

  // Analyse publique : appels, chicanes connues.
  const signalInfo = legacy.analyzeSignals(history, trumpSuit);
  const voids = signalInfo.voids;
  const knownNoTrump = {};
  if (isSuitContract) {
    for (const [p, set] of Object.entries(voids)) if (set.has(trumpSuit)) knownNoTrump[p] = true;
  }

  // Atouts
  const myTrumps = isSuitContract ? hand.filter(c => c.suit === trumpSuit).length : 0;
  const trumpsPlayed = isSuitContract ? played.filter(c => c.suit === trumpSuit).length : 0;
  const trumpsUnseen = isSuitContract ? Math.max(0, 8 - trumpsPlayed - myTrumps) : 0;
  let enemyEstimate = 0;
  if (isSuitContract && trumpsUnseen > 0) {
    const holders = POSITIONS.filter(p => p !== position && (cardsLeft[p] || 0) > 0 && !knownNoTrump[p]);
    const enemyHolders = opponents.filter(p => (cardsLeft[p] || 0) > 0 && !knownNoTrump[p]);
    const capacity = holders.reduce((s, p) => s + (cardsLeft[p] || 0), 0);
    if (capacity > 0) {
      enemyEstimate = Math.round(enemyHolders.reduce((s, p) => s + trumpsUnseen * ((cardsLeft[p] || 0) / capacity), 0));
    }
  }
  const opponentsOut = isSuitContract && opponents.every(p => knownNoTrump[p] || (cardsLeft[p] || 0) === 0);

  // Pli en cours
  const winnerEntry = trick.length ? H.determineCurrentWinnerEntry(trick, trumpSuit) : null;
  const winnerRel = winnerEntry ? relation(position, winnerEntry.winner.player) : 'none';
  const trickCut = isSuitContract && !!ledSuit && ledSuit !== trumpSuit && trick.some(p => p.card.suit === trumpSuit);
  const lastWinnerTeam = game.lastTrickWinner ? (getTeam(game.lastTrickWinner) === myTeam ? 'us' : 'them') : 'none';

  // Cartes inconnues
  const fullDeck = H.buildDeck();
  const unknown = H.removeCardsFromDeck(fullDeck, [...hand, ...played]);

  // Joueurs restant à jouer après moi dans ce pli
  const remainingPlayers = [];
  let cursor = position;
  for (let i = trick.length + 1; i < 4; i++) {
    cursor = getNextPlayer(cursor);
    remainingPlayers.push(cursor);
  }

  const unseenStronger = (card) => {
    const order = orderFor(card, trumpSuit);
    const idx = order.indexOf(card.rank);
    let n = 0;
    for (const rank of order.slice(idx + 1)) {
      if (!isPlayedCard(rank, card.suit) && !inHand(rank, card.suit)) n++;
    }
    return n;
  };

  // Tirage des mains des joueurs restants, en respectant les chicanes connues.
  const sampleHands = () => {
    const pool = unknown.slice();
    const out = {};
    // Les joueurs les plus contraints d'abord.
    const ordered = remainingPlayers.slice().sort((a, b) => (voids[b]?.size || 0) - (voids[a]?.size || 0));
    for (const p of ordered) {
      const need = cardsLeft[p] || 0;
      const forbidden = voids[p] || new Set();
      const allowedIdx = [];
      pool.forEach((c, i) => { if (!forbidden.has(c.suit)) allowedIdx.push(i); });
      const picked = [];
      if (allowedIdx.length >= need) {
        for (let k = 0; k < need; k++) {
          const j = Math.floor(Math.random() * allowedIdx.length);
          picked.push(allowedIdx[j]);
          allowedIdx.splice(j, 1);
        }
        picked.sort((a, b) => b - a);
        out[p] = picked.map(i => pool.splice(i, 1)[0]);
      } else {
        out[p] = H.drawRandomCards(pool, need);
      }
    }
    return out;
  };

  // Monte-Carlo : distribution des résultats du pli si je joue `card`.
  const simulate = (card) => {
    const gains = [];
    const losses = [];
    let wins = 0; let winsMe = 0; let cuts = 0; let overtrumped = 0;
    const n = remainingPlayers.length === 0 ? 1 : samples;
    const iCutWithTrump = isSuitContract && !!ledSuit && ledSuit !== trumpSuit && card.suit === trumpSuit;
    for (let s = 0; s < n; s++) {
      const hands = sampleHands();
      const sim = [...trick, { player: position, card }];
      let last = position;
      while (sim.length < 4) {
        const p = getNextPlayer(last);
        const hp = hands[p] || [];
        const legal = H.getPlayableCardsForSimulation(hp, sim, trumpSuit, p);
        const chosen = simulateResponseCard(legal, p, sim, trumpSuit) || legal[0];
        if (!chosen) break;
        const idx = hp.findIndex(c => H.cardEquals(c, chosen));
        if (idx >= 0) hp.splice(idx, 1);
        sim.push({ player: p, card: chosen });
        last = p;
      }
      const w = H.determineCurrentWinnerEntry(sim, trumpSuit);
      let pts = sim.reduce((acc, p) => acc + H.getCardValueForContract(p.card, trumpSuit), 0);
      if (game.trickNumber === 8 && sim.length === 4) pts += 10;
      const weWin = !!w && getTeam(w.winner.player) === myTeam;
      if (weWin) { wins++; gains.push(pts); losses.push(0); } else { gains.push(0); losses.push(pts); }
      if (w && w.winner.player === position) winsMe++;
      const led = sim[0].card.suit;
      if (isSuitContract && led !== trumpSuit) {
        const oppCut = sim.some(p => getTeam(p.player) !== myTeam && p.card.suit === trumpSuit && p.player !== position);
        if (oppCut && !weWin) cuts++;
      }
      if (iCutWithTrump && w && getTeam(w.winner.player) !== myTeam && w.winner.card.suit === trumpSuit) overtrumped++;
    }
    const total = gains.length || 1;
    const sum = a => a.reduce((x, y) => x + y, 0);
    return {
      ev: sum(gains) / total,
      evLoss: sum(losses) / total,
      evNet: (sum(gains) - sum(losses)) / total,
      pWin: wins / total,
      pWinMe: winsMe / total,
      pLose: 1 - wins / total,
      pCut: cuts / total,
      pOvertrumped: iCutWithTrump ? overtrumped / total : 0,
      gains,
      losses
    };
  };

  const legalKeys = new Set(legalCards.map(c => `${c.suit}:${c.rank}`));

  // Vue "carte" exposée aux règles. Les champs probabilistes sont calculés à la demande.
  const makeView = (card) => {
    const order = orderFor(card, trumpSuit);
    const sameSuit = hand.filter(c => c.suit === card.suit);
    const idx = order.indexOf(card.rank);
    const isTrump = isSuitContract ? card.suit === trumpSuit : trumpSuit === 'tout-atout';
    const isDiscard = !leading && card.suit !== ledSuit && !(isSuitContract && card.suit === trumpSuit)
      && !hand.some(c => c.suit === ledSuit);
    let winsNow = true;
    if (!leading) {
      const projected = [...trick, { player: position, card }];
      const w = H.determineCurrentWinnerEntry(projected, trumpSuit);
      winsNow = !!w && w.winner.player === position;
    }
    const view = {
      rank: card.rank,
      suit: card.suit,
      isTrump,
      points: H.getCardValueForContract(card, trumpSuit),
      order: idx,
      power: (isSuitContract && card.suit === trumpSuit ? 100 : 0) + idx,
      isMaster: unseenStronger(card) === 0,
      unseenStronger: unseenStronger(card),
      isLowestInSuit: sameSuit.every(c => order.indexOf(c.rank) >= idx),
      isHighestInSuit: sameSuit.every(c => order.indexOf(c.rank) <= idx),
      suitCount: sameSuit.length,
      isLed: !!ledSuit && card.suit === ledSuit,
      isDiscard,
      winsNow,
      risk: H.getDiscardRisk(card, trumpSuit),
      isLowSignal: H.isLowSignalCard(card, trumpSuit)
    };
    let sim = null;
    const lazy = (key) => () => {
      if (!legalKeys.has(`${card.suit}:${card.rank}`)) return 0;
      if (!sim) sim = simulate(card);
      return sim[key];
    };
    for (const key of ['ev', 'evNet', 'evLoss', 'pWin', 'pWinMe', 'pLose', 'pCut', 'pOvertrumped']) {
      Object.defineProperty(view, key, { get: lazy(key), enumerable: true });
    }
    Object.defineProperty(view, '_card', { value: card, enumerable: false });
    Object.defineProperty(view, '_dist', {
      get: () => {
        if (!legalKeys.has(`${card.suit}:${card.rank}`)) return { gains: [], losses: [] };
        if (!sim) sim = simulate(card);
        return sim;
      },
      enumerable: false
    });
    return view;
  };

  const handViews = hand.map(makeView);
  const viewOf = (c) => handViews.find(v => v.rank === c.rank && v.suit === c.suit);
  const playable = legalCards.map(viewOf).filter(Boolean);

  const lowestInHand = (suit) => {
    const l = handViews.filter(v => v.suit === suit);
    return l.length ? l.reduce((m, v) => (v.order < m.order ? v : m)) : null;
  };
  const highestInHand = (suit) => {
    const l = handViews.filter(v => v.suit === suit);
    return l.length ? l.reduce((m, v) => (v.order > m.order ? v : m)) : null;
  };

  const whoList = (who) => {
    if (who === 'partner') return [partner];
    if (who === 'left') return [getNextPlayer(position)];
    if (who === 'right') return [getNextPlayer(getNextPlayer(getNextPlayer(position)))];
    return opponents;
  };

  const partnerSignal = signalInfo.signals[partner];
  const discardAvailable = playable.some(v => v.isDiscard);

  const values = {
    me: { position, team: myTeam },
    partner,
    role: game.contract.team === myTeam ? 'attack' : 'defense',
    trump: isSuitContract ? trumpSuit : null,
    contract: {
      points: game.contract.points,
      suit: trumpSuit,
      type: isSuitContract ? 'couleur' : trumpSuit,
      coinched: !!game.contract.coinched,
      surcoinched: !!game.contract.surcoinched,
      byMe: game.contract.player === position,
      byPartner: game.contract.player === partner,
      special: game.contract.points >= 250
    },
    trick: {
      number: game.trickNumber,
      size: trick.length,
      position: trick.length + 1,
      leading,
      ledSuit,
      points: trick.reduce((s, p) => s + H.getCardValueForContract(p.card, trumpSuit), 0),
      winner: winnerRel,
      partnerMaster: winnerRel === 'partner',
      opponentMaster: winnerRel === 'opponent',
      cut: trickCut,
      isLast: game.trickNumber === 8,
      remaining: remainingPlayers.length,
      lastWinner: lastWinnerTeam,
      cards: trick.map(p => simpleCard(p.card, trumpSuit))
    },
    hand: handViews,
    playable,
    played: played.map(c => simpleCard(c, trumpSuit)),
    unseen: unknown.map(c => simpleCard(c, trumpSuit)),
    trumps: {
      mine: myTrumps,
      played: trumpsPlayed,
      unseen: trumpsUnseen,
      enemyEstimate,
      opponentsOut
    },
    signals: {
      partnerSuit: partnerSignal && partnerSignal.active ? partnerSignal.suit : null,
      opponentSuits: opponents.map(p => signalInfo.signals[p]).filter(s => s && s.active).map(s => s.suit),
      myFirstDiscard: discardAvailable && !signalInfo.discarded[position],
      discardAvailable
    },
    score: {
      us: game.scores?.[myTeam] || 0,
      them: game.scores?.[myTeam === 'ns' ? 'eo' : 'ns'] || 0,
      roundUs: game.roundPoints?.[myTeam] || 0,
      roundThem: game.roundPoints?.[myTeam === 'ns' ? 'eo' : 'ns'] || 0,
      target: game.targetScore || 2000
    }
  };

  const functions = {
    countSuit: (suit) => hand.filter(c => c.suit === suit).length,
    hasCard: (rank, suit) => inHand(rank, suit),
    isPlayed: (rank, suit) => isPlayedCard(rank, suit),
    unseenCount: (suit) => unknown.filter(c => c.suit === suit).length,
    isVoid: (who, suit) => {
      const list = whoList(who);
      if (who === 'allOpponents') return list.every(p => voids[p] && voids[p].has(suit));
      return list.some(p => voids[p] && voids[p].has(suit));
    },
    opponentMayCut: (suit) => isSuitContract && suit !== trumpSuit &&
      opponents.some(p => voids[p] && voids[p].has(suit) && !knownNoTrump[p] && (cardsLeft[p] || 0) > 0),
    lowestInHand,
    highestInHand,
    masterInHand: (suit) => {
      const h = highestInHand(suit);
      return !!h && h.isMaster;
    },
    pGain: (view, n) => {
      if (!view || !view._dist) return 0;
      const g = view._dist.gains;
      return g.length ? g.filter(x => x >= Number(n)).length / g.length : 0;
    },
    pLoss: (view, n) => {
      if (!view || !view._dist) return 0;
      const l = view._dist.losses;
      return l.length ? l.filter(x => x >= Number(n)).length / l.length : 0;
    }
  };

  return {
    values,
    functions,
    candidates: playable,
    cardValue: (v) => v.points * 1000 + v.power
  };
}

function chooseCard(game, position) {
  try {
    const set = engine.getRuleSet('jeux');
    const state = game.getStateForPlayer(position);
    const legal = state.playableCards || [];
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];
    if (set.ordered && set.ordered.length) {
      const ctx = buildJeuContext(game, position, set.settings.samples || 48);
      const decision = engine.runJeu(set, ctx);
      if (decision && decision.card) {
        lastDecision.jeux = { player: position, ruleId: decision.rule ? decision.rule.id : 'score', card: decision.card._card };
        return decision.card._card;
      }
    }
  } catch (err) {
    console.error('[rule-bot] erreur jeu, repli legacy :', err);
  }
  lastDecision.jeux = { player: position, ruleId: 'legacy', card: null };
  return legacy.chooseCard(game, position);
}

module.exports = {
  chooseBid,
  chooseCard,
  buildAnnonceContext,
  buildJeuContext,
  lastDecision
};
