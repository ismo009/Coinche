// Simple server-side bot logic for Coinche.
// Focus: keep decision logic isolated and easy to tweak.

const { SUITS } = require('../game');

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

function chooseBid(game) {
  // Keep previous behavior constraint: if any bid already exists, bot passes.
  const hasAnyBid = Array.isArray(game.bids) && game.bids.some(b => b.type === 'bid');
  if (hasAnyBid) return { type: 'pass' };

  const hand = game.hands?.[game.currentPlayer] || [];
  const best = bestBidFromHand(hand);
  if (!best || !best.points || best.points < 80) {
    // If opening hand looks weak, still open at 80 in a random suit?
    // Prefer conservative: pass.
    return { type: 'pass' };
  }
  return { type: 'bid', points: best.points, suit: best.suit };
}

function chooseCard(game, position) {
  const hand = game.hands?.[position] || [];
  const trumpSuit = game.contract?.suit;

  if (!hand.length || !trumpSuit) return null;

  // Use engine rule for playable cards.
  // It's not exported; we can rely on getStateForPlayer which exposes playableCards.
  const stateForBot = game.getStateForPlayer(position);
  const playable = stateForBot.playableCards || [];

  if (!playable.length) return null;

  const contractTeam = game.contract?.team;
  const myTeam = game.getStateForPlayer(position)?.myTeam;
  const iAmAttack = !!contractTeam && contractTeam === myTeam;

  const partnerByPos = { sud: 'nord', nord: 'sud', est: 'ouest', ouest: 'est' };
  const partnerPos = partnerByPos[position];

  // --- History helpers ---
  const history = Array.isArray(stateForBot.playHistory) ? stateForBot.playHistory : [];
  const playedCards = history.map(h => h.card).filter(Boolean);

  const allTrumps = (tSuit) => {
    if (tSuit === 'sans-atout') return [];
    if (tSuit === 'tout-atout') return ['coeur', 'carreau', 'trefle', 'pique'];
    return [tSuit];
  };

  const trumpSuits = allTrumps(trumpSuit);
  const isTrumpCard = (card) => {
    if (!card) return false;
    if (trumpSuit === 'sans-atout') return false;
    if (trumpSuit === 'tout-atout') return true;
    return card.suit === trumpSuit;
  };

  const trumpPlayedCount = playedCards.filter(isTrumpCard).length;
  const totalTrumpCards = trumpSuit === 'sans-atout' ? 0 : (trumpSuit === 'tout-atout' ? 32 : 8);
  const trumpsRemainingGlobal = Math.max(0, totalTrumpCards - trumpPlayedCount);

  const hasRankBeenPlayed = (suit, rank) => playedCards.some(c => c.suit === suit && c.rank === rank);
  const isAceMasterLikely = (suit) => !hasRankBeenPlayed(suit, 'as');
  const isTenSecond = (suit) => hasRankBeenPlayed(suit, 'as') && !hasRankBeenPlayed(suit, '10');

  // Simple strength ordering (matches engine definitions)
  const TRUMP_ORDER = ['7', '8', 'dame', 'roi', '10', 'as', '9', 'valet'];
  const PLAIN_ORDER = ['7', '8', '9', 'valet', 'dame', 'roi', '10', 'as'];

  // Current trick info
  const trick = game.currentTrick || [];
  const ledSuit = trick.length ? trick[0].card.suit : null;
  const partnerHasPlayedThisTrick = trick.some(p => p.player === partnerPos);

  const strengthInTrick = (card, led) => {
    if (!card || !led) return -999;
    // sans-atout: only led suit matters
    if (trumpSuit === 'sans-atout') {
      return card.suit === led ? PLAIN_ORDER.indexOf(card.rank) : -1;
    }

    // tout-atout: every suit uses trump order, but must follow led suit
    if (trumpSuit === 'tout-atout') {
      return card.suit === led ? (100 + TRUMP_ORDER.indexOf(card.rank)) : -1;
    }

    // normal trump
    if (card.suit === trumpSuit) return 100 + TRUMP_ORDER.indexOf(card.rank);
    return card.suit === led ? PLAIN_ORDER.indexOf(card.rank) : -1;
  };

  const getCurrentTrickWinner = () => {
    if (!trick.length) return null;
    const led = trick[0].card.suit;
    let best = trick[0];
    let bestStr = strengthInTrick(best.card, led);
    for (let i = 1; i < trick.length; i++) {
      const s = strengthInTrick(trick[i].card, led);
      if (s > bestStr) {
        bestStr = s;
        best = trick[i];
      }
    }
    return { player: best.player, card: best.card, strength: bestStr, ledSuit: led };
  };
  const strength = (card) => {
    if (!card) return -999;
    if (trumpSuit === 'sans-atout') {
      // higher = stronger
      return PLAIN_ORDER.indexOf(card.rank);
    }
    if (trumpSuit === 'tout-atout') {
      return TRUMP_ORDER.indexOf(card.rank);
    }
    if (card.suit === trumpSuit) return 100 + TRUMP_ORDER.indexOf(card.rank);
    return PLAIN_ORDER.indexOf(card.rank);
  };

  const valueForDiscard = (card) => {
    if (!card) return 0;
    // Rough points preservation
    if (card.rank === 'as') return 50;
    if (card.rank === '10') return 35;
    if (card.rank === 'roi') return 10;
    if (card.rank === 'dame') return 8;
    if (card.rank === 'valet') return isTrumpCard(card) ? 45 : 6;
    if (card.rank === '9') return isTrumpCard(card) ? 30 : 2;
    return 1;
  };

  const filterTrumps = (cards) => cards.filter(isTrumpCard);
  const filterNonTrumps = (cards) => cards.filter(c => !isTrumpCard(c));
  const lowestByStrength = (cards) => [...cards].sort((a, b) => strength(a) - strength(b))[0] || null;
  const highestByStrength = (cards) => [...cards].sort((a, b) => strength(b) - strength(a))[0] || null;

  const currentWinner = getCurrentTrickWinner();
  const partnerCurrentlyWinning = !!currentWinner && currentWinner.player === partnerPos;
  const iAmCurrentlyWinning = !!currentWinner && currentWinner.player === position;

  const minimalWinningCard = (cards) => {
    if (!currentWinner || !cards.length) return null;
    const led = currentWinner.ledSuit;
    const target = currentWinner.strength;
    const winners = cards
      .map(c => ({ c, s: strengthInTrick(c, led) }))
      .filter(x => x.s > target)
      .sort((a, b) => a.s - b.s);
    return winners[0]?.c || null;
  };

  // --- Decision policy ---
  // 1) If on attack: pull trumps early while trumps remain.
  //    Prefer low trump if partner already in trick (to avoid wasting), else choose a mid/high trump.
  if (iAmAttack && trumpSuit !== 'sans-atout' && trumpsRemainingGlobal > 0) {
    const playableTrumps = filterTrumps(playable);
    if (playableTrumps.length) {
      // If partner is already winning this trick, conserve.
      if (partnerHasPlayedThisTrick && partnerCurrentlyWinning) {
        return lowestByStrength(playableTrumps);
      }

      // If we are not winning and need to take, use the smallest winning trump if possible.
      if (currentWinner && !partnerCurrentlyWinning && !iAmCurrentlyWinning) {
        const win = minimalWinningCard(playableTrumps);
        if (win) return win;
      }

      // Otherwise keep pressure: play a strong trump.
      return highestByStrength(playableTrumps);
    }
  }

  // 2) Play master aces when you can lead or follow safely.
  //    If ledSuit is present, and ace of that suit is playable and likely master, do it.
  const playableAces = playable.filter(c => c.rank === 'as');
  const masterAce = playableAces.find(c => isAceMasterLikely(c.suit));
  if (masterAce) {
    // At suit contracts, avoid throwing an ace into a cut if trumps still around and we're leading.
    if (trumpSuit !== 'sans-atout' && trick.length === 0 && trumpsRemainingGlobal > 4) {
      // Prefer pulling trumps already handled above; otherwise keep ace for later.
    } else {
      return masterAce;
    }
  }

  // 3) Protect 10s until they become “second” (Ace played).
  //    If you have a 10 that is NOT second, avoid playing it unless forced.
  const tens = playable.filter(c => c.rank === '10');
  const unsafeTen = tens.find(c => !isTenSecond(c.suit));
  if (unsafeTen && playable.length > 1) {
    const withoutUnsafeTen = playable.filter(c => !(c.suit === unsafeTen.suit && c.rank === '10'));
    if (withoutUnsafeTen.length) {
      // Prefer low discard
      return lowestByStrength(withoutUnsafeTen);
    }
  }

  // 4) If you can play a “10 second”, prefer cashing it.
  const safeTen = tens.find(c => isTenSecond(c.suit));
  if (safeTen) return safeTen;

  // 5) Defense preference: if defending and can play trumps, try to cut/pull too.
  if (!iAmAttack && trumpSuit !== 'sans-atout') {
    const playableTrumps = filterTrumps(playable);
    if (playableTrumps.length) {
      if (partnerCurrentlyWinning) return lowestByStrength(playableTrumps);
      if (currentWinner) {
        const win = minimalWinningCard(playableTrumps);
        if (win) return win;
      }
      return highestByStrength(playableTrumps);
    }
  }

  // 6) Default: discard the lowest-value card (avoid dropping points)
  const sortedByDiscard = [...playable].sort((a, b) => valueForDiscard(a) - valueForDiscard(b));
  return sortedByDiscard[0] || pickRandom(playable);
}

module.exports = {
  chooseBid,
  chooseCard
};
