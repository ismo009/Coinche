// Simple server-side bot logic for Coinche.
// Focus: keep decision logic isolated and easy to tweak.

const { SUITS, getPartner, getNextPlayer, getTeam } = require('../game');

const RANKS = ['7', '8', '9', '10', 'valet', 'dame', 'roi', 'as'];

const TRUMP_VALUES = {
  valet: 20, '9': 14, as: 11, '10': 10, roi: 4, dame: 3, '8': 0, '7': 0
};

const PLAIN_VALUES = {
  as: 11, '10': 10, roi: 4, dame: 3, valet: 2, '9': 0, '8': 0, '7': 0
};

const ALL_TRUMP_VALUES = {
  valet: 14, '9': 9, as: 6, '10': 5, roi: 3, dame: 1, '8': 0, '7': 0
};

const NO_TRUMP_VALUES = {
  as: 19, '10': 10, roi: 4, dame: 3, valet: 2, '9': 0, '8': 0, '7': 0
};

const TRUMP_ORDER = ['7', '8', 'dame', 'roi', '10', 'as', '9', 'valet'];
const PLAIN_ORDER = ['7', '8', '9', 'valet', 'dame', 'roi', '10', 'as'];
const ALL_TRUMP_ORDER = ['7', '8', 'dame', 'roi', '10', 'as', '9', 'valet'];
const NO_TRUMP_ORDER = ['7', '8', '9', 'valet', 'dame', 'roi', '10', 'as'];

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function cardKey(card) {
  return `${card.suit}:${card.rank}`;
}

function cardEquals(a, b) {
  return !!a && !!b && a.suit === b.suit && a.rank === b.rank;
}

