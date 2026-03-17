// ============================================================
// Coinche Game Engine - Logique complète du jeu
// ============================================================

const SUITS = ['coeur', 'carreau', 'trefle', 'pique'];
const RANKS = ['7', '8', '9', '10', 'valet', 'dame', 'roi', 'as'];
const POSITIONS = ['sud', 'ouest', 'nord', 'est'];

// Valeurs des cartes en atout
const TRUMP_VALUES = {
  'valet': 20, '9': 14, 'as': 11, '10': 10, 'roi': 4, 'dame': 3, '8': 0, '7': 0
};

// Valeurs des cartes hors atout
const PLAIN_VALUES = {
  'as': 11, '10': 10, 'roi': 4, 'dame': 3, 'valet': 2, '9': 0, '8': 0, '7': 0
};

// Valeurs "tout atout"
const ALL_TRUMP_VALUES = {
  'valet': 14, '9': 9, 'as': 6, '10': 5, 'roi': 3, 'dame': 1, '8': 0, '7': 0
};

// Valeurs "sans atout"
const NO_TRUMP_VALUES = {
  'as': 19, '10': 10, 'roi': 4, 'dame': 3, 'valet': 2, '9': 0, '8': 0, '7': 0
};

// Ordre de force en atout
const TRUMP_ORDER = ['7', '8', 'dame', 'roi', '10', 'as', '9', 'valet'];
// Ordre de force hors atout
const PLAIN_ORDER = ['7', '8', '9', 'valet', 'dame', 'roi', '10', 'as'];
// Ordre tout atout
const ALL_TRUMP_ORDER = ['7', '8', 'dame', 'roi', '10', 'as', '9', 'valet'];
// Ordre sans atout
const NO_TRUMP_ORDER = ['7', '8', '9', 'valet', 'dame', 'roi', '10', 'as'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function dealCards(deck) {
  // Distribue 8 cartes par joueur (3-2-3 classique)
  const hands = { sud: [], ouest: [], nord: [], est: [] };
  const positions = POSITIONS;
  let idx = 0;
  // Premier tour: 3 cartes chacun
  for (const pos of positions) {
    hands[pos].push(deck[idx++], deck[idx++], deck[idx++]);
  }
  // Deuxième tour: 2 cartes chacun
  for (const pos of positions) {
    hands[pos].push(deck[idx++], deck[idx++]);
  }
  // Troisième tour: 3 cartes chacun
  for (const pos of positions) {
    hands[pos].push(deck[idx++], deck[idx++], deck[idx++]);
  }
  return hands;
}

function getCardValue(card, trumpSuit) {
  if (trumpSuit === 'tout-atout') {
    return ALL_TRUMP_VALUES[card.rank] || 0;
  }
  if (trumpSuit === 'sans-atout') {
    return NO_TRUMP_VALUES[card.rank] || 0;
  }
  if (card.suit === trumpSuit) {
    return TRUMP_VALUES[card.rank] || 0;
  }
  return PLAIN_VALUES[card.rank] || 0;
}

function getCardStrength(card, trumpSuit, ledSuit) {
  let order;
  if (trumpSuit === 'tout-atout') {
    order = ALL_TRUMP_ORDER;
  } else if (trumpSuit === 'sans-atout') {
    order = NO_TRUMP_ORDER;
  } else if (card.suit === trumpSuit) {
    // C'est un atout
    return 100 + TRUMP_ORDER.indexOf(card.rank);
  } else {
    order = PLAIN_ORDER;
  }

  if (card.suit === ledSuit) {
    return order.indexOf(card.rank);
  }
  // Carte d'une autre couleur (ni atout, ni couleur demandée)
  return -1;
}

function determineTrickWinner(trick, trumpSuit) {
  const ledSuit = trick[0].card.suit;
  let winner = trick[0];
  let bestStrength = getCardStrength(trick[0].card, trumpSuit, ledSuit);

  for (let i = 1; i < trick.length; i++) {
    const strength = getCardStrength(trick[i].card, trumpSuit, ledSuit);
    if (strength > bestStrength) {
      bestStrength = strength;
      winner = trick[i];
    }
  }
  return winner.player;
}

function calculateTrickPoints(trick, trumpSuit) {
  let points = 0;
  for (const play of trick) {
    points += getCardValue(play.card, trumpSuit);
  }
  return points;
}

function getTeam(position) {
  return (position === 'sud' || position === 'nord') ? 'ns' : 'eo';
}

function getPartner(position) {
  const partners = { sud: 'nord', nord: 'sud', est: 'ouest', ouest: 'est' };
  return partners[position];
}

function getNextPlayer(position) {
  const idx = POSITIONS.indexOf(position);
  return POSITIONS[(idx + 1) % 4];
}

function sortHand(hand, trumpSuit) {
  const suitOrder = ['pique', 'coeur', 'trefle', 'carreau'];
  return [...hand].sort((a, b) => {
    // D'abord par couleur
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    // Puis par force
    let orderA, orderB;
    if (trumpSuit === 'tout-atout') {
      orderA = ALL_TRUMP_ORDER;
      orderB = ALL_TRUMP_ORDER;
    } else if (trumpSuit === 'sans-atout') {
      orderA = NO_TRUMP_ORDER;
      orderB = NO_TRUMP_ORDER;
    } else {
      orderA = a.suit === trumpSuit ? TRUMP_ORDER : PLAIN_ORDER;
      orderB = b.suit === trumpSuit ? TRUMP_ORDER : PLAIN_ORDER;
    }
    return orderA.indexOf(a.rank) - orderB.indexOf(b.rank);
  });
}

function getPlayableCards(hand, trick, trumpSuit) {
  // Si c'est la première carte du pli, tout est jouable
  if (trick.length === 0) return hand;

  const ledSuit = trick[0].card.suit;
  const cardsOfLedSuit = hand.filter(c => c.suit === ledSuit);

  // Mode sans atout: on doit juste fournir la couleur demandée
  if (trumpSuit === 'sans-atout') {
    if (cardsOfLedSuit.length > 0) return cardsOfLedSuit;
    return hand;
  }

  // Mode tout atout: on doit fournir et monter si possible
  if (trumpSuit === 'tout-atout') {
    if (cardsOfLedSuit.length > 0) {
      // On doit monter si possible
      const highestPlayed = getHighestTrumpInTrick(trick, ledSuit);
      const higherCards = cardsOfLedSuit.filter(c =>
        ALL_TRUMP_ORDER.indexOf(c.rank) > ALL_TRUMP_ORDER.indexOf(highestPlayed)
      );
      return higherCards.length > 0 ? higherCards : cardsOfLedSuit;
    }
    return hand;
  }

  // Mode normal avec une couleur d'atout spécifique
  if (ledSuit === trumpSuit) {
    // Atout demandé: on doit fournir et monter
    if (cardsOfLedSuit.length > 0) {
      const highestPlayed = getHighestTrumpInTrick(trick, trumpSuit);
      const higherCards = cardsOfLedSuit.filter(c =>
        TRUMP_ORDER.indexOf(c.rank) > TRUMP_ORDER.indexOf(highestPlayed)
      );
      return higherCards.length > 0 ? higherCards : cardsOfLedSuit;
    }
    return hand; // Pas d'atout, on joue ce qu'on veut
  }

  // Couleur non-atout demandée
  if (cardsOfLedSuit.length > 0) return cardsOfLedSuit;

  // Pas la couleur demandée
  const trumpCards = hand.filter(c => c.suit === trumpSuit);

  // On doit couper si on peut
  if (trumpCards.length > 0) {
    // Vérifier si le partenaire est maître du pli
    const currentWinner = determineTrickWinnerPartial(trick, trumpSuit);
    const myTeam = null; // On ne connaît pas encore le joueur ici

    // On vérifie si un atout a déjà été joué
    const highestTrumpPlayed = getHighestTrumpInTrick(trick, trumpSuit);
    if (highestTrumpPlayed) {
      // On doit monter si possible
      const higherTrumps = trumpCards.filter(c =>
        TRUMP_ORDER.indexOf(c.rank) > TRUMP_ORDER.indexOf(highestTrumpPlayed)
      );
      if (higherTrumps.length > 0) return higherTrumps;
      // On ne peut pas monter, on doit quand même couper (pisser)
      return trumpCards;
    }
    return trumpCards;
  }

  // Pas d'atout non plus: on joue ce qu'on veut (défausser)
  return hand;
}

function getPlayableCardsWithPlayer(hand, trick, trumpSuit, playerPosition) {
  if (trick.length === 0) return hand;

  const ledSuit = trick[0].card.suit;
  const cardsOfLedSuit = hand.filter(c => c.suit === ledSuit);

  if (trumpSuit === 'sans-atout') {
    if (cardsOfLedSuit.length > 0) return cardsOfLedSuit;
    return hand;
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

  // Couleur non-atout demandée, on n'a pas la couleur
  if (cardsOfLedSuit.length > 0) return cardsOfLedSuit;

  const trumpCards = hand.filter(c => c.suit === trumpSuit);

  if (trumpCards.length > 0) {
    // Vérifier si le partenaire mène le pli
    const currentWinner = determineTrickWinnerPartial(trick, trumpSuit);
    const partnerPos = getPartner(playerPosition);
    if (currentWinner === partnerPos) {
      // Le partenaire mène, on peut défausser ou couper (pas obligé de surcouper)
      return hand;
    }

    const highestTrumpPlayed = getHighestTrumpInTrick(trick, trumpSuit);
    if (highestTrumpPlayed) {
      const higherTrumps = trumpCards.filter(c =>
        TRUMP_ORDER.indexOf(c.rank) > TRUMP_ORDER.indexOf(highestTrumpPlayed)
      );
      if (higherTrumps.length > 0) return higherTrumps;
      return trumpCards;
    }
    return trumpCards;
  }

  return hand;
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

function determineTrickWinnerPartial(trick, trumpSuit) {
  if (trick.length === 0) return null;
  const ledSuit = trick[0].card.suit;
  let winner = trick[0];
  let bestStrength = getCardStrength(trick[0].card, trumpSuit, ledSuit);
  for (let i = 1; i < trick.length; i++) {
    const strength = getCardStrength(trick[i].card, trumpSuit, ledSuit);
    if (strength > bestStrength) {
      bestStrength = strength;
      winner = trick[i];
    }
  }
  return winner.player;
}

function cardEquals(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}

function hasBeloteRebelote(hand, trumpSuit) {
  if (trumpSuit === 'sans-atout') return [];

  if (trumpSuit === 'tout-atout') {
    // En tout-atout, chaque couleur peut donner une belote
    const beloteSuits = [];
    for (const suit of SUITS) {
      const hasKing = hand.some(c => c.suit === suit && c.rank === 'roi');
      const hasQueen = hand.some(c => c.suit === suit && c.rank === 'dame');
      if (hasKing && hasQueen) beloteSuits.push(suit);
    }
    return beloteSuits;
  }

  const hasKing = hand.some(c => c.suit === trumpSuit && c.rank === 'roi');
  const hasQueen = hand.some(c => c.suit === trumpSuit && c.rank === 'dame');
  return (hasKing && hasQueen) ? [trumpSuit] : [];
}

function roundScore(value) {
  return Math.round(value / 10) * 10;
}

// ============================================================
// Classe principale du jeu
// ============================================================

class CoincheGame {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = {}; // { position: { id, name } }
    this.state = 'waiting'; // waiting, bidding, playing, scoring, finished

    // Score global (parties)
    this.scores = { ns: 0, eo: 0 };
    this.targetScore = 2000;

    // Manche en cours
    this.dealer = 'sud';
    this.hands = {};
    this.contract = null; // { team, player, points, suit, coinched, surcoinched }
    this.currentPlayer = null;

    // Enchères
    this.bids = [];
    this.passCount = 0;
    this.lastBidder = null;
    this.coincheBy = null;
    this.surcoincheBy = null;

    // Plis
    this.currentTrick = [];
    this.trickNumber = 0;
    this.tricksTaken = { ns: [], eo: [] };
    this.roundPoints = { ns: 0, eo: 0 };

    // Belote (par couleur pour supporter tout-atout)
    this.beloteAnnounced = { ns: {}, eo: {} };
    this.belotePlayers = {}; // position -> [suit1, suit2, ...] couleurs avec belote

    // Historique
    this.lastTrick = null;
    this.roundHistory = [];
    this.roundNumber = 0;
  }

  addPlayer(playerId, playerName, position) {
    if (this.players[position]) return false;
    this.players[position] = { id: playerId, name: playerName };
    return true;
  }

  removePlayer(playerId) {
    for (const pos of POSITIONS) {
      if (this.players[pos] && this.players[pos].id === playerId) {
        delete this.players[pos];
        return pos;
      }
    }
    return null;
  }

  getPlayerPosition(playerId) {
    for (const pos of POSITIONS) {
      if (this.players[pos] && this.players[pos].id === playerId) {
        return pos;
      }
    }
    return null;
  }

  isFull() {
    return POSITIONS.every(pos => this.players[pos]);
  }

  startNewRound() {
    const deck = shuffleDeck(createDeck());
    this.hands = dealCards(deck);
    this.contract = null;
    this.bids = [];
    this.passCount = 0;
    this.lastBidder = null;
    this.coincheBy = null;
    this.surcoincheBy = null;
    this.currentTrick = [];
    this.trickNumber = 0;
    this.tricksTaken = { ns: [], eo: [] };
    this.roundPoints = { ns: 0, eo: 0 };
    this.beloteAnnounced = { ns: {}, eo: {} };
    this.belotePlayers = {};
    this.lastTrick = null;

    // Le joueur après le donneur commence les enchères
    this.currentPlayer = getNextPlayer(this.dealer);
    this.state = 'bidding';

    // Vérifier la belote pour chaque joueur (sera annoncée plus tard)
    for (const pos of POSITIONS) {
      // On ne peut pas checker la belote pendant les enchères car on ne connaît pas l'atout
    }

    return true;
  }

  placeBid(playerPosition, bid) {
    if (this.state !== 'bidding') return { success: false, error: 'Pas en phase d\'enchères' };
    if (playerPosition !== this.currentPlayer) return { success: false, error: 'Ce n\'est pas votre tour' };

    if (bid.type === 'pass') {
      this.passCount++;
      this.bids.push({ player: playerPosition, type: 'pass' });

      // Si tout le monde passe sans enchère, on redistribue
      if (this.passCount >= 4 && !this.lastBidder) {
        this.dealer = getNextPlayer(this.dealer);
        return { success: true, action: 'redistribute' };
      }

      // Après une coinche, on attend 3 réponses (pass/surcoinche) avant de lancer le jeu.
      if (this.coincheBy && this.passCount >= 3) {
        return this.startPlaying();
      }

      // Si enchère simple: 3 passes clôturent les enchères
      if (this.lastBidder && this.passCount >= 3) {
        return this.startPlaying();
      }

      this.currentPlayer = getNextPlayer(this.currentPlayer);
      return { success: true, action: 'next' };
    }

    if (bid.type === 'coinche') {
      // On ne peut coincher que si l'adversaire a enchéri
      if (!this.lastBidder) return { success: false, error: 'Pas d\'enchère à coincher' };
      if (this.coincheBy) return { success: false, error: 'Déjà coinché' };
      const bidderTeam = getTeam(this.lastBidder);
      const myTeam = getTeam(playerPosition);
      if (bidderTeam === myTeam) return { success: false, error: 'Vous ne pouvez pas coincher votre partenaire' };

      this.coincheBy = playerPosition;
      this.passCount = 0;
      this.bids.push({ player: playerPosition, type: 'coinche' });
      this.currentPlayer = getNextPlayer(playerPosition);
      return { success: true, action: 'coinche' };
    }

    if (bid.type === 'surcoinche') {
      if (!this.coincheBy) return { success: false, error: 'Pas de coinche à surcoincher' };
      if (this.surcoincheBy) return { success: false, error: 'Déjà surcoincé' };
      const coincheTeam = getTeam(this.coincheBy);
      const myTeam = getTeam(playerPosition);
      if (coincheTeam === myTeam) return { success: false, error: 'Vous ne pouvez pas surcoincher' };

      this.surcoincheBy = playerPosition;
      this.bids.push({ player: playerPosition, type: 'surcoinche' });
      // La sur-coinche lance directement le jeu
      return this.startPlaying();
    }

    if (bid.type === 'bid') {
      if (this.coincheBy) return { success: false, error: 'Enchère coinchée, vous pouvez seulement passer ou surcoincher' };

      const validPoints = [80, 90, 100, 110, 120, 130, 140, 150, 160, 250, 400, 500];
      if (!validPoints.includes(bid.points)) {
        return { success: false, error: 'Nombre de points invalide' };
      }

      const validSuits = ['coeur', 'carreau', 'trefle', 'pique', 'tout-atout', 'sans-atout'];
      if (!validSuits.includes(bid.suit)) {
        return { success: false, error: 'Couleur invalide' };
      }

      // L'enchère doit être supérieure à la précédente
      if (this.contract && bid.points <= this.contract.points) {
        return { success: false, error: 'L\'enchère doit être supérieure à ' + this.contract.points };
      }

      this.contract = {
        team: getTeam(playerPosition),
        player: playerPosition,
        points: bid.points,
        suit: bid.suit,
        coinched: false,
        surcoinched: false
      };
      this.lastBidder = playerPosition;
      this.passCount = 0;
      this.bids.push({ player: playerPosition, type: 'bid', points: bid.points, suit: bid.suit });
      this.currentPlayer = getNextPlayer(playerPosition);
      return { success: true, action: 'bid' };
    }

    return { success: false, error: 'Action invalide' };
  }

  startPlaying() {
    if (!this.contract) {
      this.dealer = getNextPlayer(this.dealer);
      return { success: true, action: 'redistribute' };
    }

    if (this.coincheBy) this.contract.coinched = true;
    if (this.surcoincheBy) this.contract.surcoinched = true;

    this.state = 'playing';
    this.currentPlayer = getNextPlayer(this.dealer);
    this.trickNumber = 1;

    // Vérifier belote (peut être multiple en tout-atout)
    for (const pos of POSITIONS) {
      const beloteSuits = hasBeloteRebelote(this.hands[pos], this.contract.suit);
      if (beloteSuits.length > 0) {
        this.belotePlayers[pos] = beloteSuits;
      }
    }

    return { success: true, action: 'play' };
  }

  playCard(playerPosition, card) {
    if (this.state !== 'playing') return { success: false, error: 'Pas en phase de jeu' };
    if (playerPosition !== this.currentPlayer) return { success: false, error: 'Ce n\'est pas votre tour' };

    const hand = this.hands[playerPosition];
    const cardIndex = hand.findIndex(c => cardEquals(c, card));
    if (cardIndex === -1) return { success: false, error: 'Vous n\'avez pas cette carte' };

    // Vérifier que la carte est jouable
    const playable = getPlayableCardsWithPlayer(hand, this.currentTrick, this.contract.suit, playerPosition);
    if (!playable.some(c => cardEquals(c, card))) {
      return { success: false, error: 'Vous ne pouvez pas jouer cette carte' };
    }

    // Retirer la carte de la main
    hand.splice(cardIndex, 1);
    this.currentTrick.push({ player: playerPosition, card });

    // Vérifier belote/rebelote (supporte plusieurs belotes en tout-atout)
    let beloteAnnounce = null;
    if (this.belotePlayers[playerPosition] && (card.rank === 'roi' || card.rank === 'dame')) {
      const relevantSuits = this.belotePlayers[playerPosition];
      if (relevantSuits.includes(card.suit)) {
        const team = getTeam(playerPosition);
        if (!this.beloteAnnounced[team][card.suit]) {
          beloteAnnounce = 'belote';
          this.beloteAnnounced[team][card.suit] = 'belote';
        } else if (this.beloteAnnounced[team][card.suit] === 'belote') {
          beloteAnnounce = 'rebelote';
          this.beloteAnnounced[team][card.suit] = 'rebelote';
        }
      }
    }

    // Pli complet?
    if (this.currentTrick.length === 4) {
      const winner = determineTrickWinner(this.currentTrick, this.contract.suit);
      const points = calculateTrickPoints(this.currentTrick, this.contract.suit);
      const winnerTeam = getTeam(winner);

      this.tricksTaken[winnerTeam].push(this.currentTrick);
      this.roundPoints[winnerTeam] += points;

      // Dernier pli: +10 points
      if (this.trickNumber === 8) {
        this.roundPoints[winnerTeam] += 10;
      }

      this.lastTrick = [...this.currentTrick];
      this.currentTrick = [];
      this.trickNumber++;

      if (this.trickNumber > 8) {
        return this.endRound(beloteAnnounce);
      }

      this.currentPlayer = winner;
      return {
        success: true,
        action: 'trick_complete',
        winner,
        winnerTeam,
        points,
        beloteAnnounce,
        lastTrick: this.lastTrick
      };
    }

    this.currentPlayer = getNextPlayer(playerPosition);
    return { success: true, action: 'next', beloteAnnounce };
  }

  endRound(lastBeloteAnnounce) {
    // Ajouter les points de belote (20 points par belote complète)
    for (const team of ['ns', 'eo']) {
      for (const suit of SUITS) {
        if (this.beloteAnnounced[team][suit] === 'rebelote') {
          this.roundPoints[team] += 20;
        }
      }
    }

    const contractTeam = this.contract.team;
    const defenseTeam = contractTeam === 'ns' ? 'eo' : 'ns';
    const contractPoints = this.roundPoints[contractTeam];
    const defensePoints = this.roundPoints[defenseTeam];
    const belotePoints = {
      ns: Object.values(this.beloteAnnounced.ns).filter(v => v === 'rebelote').length * 20,
      eo: Object.values(this.beloteAnnounced.eo).filter(v => v === 'rebelote').length * 20
    };

    let contractMet = contractPoints >= this.contract.points;

    // Capot: si contrat de 250 (capot), il faut tous les plis
    if (this.contract.points === 250) {
      contractMet = this.tricksTaken[defenseTeam].length === 0;
    }

    // Générale: 500 points
    if (this.contract.points === 500) {
      const attackTricks = this.tricksTaken[contractTeam];
      const bidderTookAll = attackTricks.length === 8 &&
        attackTricks.every(trick => determineTrickWinner(trick, this.contract.suit) === this.contract.player);
      contractMet = bidderTookAll;
    }

    let scoreNS = 0;
    let scoreEO = 0;
    let multiplier = 1;
    if (this.contract.coinched) multiplier = 2;
    if (this.contract.surcoinched) multiplier = 3;
    const contractBonus = this.contract.points * multiplier;

    if (contractMet) {
      // Le contrat est réussi
      if (contractTeam === 'ns') {
        if (this.contract.points === 250 || this.contract.points === 500) {
          scoreNS = contractBonus + belotePoints.ns;
        } else {
          scoreNS = contractPoints + contractBonus;
        }
        scoreEO = defensePoints;
      } else {
        if (this.contract.points === 250 || this.contract.points === 500) {
          scoreEO = contractBonus + belotePoints.eo;
        } else {
          scoreEO = contractPoints + contractBonus;
        }
        scoreNS = defensePoints;
      }
    } else {
      // Le contrat est chuté: l'attaque ne marque rien
      const totalPoints = 162;
      const defenseBelotePoints = belotePoints[defenseTeam];
      if (contractTeam === 'ns') {
        scoreEO = totalPoints + defenseBelotePoints + contractBonus;
        scoreNS = 0;
      } else {
        scoreNS = totalPoints + defenseBelotePoints + contractBonus;
        scoreEO = 0;
      }
    }

    scoreNS = roundScore(scoreNS);
    scoreEO = roundScore(scoreEO);

    this.scores.ns += scoreNS;
    this.scores.eo += scoreEO;

    const roundResult = {
      contractTeam,
      defenseTeam,
      contractPoints,
      defensePoints,
      contractMet,
      contract: { ...this.contract },
      scoreNS,
      scoreEO,
      totalScores: { ...this.scores },
      belote: { ...this.beloteAnnounced },
      multiplier
    };

    this.roundNumber++;

    this.roundHistory.unshift({
      roundNumber: this.roundNumber,
      contractTeam,
      defenseTeam,
      contractMet,
      contract: { ...this.contract },
      contractPoints,
      defensePoints,
      scoreNS,
      scoreEO,
      totalScores: { ...this.scores }
    });

    if (this.roundHistory.length > 12) {
      this.roundHistory = this.roundHistory.slice(0, 12);
    }

    // Vérifier fin de partie
    if (this.scores.ns >= this.targetScore || this.scores.eo >= this.targetScore) {
      this.state = 'finished';
      return {
        success: true,
        action: 'game_over',
        roundResult,
        winner: this.scores.ns >= this.targetScore ? 'ns' : 'eo',
        beloteAnnounce: lastBeloteAnnounce
      };
    }

    // Nouveau donneur
    this.dealer = getNextPlayer(this.dealer);
    this.state = 'scoring';

    return {
      success: true,
      action: 'round_end',
      roundResult,
      beloteAnnounce: lastBeloteAnnounce
    };
  }

  getStateForPlayer(position) {
    const state = {
      roomId: this.roomId,
      state: this.state,
      targetScore: this.targetScore,
      players: {},
      scores: this.scores,
      dealer: this.dealer,
      currentPlayer: this.currentPlayer,
      contract: this.contract,
      trickNumber: this.trickNumber,
      myPosition: position,
      myTeam: getTeam(position),
      currentTrick: this.currentTrick,
      lastTrick: this.lastTrick,
      roundHistory: this.roundHistory,
      bids: this.bids,
      roundPoints: this.roundPoints,
      cardsLeft: {},
      beloteAnnounced: this.beloteAnnounced
    };

    // Infos joueurs
    for (const pos of POSITIONS) {
      if (this.players[pos]) {
        state.players[pos] = {
          name: this.players[pos].name,
          connected: true
        };
      }
    }

    // Main du joueur (triée)
    if (this.hands[position]) {
      const trumpSuit = this.contract ? this.contract.suit : null;
      state.hand = sortHand(this.hands[position], trumpSuit);
      state.playableCards = this.state === 'playing' && this.currentPlayer === position
        ? getPlayableCardsWithPlayer(this.hands[position], this.currentTrick, this.contract.suit, position)
        : [];
    } else {
      state.hand = [];
      state.playableCards = [];
    }

    // Nombre de cartes de chaque joueur
    for (const pos of POSITIONS) {
      state.cardsLeft[pos] = this.hands[pos] ? this.hands[pos].length : 0;
    }

    return state;
  }
}

module.exports = {
  CoincheGame,
  POSITIONS,
  SUITS,
  RANKS,
  getTeam,
  getPartner,
  getNextPlayer
};
