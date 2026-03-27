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

function estimateDefensePotentialPoints(hand, contractSuit) {
  if (!Array.isArray(hand) || hand.length === 0 || !contractSuit) return 0;

  let score = 0;

  if (contractSuit === 'sans-atout') {
    const aces = hand.filter(c => c.rank === 'as').length;
    const tens = hand.filter(c => c.rank === '10').length;
    const kings = hand.filter(c => c.rank === 'roi').length;
    const queens = hand.filter(c => c.rank === 'dame').length;

    score += aces * 18;
    score += tens * 9;
    score += kings * 2 + queens;

    for (const s of SUITS) {
      const suitCards = hand.filter(c => c.suit === s);
      if (suitCards.length >= 4) score += 3;
      if (suitCards.some(c => c.rank === 'as') && suitCards.some(c => c.rank === '10')) score += 5;
    }
    return score;
  }

  if (contractSuit === 'tout-atout') {
    const jacks = hand.filter(c => c.rank === 'valet').length;
    const nines = hand.filter(c => c.rank === '9').length;
    const aces = hand.filter(c => c.rank === 'as').length;
    const tens = hand.filter(c => c.rank === '10').length;

    score += jacks * 13;
    score += nines * 10;
    score += aces * 6;
    score += tens * 4;

    // Extra control if we own multiple top trumps across suits.
    if (jacks + nines >= 3) score += 8;
    return score;
  }

  // Suit contract defense.
  const trumpCards = hand.filter(c => c.suit === contractSuit);
  const hasJ = trumpCards.some(c => c.rank === 'valet');
  const has9 = trumpCards.some(c => c.rank === '9');
  const hasA = trumpCards.some(c => c.rank === 'as');
  const has10 = trumpCards.some(c => c.rank === '10');

  score += trumpCards.length * 4;
  if (hasJ) score += 18;
  if (has9) score += 12;
  if (hasA) score += 6;
  if (has10) score += 4;

  const sideAces = hand.filter(c => c.suit !== contractSuit && c.rank === 'as').length;
  const sideTens = hand.filter(c => c.suit !== contractSuit && c.rank === '10').length;
  score += sideAces * 10 + sideTens * 4;

  return score;
}

function estimateOpponentBeloteRiskPenalty(hand, contractSuit, bidPoints) {
  // Only relevant on a suit-trump contract.
  if (!SUITS.includes(contractSuit)) return 0;

  const hasTrumpKing = hand.some(c => c.suit === contractSuit && c.rank === 'roi');
  const hasTrumpQueen = hand.some(c => c.suit === contractSuit && c.rank === 'dame');

  // If we hold either king or queen of trump, opponents cannot have belote.
  if (hasTrumpKing || hasTrumpQueen) return 0;

  // Both K/Q are in unknown cards (24 cards at bidding start from our POV).
  // Opponents combined hold 16 cards. Baseline:
  // P(K&Q both in opponents) = C(16,2)/C(24,2) ~= 0.435
  const baseProbBeloteOpp = 120 / 276;

  // If opponents bid high, increase prior that bidder side has structure incl. belote.
  const bidBoost = Math.max(0, bidPoints - 80) * 0.0025;
  const probBeloteOpp = Math.min(0.75, baseProbBeloteOpp + bidBoost);

  // Expected penalty: belote points + slight control bonus from holding KQ at trump.
  return probBeloteOpp * 24;
}