function removeCardsFromDeck(deck, cards) {
  const remaining = [...deck];
  for (const c of cards) {
    const idx = remaining.findIndex(d => cardEquals(d, c));
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return remaining;
}

function getCardValueForContract(card, trumpSuit) {
  if (trumpSuit === 'tout-atout') return ALL_TRUMP_VALUES[card.rank] || 0;
  if (trumpSuit === 'sans-atout') return NO_TRUMP_VALUES[card.rank] || 0;
  if (card.suit === trumpSuit) return TRUMP_VALUES[card.rank] || 0;
  return PLAIN_VALUES[card.rank] || 0;
}

function getCardStrengthForTrick(card, trumpSuit, ledSuit) {
  let order;
  if (trumpSuit === 'tout-atout') {
    order = ALL_TRUMP_ORDER;
  } else if (trumpSuit === 'sans-atout') {
    order = NO_TRUMP_ORDER;
  } else if (card.suit === trumpSuit) {
    return 100 + TRUMP_ORDER.indexOf(card.rank);
  } else {
    order = PLAIN_ORDER;
  }

  if (card.suit === ledSuit) return order.indexOf(card.rank);
  return -1;
}

function determineCurrentWinnerEntry(trick, trumpSuit) {
  if (!trick || trick.length === 0) return null;
  const ledSuit = trick[0].card.suit;
  let winner = trick[0];
  let best = getCardStrengthForTrick(winner.card, trumpSuit, ledSuit);
  for (let i = 1; i < trick.length; i++) {
    const s = getCardStrengthForTrick(trick[i].card, trumpSuit, ledSuit);
    if (s > best) {
      best = s;
      winner = trick[i];
    }
  }
  return { winner, strength: best, ledSuit };
}

function getHighestTrumpInTrick(trick, trumpSuit) {
  let highest = null;
  for (const play of trick) {
    if (play.card.suit === trumpSuit) {
      if (!highest || TRUMP_ORDER.indexOf(play.card.rank) > TRUMP_ORDER.indexOf(highest)) {
        highest = play.card.rank;
      }
    }
  }
  return highest;
}

function getHighestTrumpInTrickAllTrump(trick, suit) {
  let highest = null;
  for (const play of trick) {
    if (play.card.suit === suit) {
      if (!highest || ALL_TRUMP_ORDER.indexOf(play.card.rank) > ALL_TRUMP_ORDER.indexOf(highest)) {
        highest = play.card.rank;
      }
    }
  }
  return highest;
}

function getPlayableCardsForSimulation(hand, trick, trumpSuit, playerPosition) {
  if (!Array.isArray(hand) || hand.length === 0) return [];
  if (!Array.isArray(trick) || trick.length === 0) return hand;

  const ledSuit = trick[0].card.suit;
  const cardsOfLedSuit = hand.filter(c => c.suit === ledSuit);

  if (trumpSuit === 'sans-atout') {
    return cardsOfLedSuit.length > 0 ? cardsOfLedSuit : hand;
  }

  if (trumpSuit === 'tout-atout') {
    if (cardsOfLedSuit.length > 0) {
      const highestPlayed = getHighestTrumpInTrickAllTrump(trick, ledSuit);
      const higherCards = cardsOfLedSuit.filter(c =>
        ALL_TRUMP_ORDER.indexOf(c.rank) > ALL_TRUMP_ORDER.indexOf(highestPlayed)
      );
      return higherCards.length > 0 ? higherCards : cardsOfLedSuit;
    }
    return hand;
  }

  if (ledSuit === trumpSuit) {
    if (cardsOfLedSuit.length > 0) {
      const highestPlayed = getHighestTrumpInTrick(trick, trumpSuit);
      const higherCards = cardsOfLedSuit.filter(c =>
        TRUMP_ORDER.indexOf(c.rank) > TRUMP_ORDER.indexOf(highestPlayed)
      );
      return higherCards.length > 0 ? higherCards : cardsOfLedSuit;
    }
    return hand;
  }

  if (cardsOfLedSuit.length > 0) return cardsOfLedSuit;

  const trumpCards = hand.filter(c => c.suit === trumpSuit);
  if (trumpCards.length > 0) {
    const currentWinner = determineCurrentWinnerEntry(trick, trumpSuit);
    const partnerPos = typeof getPartner === 'function' ? getPartner(playerPosition) : null;
    if (currentWinner && partnerPos && currentWinner.winner.player === partnerPos) {
      return hand;
    }

    const highestTrumpPlayed = getHighestTrumpInTrick(trick, trumpSuit);
    if (highestTrumpPlayed) {
      const higherTrumps = trumpCards.filter(c =>
        TRUMP_ORDER.indexOf(c.rank) > TRUMP_ORDER.indexOf(highestTrumpPlayed)
      );
      return higherTrumps.length > 0 ? higherTrumps : trumpCards;
    }
    return trumpCards;
  }

  return hand;
}

function drawRandomCards(pool, n) {
  const picked = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

function getDiscardRisk(card, trumpSuit) {
  if (!card) return 0;
  const base = getCardValueForContract(card, trumpSuit);

  if (trumpSuit === 'sans-atout') {
    if (card.rank === 'as') return base + 12;
    if (card.rank === '10') return base + 7;
    return base;
  }

  if (trumpSuit === 'tout-atout') {
    if (card.rank === 'valet') return base + 10;
    if (card.rank === '9') return base + 8;
    return base;
  }

  if (card.suit === trumpSuit) {
    if (card.rank === 'valet') return base + 12;
    if (card.rank === '9') return base + 9;
  }

  if (card.rank === 'as') return base + 8;
  if (card.rank === '10') return base + 5;
  return base;
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function roundTo10(points) {
  return Math.round(points / 10) * 10;
}

function clampToBidSteps(points) {
  // Coinche engine accepts: 80..160 by 10, and 250/270/500
  if (points >= 500) return 500;
  if (points >= 270) return 270;
  if (points >= 250) return 250;
  const p = roundTo10(points);
  if (p < 80) return 0;
  if (p > 160) return 160;
  return p;
}

function isRank(card, rank) {
  return card && card.rank === rank;
}

function countSuit(hand, suit) {
  return hand.reduce((acc, c) => acc + (c && c.suit === suit ? 1 : 0), 0);
}

function hasBelote(hand, trumpSuit) {
  if (!trumpSuit || trumpSuit === 'tout-atout' || trumpSuit === 'sans-atout') return false;
  let hasKing = false;
  let hasQueen = false;
  for (const c of hand) {
    if (!c || c.suit !== trumpSuit) continue;
    if (c.rank === 'roi') hasKing = true;
    if (c.rank === 'dame') hasQueen = true;
  }
  return hasKing && hasQueen;
}

function baseNonTrumpPointsForCard(rank, mode) {
  // Rough “trick potential” inspired by typical coinche heuristics.
  // mode: 'suit' | 'sans-atout' | 'tout-atout'
  if (mode === 'sans-atout') {
    // In no-trump, A/10 are king.
    if (rank === 'as') return 20;
    if (rank === '10') return 12;
    if (rank === 'roi') return 5;
    if (rank === 'dame') return 4;
    if (rank === 'valet') return 2;
    return 0;
  }

  // Default suit game: value A/10/king/queen.
  if (rank === 'as') return 12;
  if (rank === '10') return 10;
  if (rank === 'roi') return 4;
  if (rank === 'dame') return 3;
  if (rank === 'valet') return 1;
  return 0;
}

function trumpPointsForCard(rank, mode) {
  // mode: 'suit' | 'tout-atout'
  if (rank === 'valet') return mode === 'tout-atout' ? 16 : 20;
  if (rank === '9') return mode === 'tout-atout' ? 12 : 14;
  if (rank === 'as') return mode === 'tout-atout' ? 7 : 11;
  if (rank === '10') return mode === 'tout-atout' ? 6 : 10;
  if (rank === 'roi') return 4;
  if (rank === 'dame') return 3;
  return 0;
}

function evaluateSuitBid(hand, trumpSuit) {
  const nbTrump = countSuit(hand, trumpSuit);
  const hasJ = hand.some(c => c && c.suit === trumpSuit && c.rank === 'valet');
  const has9 = hand.some(c => c && c.suit === trumpSuit && c.rank === '9');
  const hasA = hand.some(c => c && c.suit === trumpSuit && c.rank === 'as');
  const has10 = hand.some(c => c && c.suit === trumpSuit && c.rank === '10');
  const belote = hasBelote(hand, trumpSuit);

  // Score trump strength
  let points = 0;
  for (const c of hand) {
    if (!c) continue;
    if (c.suit === trumpSuit) points += trumpPointsForCard(c.rank, 'suit');
    else points += baseNonTrumpPointsForCard(c.rank, 'suit');
  }
  if (belote) points += 20;

  // Distribution / control bonus
  // (Encourage long trumps and key trumps)
  if (nbTrump >= 5) points += 15;
  if (nbTrump >= 6) points += 20;
  if (nbTrump <= 2) points -= 15;
  if (hasJ) points += 10;
  if (has9) points += 6;
  if (hasA) points += 2;
  if (has10) points += 1;

  return clampToBidSteps(points);
}

function evaluateAllTrumpBid(hand) {
  // Treat every suit as trump for trick-taking power.
  let points = 0;
  for (const c of hand) {
    if (!c) continue;
    points += trumpPointsForCard(c.rank, 'tout-atout');
  }
  // Bonus for having multiple jack/9 across suits
  const jCount = hand.filter(c => isRank(c, 'valet')).length;
  const nineCount = hand.filter(c => isRank(c, '9')).length;
  points += jCount * 6 + nineCount * 3;
  return clampToBidSteps(points);
}

function evaluateNoTrumpBid(hand) {
  let points = 0;
  for (const c of hand) {
    if (!c) continue;
    points += baseNonTrumpPointsForCard(c.rank, 'sans-atout');
  }
  // Bonus for having long suits with top cards (A/10)
  for (const s of SUITS) {
    const suitCards = hand.filter(c => c && c.suit === s);
    if (suitCards.length >= 5) points += 8;
    const hasA = suitCards.some(c => c.rank === 'as');
    const has10 = suitCards.some(c => c.rank === '10');
    if (hasA && has10) points += 6;
  }
  return clampToBidSteps(points);
}

function bestBidFromHand(hand) {
  const candidates = [];
  for (const suit of SUITS) {
    candidates.push({ suit, points: evaluateSuitBid(hand, suit) });
  }
  candidates.push({ suit: 'tout-atout', points: evaluateAllTrumpBid(hand) });
  candidates.push({ suit: 'sans-atout', points: evaluateNoTrumpBid(hand) });

  candidates.sort((a, b) => b.points - a.points);
  return candidates[0];
}

function getLastBidEntry(bids) {
  if (!Array.isArray(bids) || bids.length === 0) return null;
  for (let i = bids.length - 1; i >= 0; i--) {
    const b = bids[i];
    if (b && (b.type === 'bid' || b.type === 'pass' || b.type === 'coinche' || b.type === 'surcoinche')) {
      return b;
    }
  }
  return null;
}

function getHighestBidEntry(bids) {
  if (!Array.isArray(bids) || bids.length === 0) return null;
  // “Highest” in this simple engine is the latest 'bid' entry.
  for (let i = bids.length - 1; i >= 0; i--) {
    const b = bids[i];
    if (b && b.type === 'bid') return b;
  }
  return null;
}

function shouldAllowPartnerRaise(game) {
  const topBid = getHighestBidEntry(game?.bids);
  if (!topBid || topBid.type !== 'bid') return false;
  if (!topBid.player) return false;

  // Never “remonter” if the current highest bid is already ours.
  if (topBid.player === game.currentPlayer) return false;

  // Only raise suit bids (explicitly exclude TA/SA)
  if (!topBid.suit || topBid.suit === 'tout-atout' || topBid.suit === 'sans-atout') return false;

  const partnerPos = typeof getPartner === 'function' ? getPartner(game.currentPlayer) : null;
  if (!partnerPos) return false;
  if (topBid.player !== partnerPos) return false;

  // Prevent “re-remonter”: if we already bid this same suit after partner's bid, do not raise again.
  // This covers: partner bids ♦, bot raises ♦, partner bids ♦ again (not possible in standard bidding), etc.
  for (let i = (game.bids?.length || 0) - 1; i >= 0; i--) {
    const b = game.bids[i];
    if (!b) continue;
    if (b.type !== 'bid') continue;
    if (b.player === partnerPos && b.suit === topBid.suit) {
      // We reached partner's bid in history; if we didn't find our own same-suit bid after it, allow.
      return true;
    }
    if (b.player === game.currentPlayer && b.suit === topBid.suit) {
      return false;
    }
  }

  return true;
}

function computePartnerRaiseIncrement(hand, partnerSuit, partnerPoints) {
  // Spec (IA only):
  // - never for TA/SA
  // - if partnerPoints < 100: base +20, +20 if trump J, +10 if trump 9
  // - if 100..120: base same for J/9, +10 per ace
  // - always: +20 if belote at partner suit

  if (!partnerSuit || partnerSuit === 'tout-atout' || partnerSuit === 'sans-atout') return 0;
  const hasJ = hand.some(c => c && c.suit === partnerSuit && c.rank === 'valet');
  const has9 = hand.some(c => c && c.suit === partnerSuit && c.rank === '9');
  const aceCount = hand.filter(c => c && c.rank === 'as').length;
  const belote = hasBelote(hand, partnerSuit);

  let inc = 0;
  if (partnerPoints < 100) {
    inc += 20;
    if (hasJ) inc += 20;
    if (has9) inc += 10;
  } else if (partnerPoints >= 100 && partnerPoints <= 120) {
    if (hasJ) inc += 20;
    if (has9) inc += 10;
    inc += aceCount * 10;
  } else {
    // Not specified; keep conservative: no raise.
    inc += 0;
  }

  if (belote) inc += 20;
  return inc;
}

function chooseBid(game) {
  const hand = game.hands?.[game.currentPlayer] || [];
  const topBid = getHighestBidEntry(game.bids);
  const myTeam = typeof getTeam === 'function' ? getTeam(game.currentPlayer) : null;
  const topBidTeam = topBid?.player && typeof getTeam === 'function' ? getTeam(topBid.player) : null;

  // IA-only: allow a single “remonter” of partner's suit bid (non TA/SA) based on our hand.
  if (shouldAllowPartnerRaise(game)) {
    const partnerBid = getHighestBidEntry(game.bids);
    const inc = computePartnerRaiseIncrement(hand, partnerBid.suit, partnerBid.points);
    const target = clampToBidSteps(partnerBid.points + inc);
    if (target > partnerBid.points) {
      return { type: 'bid', points: target, suit: partnerBid.suit };
    }
  }

  const best = bestBidFromHand(hand);

  // Opening bid
  if (!topBid) {
    if (!best || !best.points || best.points < 80) return { type: 'pass' };
    return { type: 'bid', points: best.points, suit: best.suit };
  }

  // If partner currently has the contract and we didn't trigger a meaningful raise: pass.
  if (myTeam && topBidTeam && myTeam === topBidTeam) {
    return { type: 'pass' };
  }

  // Competitive overcall: if our best estimate beats current contract by at least one step.
  // Slightly conservative to avoid suicidal overbids.
  if (best && best.points >= 80 && best.points >= topBid.points + 10) {
    if (best.points >= 100 || topBid.points <= 100) {
      return { type: 'bid', points: best.points, suit: best.suit };
    }
  }

  // Weak fallback against high enemy contracts.
  if (!best || !best.points || best.points < 80) {
    return { type: 'pass' };
  }
  return { type: 'pass' };
}

function chooseCard(game, position) {
  const hand = game.hands?.[position] || [];
  const trumpSuit = game.contract?.suit;

  if (!hand.length || !trumpSuit) return null;

  const stateForBot = game.getStateForPlayer(position);
  const playable = stateForBot.playableCards || [];

  if (!playable.length) return null;

  if (playable.length === 1) return playable[0];

  const myTeam = stateForBot.myTeam;
  const history = Array.isArray(stateForBot.playHistory) ? stateForBot.playHistory : [];
  const alreadyPlayed = history.map(h => h.card).filter(Boolean);

  const isSuitTrumpContract = SUITS.includes(trumpSuit);
  const isLeadingNewTrick = (game.currentTrick?.length || 0) === 0;
  const lastWinnerTeam = game.lastTrickWinner && typeof getTeam === 'function'
    ? getTeam(game.lastTrickWinner)
    : null;
  const teamJustWonPreviousTrick = !!lastWinnerTeam && lastWinnerTeam === myTeam;

  const myTrumpCount = isSuitTrumpContract
    ? hand.filter(c => c.suit === trumpSuit).length
    : 0;
  const trumpsAlreadyPlayed = isSuitTrumpContract
    ? alreadyPlayed.filter(c => c.suit === trumpSuit).length
    : 0;

  // Approximation conservative: if not all trumps are known (played + in hand),
  // assume opponents may still hold trumps and prioritize drawing them.
  const unknownTrumpsOutsideMyHand = isSuitTrumpContract
    ? Math.max(0, 8 - (trumpsAlreadyPlayed + myTrumpCount))
    : 0;

  const shouldPullTrumpsNow =
    isSuitTrumpContract &&
    isLeadingNewTrick &&
    teamJustWonPreviousTrick &&
    myTrumpCount > 0 &&
    unknownTrumpsOutsideMyHand > 0;

  const fullDeck = buildDeck();
  const knownCards = [...hand, ...alreadyPlayed];
  const unknownCards = removeCardsFromDeck(fullDeck, knownCards);

  const remainingPlayers = [];
  let cursor = position;
  const trickAfterMyPlaySize = (game.currentTrick?.length || 0) + 1;
  for (let i = trickAfterMyPlaySize; i < 4; i++) {
    cursor = typeof getNextPlayer === 'function'
      ? getNextPlayer(cursor)
      : ({ sud: 'ouest', ouest: 'nord', nord: 'est', est: 'sud' }[cursor]);
    remainingPlayers.push(cursor);
  }

  const cardsLeft = stateForBot.cardsLeft || {};
  const knownOtherHands = {};
  for (const p of remainingPlayers) {
    const n = cardsLeft[p] || 0;
    knownOtherHands[p] = n;
  }

  const sampleCount = remainingPlayers.length === 0 ? 1 : 48;

  function sampleHandsForRemainingPlayers() {
    const pool = [...unknownCards];
    const sampled = {};
    for (const p of remainingPlayers) {
      sampled[p] = drawRandomCards(pool, knownOtherHands[p] || 0);
    }
    return sampled;
  }

  function trickPoints(trick) {
    return trick.reduce((sum, play) => sum + getCardValueForContract(play.card, trumpSuit), 0);
  }

  function simulateResponseCard(legal, playerPos, trickBefore) {
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    const team = typeof getTeam === 'function' ? getTeam(playerPos) : null;
    let best = legal[0];
    let bestScore = -Infinity;

    for (const card of legal) {
      const projected = [...trickBefore, { player: playerPos, card }];
      const current = determineCurrentWinnerEntry(projected, trumpSuit);
      const pts = trickPoints(projected);

      let score = 0;
      if (projected.length === 4 && current) {
        const winnerTeam = typeof getTeam === 'function' ? getTeam(current.winner.player) : null;
        score += winnerTeam === team ? pts : -pts;
      } else if (current) {
        const winnerTeam = typeof getTeam === 'function' ? getTeam(current.winner.player) : null;
        score += winnerTeam === team ? 4 : -4;
      }

      score -= getDiscardRisk(card, trumpSuit) * 0.15;

      if (score > bestScore) {
        bestScore = score;
        best = card;
      }
    }

    return best;
  }

  function evaluateCandidate(card) {
    let total = 0;

    for (let s = 0; s < sampleCount; s++) {
      const sampledHands = sampleHandsForRemainingPlayers();
      const trick = [...(game.currentTrick || []), { player: position, card }];

      let last = position;
      while (trick.length < 4) {
        const p = typeof getNextPlayer === 'function'
          ? getNextPlayer(last)
          : ({ sud: 'ouest', ouest: 'nord', nord: 'est', est: 'sud' }[last]);

        const handP = sampledHands[p] || [];
        const legal = getPlayableCardsForSimulation(handP, trick, trumpSuit, p);
        const chosen = simulateResponseCard(legal, p, trick) || legal[0];
        if (!chosen) break;

        const idx = handP.findIndex(c => cardEquals(c, chosen));
        if (idx >= 0) handP.splice(idx, 1);
        trick.push({ player: p, card: chosen });
        last = p;
      }

      const current = determineCurrentWinnerEntry(trick, trumpSuit);
      if (!current) continue;

      const winnerTeam = typeof getTeam === 'function' ? getTeam(current.winner.player) : null;
      const pts = trickPoints(trick);

      let utility = winnerTeam === myTeam ? pts : -pts;

      if (winnerTeam === myTeam) {
        utility += current.winner.player === position ? 4 : 2;
      } else {
        utility -= 2;
      }

      const discardPenalty = winnerTeam === myTeam ? 0.05 : 0.45;
      utility -= getDiscardRisk(card, trumpSuit) * discardPenalty;

      total += utility;
    }

    return total / sampleCount;
  }

  const candidateCards = shouldPullTrumpsNow
    ? playable.filter(c => c.suit === trumpSuit)
    : playable;

  const cardsToEvaluate = candidateCards.length > 0 ? candidateCards : playable;

  let bestCard = cardsToEvaluate[0];
  let bestScore = -Infinity;
  for (const c of cardsToEvaluate) {
    const score = evaluateCandidate(c);
    if (score > bestScore) {
      bestScore = score;
      bestCard = c;
    }
  }

  return bestCard || pickRandom(playable);
}

module.exports = {
  chooseBid,
  chooseCard
};
