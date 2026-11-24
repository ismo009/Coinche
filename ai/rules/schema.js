// ============================================================
// Schémas des identifiants et fonctions disponibles dans les règles.
// C'est la "liste officielle" de ce que les règles peuvent utiliser :
// toute autre référence est signalée par /debug rule.
// Toute modification ici doit être reportée dans RULE.md.
// ============================================================
const { T } = require('./expression');

const SUITS = ['coeur', 'carreau', 'trefle', 'pique'];
const CONTRACT_SUITS = [...SUITS, 'tout-atout', 'sans-atout'];
const RANKS = ['7', '8', '9', '10', 'valet', 'dame', 'roi', 'as'];
const POSITIONS = ['sud', 'ouest', 'nord', 'est'];

const suitEnum = T.enumOf(SUITS);
const contractSuitEnum = T.enumOf(CONTRACT_SUITS);
const rankEnum = T.enumOf(RANKS);
const positionEnum = T.enumOf(POSITIONS);
const teamEnum = T.enumOf(['ns', 'eo']);

// ---------------- Carte (phase de jeu) ----------------
const PLAY_CARD = T.object({
  rank: rankEnum,
  suit: suitEnum,
  isTrump: T.bool,
  points: T.number,
  order: T.number,
  power: T.number,
  isMaster: T.bool,
  unseenStronger: T.number,
  isLowestInSuit: T.bool,
  isHighestInSuit: T.bool,
  suitCount: T.number,
  isLed: T.bool,
  isDiscard: T.bool,
  winsNow: T.bool,
  risk: T.number,
  isLowSignal: T.bool,
  // Probabilistes (simulation Monte-Carlo, calculées à la demande)
  ev: T.number,
  evNet: T.number,
  evLoss: T.number,
  pWin: T.number,
  pWinMe: T.number,
  pLose: T.number,
  pCut: T.number,
  pOvertrumped: T.number
});

// Carte "simple" (annonces, cartes jouées)
const SIMPLE_CARD = T.object({
  rank: rankEnum,
  suit: suitEnum,
  points: T.number
});

const BID_ENTRY = T.object({
  who: T.enumOf(['me', 'partner', 'opponent']),
  type: T.enumOf(['bid', 'pass', 'coinche', 'surcoinche']),
  points: T.number,
  suit: contractSuitEnum
});

const BID_INFO = T.object({
  exists: T.bool,
  points: T.number,
  suit: contractSuitEnum
});

// ---------------- Annonces ----------------
const ANNONCE_IDENTIFIERS = {
  me: T.object({ position: positionEnum, team: teamEnum }),
  partner: positionEnum,
  dealer: positionEnum,
  speaker: T.number,
  turn: T.number,
  hand: T.list(SIMPLE_CARD),
  current: T.object({
    points: T.number,
    suit: contractSuitEnum,
    by: T.enumOf(['me', 'partner', 'opponent', 'none']),
    team: T.enumOf(['us', 'them', 'none'])
  }),
  coinched: T.bool,
  surcoinched: T.bool,
  canBid: T.bool,
  canCoinche: T.bool,
  canSurcoinche: T.bool,
  minBid: T.number,
  partnerBid: BID_INFO,
  opponentBid: BID_INFO,
  myBid: BID_INFO,
  bids: T.list(BID_ENTRY),
  passes: T.number,
  score: T.object({ us: T.number, them: T.number, target: T.number })
};