function shouldCoincheOpponent(game, hand) {
  const topBid = getHighestBidEntry(game?.bids);
  if (!topBid || topBid.type !== 'bid') return false;
  if (!topBid.player) return false;

  // Only coinche opponent contracts, and only once.
  const myTeam = typeof getTeam === 'function' ? getTeam(game.currentPlayer) : null;
  const bidTeam = typeof getTeam === 'function' ? getTeam(topBid.player) : null;
  if (!myTeam || !bidTeam || myTeam === bidTeam) return false;
  if (Array.isArray(game.bids) && game.bids.some(b => b && b.type === 'coinche')) return false;

  // Keep special contracts out of this heuristic for now.
  if (topBid.points >= 250) return false;

  // To set contract: defense must make strictly more than (162 - bid).
  const requiredDefenseToSet = 163 - topBid.points;
  const rawDefensePotential = estimateDefensePotentialPoints(hand, topBid.suit);
  const beloteRiskPenalty = estimateOpponentBeloteRiskPenalty(hand, topBid.suit, topBid.points);

  // High bids imply stronger enemy hands: discount our raw estimate as game-theory prior.
  const enemyStrengthPenalty = Math.max(0, topBid.points - 80) * 0.32;
  const effectiveDefensePotential = rawDefensePotential - enemyStrengthPenalty - beloteRiskPenalty;
  const margin = effectiveDefensePotential - requiredDefenseToSet;

  // Be much more conservative at 80, gradually less conservative on higher bids.
  let requiredMargin = 8;
  if (topBid.points <= 90) requiredMargin = 14;
  else if (topBid.points <= 110) requiredMargin = 11;
  else if (topBid.points <= 130) requiredMargin = 8;
  else requiredMargin = 6;

  return margin >= requiredMargin;
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

  const bids = Array.isArray(game?.bids) ? game.bids : [];
  const topBidIndex = bids.lastIndexOf(topBid);
  if (topBidIndex < 0) return false;

  // Find our previous same-suit bid before partner's current top bid.
  let myPrevSuitBidIndex = -1;
  for (let i = topBidIndex - 1; i >= 0; i--) {
    const b = bids[i];
    if (!b || b.type !== 'bid') continue;
    if (b.player === game.currentPlayer && b.suit === topBid.suit) {
      myPrevSuitBidIndex = i;
      break;
    }
  }

  // If we have never announced this suit before, this is a first support, always allowed.
  if (myPrevSuitBidIndex === -1) return true;

  // Double raise is prohibited unless an opponent bid intervened between
  // our previous same-suit bid and partner's current same-suit bid.
  const myTeam = typeof getTeam === 'function' ? getTeam(game.currentPlayer) : null;
  let opponentIntervened = false;
  for (let i = myPrevSuitBidIndex + 1; i < topBidIndex; i++) {
    const b = bids[i];
    if (!b || b.type !== 'bid') continue;
    const team = typeof getTeam === 'function' ? getTeam(b.player) : null;
    if (myTeam && team && team !== myTeam) {
      opponentIntervened = true;
      break;
    }
  }

  return opponentIntervened;
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
    if (hasJ) inc += 20;
    if (has9) inc += 10;
  } else if (partnerPoints >= 100 && partnerPoints <= 120) {
    if (hasJ) inc += 20;
    if (has9) inc += 10;
    inc += aceCount * 10;
  } else {
    if (hasJ) inc += 20;
    if (has9) inc += 10;
    inc += aceCount * 10;
  }

  if (belote) inc += 20;
  return inc;
}

