// Simple server-side bot logic for Coinche.
// Kept intentionally small and deterministic except for RNG.

const { SUITS } = require('../game');

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function chooseBid(game) {
  // Spec:
  // - chooses a random suit
  // - bids 80 if no bid exists yet, otherwise passes
  const hasAnyBid = Array.isArray(game.bids) && game.bids.some(b => b.type === 'bid');
  if (hasAnyBid) {
    return { type: 'pass' };
  }

  const suit = pickRandom(SUITS);
  return { type: 'bid', points: 80, suit };
}

function chooseCard(game, position) {
  const hand = game.hands?.[position] || [];
  const trick = game.currentTrick || [];
  const trumpSuit = game.contract?.suit;

  if (!hand.length || !trumpSuit) return null;

  // Use engine rule for playable cards.
  // It's not exported; we can rely on getStateForPlayer which exposes playableCards.
  const stateForBot = game.getStateForPlayer(position);
  const playable = stateForBot.playableCards || [];

  return pickRandom(playable);
}

module.exports = {
  chooseBid,
  chooseCard
};