const ANNONCE_FUNCTIONS = {
  estimate: T.func(1, 1, T.number, { args: [contractSuitEnum] }),
  specialRisk: T.func(1, 1, T.number, { args: [contractSuitEnum] }),
  bestSuit: T.func(0, 0, contractSuitEnum),
  bestValue: T.func(0, 0, T.number),
  countSuit: T.func(1, 1, T.number, { args: [suitEnum] }),
  countRank: T.func(1, 1, T.number, { args: [rankEnum] }),
  has: T.func(2, 2, T.bool, { args: [rankEnum, suitEnum] }),
  hasBelote: T.func(1, 1, T.bool, { args: [suitEnum] }),
  defensePotential: T.func(1, 1, T.number, { args: [contractSuitEnum] }),
  opponentBeloteRisk: T.func(2, 2, T.number, { args: [contractSuitEnum] }),
  partnerRaiseAllowed: T.func(0, 0, T.bool),
  partnerRaise: T.func(2, 2, T.number, { args: [contractSuitEnum] }),
  relayOvercalled: T.func(0, 0, T.bool),
  reclaimBid: T.func(0, 0, T.number),
  reclaimSuit: T.func(0, 0, contractSuitEnum),
  bidStep: T.func(1, 1, T.number)
};

// ---------------- Jeu de la carte ----------------
const JEU_IDENTIFIERS = {
  me: T.object({ position: positionEnum, team: teamEnum }),
  partner: positionEnum,
  role: T.enumOf(['attack', 'defense']),
  trump: suitEnum,
  contract: T.object({
    points: T.number,
    suit: contractSuitEnum,
    type: T.enumOf(['couleur', 'tout-atout', 'sans-atout']),
    coinched: T.bool,
    surcoinched: T.bool,
    byMe: T.bool,
    byPartner: T.bool,
    special: T.bool
  }),
  trick: T.object({
    number: T.number,
    size: T.number,
    position: T.number,
    leading: T.bool,
    ledSuit: suitEnum,
    points: T.number,
    winner: T.enumOf(['me', 'partner', 'opponent', 'none']),
    partnerMaster: T.bool,
    opponentMaster: T.bool,
    cut: T.bool,
    isLast: T.bool,
    remaining: T.number,
    lastWinner: T.enumOf(['us', 'them', 'none']),
    cards: T.list(SIMPLE_CARD)
  }),
  hand: T.list(PLAY_CARD),
  playable: T.list(PLAY_CARD),
  played: T.list(SIMPLE_CARD),
  unseen: T.list(SIMPLE_CARD),
  trumps: T.object({
    mine: T.number,
    played: T.number,
    unseen: T.number,
    enemyEstimate: T.number,
    opponentsOut: T.bool
  }),
  signals: T.object({
    partnerSuit: suitEnum,
    opponentSuits: T.list(suitEnum),
    myFirstDiscard: T.bool,
    discardAvailable: T.bool
  }),
  score: T.object({ us: T.number, them: T.number, roundUs: T.number, roundThem: T.number, target: T.number })
};

const JEU_FUNCTIONS = {
  countSuit: T.func(1, 1, T.number, { args: [suitEnum] }),
  hasCard: T.func(2, 2, T.bool, { args: [rankEnum, suitEnum] }),
  isPlayed: T.func(2, 2, T.bool, { args: [rankEnum, suitEnum] }),
  unseenCount: T.func(1, 1, T.number, { args: [suitEnum] }),
  isVoid: T.func(2, 2, T.bool, { args: [T.enumOf(['partner', 'left', 'right', 'anyOpponent', 'allOpponents']), suitEnum] }),
  opponentMayCut: T.func(1, 1, T.bool, { args: [suitEnum] }),
  lowestInHand: T.func(1, 1, PLAY_CARD, { args: [suitEnum] }),
  highestInHand: T.func(1, 1, PLAY_CARD, { args: [suitEnum] }),
  masterInHand: T.func(1, 1, T.bool, { args: [suitEnum] }),
  pGain: T.func(2, 2, T.number),
  pLoss: T.func(2, 2, T.number)
};

module.exports = {
  SUITS,
  CONTRACT_SUITS,
  RANKS,
  POSITIONS,
  PLAY_CARD,
  ANNONCE_IDENTIFIERS,
  ANNONCE_FUNCTIONS,
  JEU_IDENTIFIERS,
  JEU_FUNCTIONS
};