function chooseBid(game) {
  const hand = game.hands?.[game.currentPlayer] || [];
  const topBid = getHighestBidEntry(game.bids);
  const myTeam = typeof getTeam === 'function' ? getTeam(game.currentPlayer) : null;
  const topBidTeam = topBid?.player && typeof getTeam === 'function' ? getTeam(topBid.player) : null;

  if (shouldCoincheOpponent(game, hand)) {
    return { type: 'coinche' };
  }

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
  const contractTeam = game.contract?.team;
  const iAmAttack = !!contractTeam && contractTeam === myTeam;
  const iAmDefense = !!contractTeam && contractTeam !== myTeam;
  const partnerPos = typeof getPartner === 'function' ? getPartner(position) : null;
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

  const cardsLeft = stateForBot.cardsLeft || {};

  function inferPlayersWithoutTrump() {
    const noTrump = {};
    if (!isSuitTrumpContract) return noTrump;

    const byTrick = new Map();
    for (const h of history) {
      if (!h || !h.card) continue;
      const key = `${h.roundNumber || 0}:${h.trickNumber || 0}`;
      if (!byTrick.has(key)) byTrick.set(key, []);
      byTrick.get(key).push(h);
    }

    for (const entries of byTrick.values()) {
      entries.sort((a, b) => (a.indexInTrick || 0) - (b.indexInTrick || 0));
      if (!entries.length) continue;
      const ledSuit = entries[0].card.suit;
      if (ledSuit !== trumpSuit) continue;

      for (const play of entries) {
        if (play.card.suit !== trumpSuit) {
          noTrump[play.player] = true;
        }
      }
    }

    return noTrump;
  }

  const knownNoTrump = inferPlayersWithoutTrump();
  const opponents = Object.keys(cardsLeft).filter(p => p !== position && typeof getTeam === 'function' && getTeam(p) !== myTeam);

  function estimateEnemyTrumpCount() {
    if (!isSuitTrumpContract) return 0;
    if (unknownTrumpsOutsideMyHand <= 0) return 0;

    const candidateHolders = Object.keys(cardsLeft).filter(p =>
      p !== position &&
      (cardsLeft[p] || 0) > 0 &&
      !knownNoTrump[p]
    );

    const enemyHolders = opponents.filter(p =>
      (cardsLeft[p] || 0) > 0 &&
      !knownNoTrump[p]
    );

    if (enemyHolders.length === 0) return 0;
    const totalCapacity = candidateHolders.reduce((sum, p) => sum + (cardsLeft[p] || 0), 0);
    if (totalCapacity <= 0) return 0;

    let estimate = 0;
    for (const p of enemyHolders) {
      estimate += unknownTrumpsOutsideMyHand * ((cardsLeft[p] || 0) / totalCapacity);
    }
    return Math.max(0, Math.round(estimate));
  }

  const estimatedEnemyTrumpsRemaining = estimateEnemyTrumpCount();
  const opponentsDefinitelyOutOfTrump = isSuitTrumpContract && opponents.length > 0
    ? opponents.every(p => knownNoTrump[p] || (cardsLeft[p] || 0) === 0)
    : false;

  function getOrderForCardInContract(card) {
    if (!card) return [];
    if (trumpSuit === 'tout-atout') return ALL_TRUMP_ORDER;
    if (trumpSuit === 'sans-atout') return NO_TRUMP_ORDER;
    if (isSuitTrumpContract && card.suit === trumpSuit) return TRUMP_ORDER;
    return PLAIN_ORDER;
  }

  function countUnseenStrongerCards(card) {
    if (!card) return 0;
    const order = getOrderForCardInContract(card);
    const idx = order.indexOf(card.rank);
    if (idx < 0) return 0;

    let unseen = 0;
    const strongerRanks = order.slice(idx + 1);
    for (const rank of strongerRanks) {
      const already = alreadyPlayed.some(c => c.suit === card.suit && c.rank === rank);
      if (already) continue;
      const inMyHand = hand.some(c => c.suit === card.suit && c.rank === rank);
      if (!inMyHand) unseen++;
    }
    return unseen;
  }

  function hasPotentiallyStrongerEnemyTrump(card) {
    if (!isSuitTrumpContract || !card || card.suit !== trumpSuit) return false;
    const idx = TRUMP_ORDER.indexOf(card.rank);
    if (idx < 0) return false;

    const strongerRanks = TRUMP_ORDER.slice(idx + 1);
    for (const rank of strongerRanks) {
      const already = alreadyPlayed.some(c => c.suit === trumpSuit && c.rank === rank);
      if (already) continue;
      const inMyHand = hand.some(c => c.suit === trumpSuit && c.rank === rank);
      if (!inMyHand) return true;
    }
    return false;
  }

  const shouldPullTrumpsNow =
    isSuitTrumpContract &&
    isLeadingNewTrick &&
    teamJustWonPreviousTrick &&
    iAmAttack &&
    myTrumpCount > 0 &&
    unknownTrumpsOutsideMyHand > 0 &&
    !opponentsDefinitelyOutOfTrump &&
    estimatedEnemyTrumpsRemaining > 0;

  const shouldForceTrumpLeadAtFirstTrick =
    isSuitTrumpContract &&
    isLeadingNewTrick &&
    iAmAttack &&
    game.trickNumber === 1 &&
    myTrumpCount > 0 &&
    unknownTrumpsOutsideMyHand > 0 &&
    !opponentsDefinitelyOutOfTrump;

  const shouldAvoidDefenseTrumpLead =
    isSuitTrumpContract &&
    isLeadingNewTrick &&
    iAmDefense;

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
    const currentTrickBeforePlay = Array.isArray(game.currentTrick) ? game.currentTrick : [];
    const ledSuitNow = currentTrickBeforePlay.length > 0 ? currentTrickBeforePlay[0].card.suit : null;
    const winnerBeforePlay = currentTrickBeforePlay.length > 0
      ? determineCurrentWinnerEntry(currentTrickBeforePlay, trumpSuit)
      : null;

    // Conservation reflex:
    // If partner is already master of the current trick, strongly avoid dumping
    // a likely master off-trump ace on another suit.
    const isOffTrumpAce = isSuitTrumpContract && card.rank === 'as' && card.suit !== trumpSuit;
    const discardingOnDifferentSuit = !!ledSuitNow && card.suit !== ledSuitNow;
    const partnerCurrentlyMaster = !!winnerBeforePlay && !!partnerPos && winnerBeforePlay.winner.player === partnerPos;
    const asAlreadyPlayedInSuit = alreadyPlayed.some(c => c.suit === card.suit && c.rank === 'as');
    const tenAlreadyPlayedInSuit = alreadyPlayed.some(c => c.suit === card.suit && c.rank === '10');
    const likelyMasterAce = isOffTrumpAce && !asAlreadyPlayedInSuit;
    const isOffTrumpSecondTen =
      isSuitTrumpContract &&
      card.rank === '10' &&
      card.suit !== trumpSuit &&
      asAlreadyPlayedInSuit &&
      !tenAlreadyPlayedInSuit;

    const conservationPenalty = partnerCurrentlyMaster && discardingOnDifferentSuit && likelyMasterAce
      ? 18
      : 0;

    let secondTenConservationPenalty = 0;
    if (partnerCurrentlyMaster && discardingOnDifferentSuit && isOffTrumpSecondTen) {
      // Stronger conservation when enemy trumps are low, because cashing the 10 later is more realistic.
      if (estimatedEnemyTrumpsRemaining <= 1) secondTenConservationPenalty = 14;
      else if (estimatedEnemyTrumpsRemaining <= 3) secondTenConservationPenalty = 11;
      else if (estimatedEnemyTrumpsRemaining <= 5) secondTenConservationPenalty = 8;
      else secondTenConservationPenalty = 5;
    }

    // Master conservation in TA/SA (and also valid in suit contracts):
    // if partner already wins the trick, avoid spending current or second masters
    // when a lower legal card exists.
    let masterConservationPenalty = 0;
    const lowerLegalAlternative = playable.some(c =>
      c.suit === card.suit &&
      getOrderForCardInContract(c).indexOf(c.rank) < getOrderForCardInContract(card).indexOf(card.rank)
    );
    const unseenStronger = countUnseenStrongerCards(card);
    const isCurrentMaster = unseenStronger === 0;
    const isSecondMaster = unseenStronger === 1;

    if (partnerCurrentlyMaster && lowerLegalAlternative) {
      if (trumpSuit === 'tout-atout') {
        if (isCurrentMaster) masterConservationPenalty = 18;
        else if (isSecondMaster) masterConservationPenalty = 16;
      }

      if (trumpSuit === 'sans-atout') {
        if (isCurrentMaster) masterConservationPenalty = 17;
        else if (isSecondMaster) masterConservationPenalty = 14;
      }
    }

    // Preserve "second master" trumps when possible.
    // Example: with 8 + 9 at trump and jack still out, prefer 8 first to keep 9 for later.
    let secondMasterTrumpConservationPenalty = 0;
    if (isSuitTrumpContract && card.suit === trumpSuit) {
      const lowerTrumpPlayable = playable.some(c =>
        c.suit === trumpSuit && TRUMP_ORDER.indexOf(c.rank) < TRUMP_ORDER.indexOf(card.rank)
      );

      const partnerCurrentlyMaster = !!winnerBeforePlay && !!partnerPos && winnerBeforePlay.winner.player === partnerPos;
      const dangerousToCashNow = hasPotentiallyStrongerEnemyTrump(card);

      if (lowerTrumpPlayable && dangerousToCashNow) {
        if (partnerCurrentlyMaster) {
          secondMasterTrumpConservationPenalty = 14;
        } else if (isLeadingNewTrick) {
          secondMasterTrumpConservationPenalty = 10;
        } else {
          secondMasterTrumpConservationPenalty = 6;
        }

        // If enemy trumps are still many, the card is even more exposed.
        if (estimatedEnemyTrumpsRemaining >= 3) {
          secondMasterTrumpConservationPenalty += 2;
        }
      }
    }

    let defenseTrumpConservationPenalty = 0;
    if (isSuitTrumpContract && iAmDefense && card.suit === trumpSuit) {
      if (isLeadingNewTrick) {
        defenseTrumpConservationPenalty += (card.rank === 'valet' ? 24 : 15);
      }
      if (partnerCurrentlyMaster) {
        defenseTrumpConservationPenalty += 8;
      }
    }

    let firstTrickTrumpPressure = 0;
    if (isSuitTrumpContract && iAmAttack && isLeadingNewTrick && game.trickNumber === 1) {
      if (card.suit === trumpSuit) {
        // Strong incentive to start pulling enemy trumps immediately.
        // Keep a small preference for cheaper trumps over burning masters.
        firstTrickTrumpPressure += 20 - (getDiscardRisk(card, trumpSuit) * 0.15);
      } else {
        // Discourage cashing side aces/10 before trumps are drawn.
        firstTrickTrumpPressure -= 14;
      }
    }

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
      utility -= conservationPenalty;
      utility -= secondTenConservationPenalty;
      utility -= masterConservationPenalty;
      utility -= secondMasterTrumpConservationPenalty;
      utility -= defenseTrumpConservationPenalty;
      utility += firstTrickTrumpPressure;

      total += utility;
    }

    return total / sampleCount;
  }

  const candidateCards = shouldForceTrumpLeadAtFirstTrick
    ? playable.filter(c => c.suit === trumpSuit)
    : shouldPullTrumpsNow
      ? playable.filter(c => c.suit === trumpSuit)
      : shouldAvoidDefenseTrumpLead
        ? playable.filter(c => c.suit !== trumpSuit)
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
