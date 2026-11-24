// Statistiques des joueurs, persistées dans un fichier JSON côté serveur.
//
// - Clé = pseudo normalisé (trim, espaces compressés, minuscules, NFC) ; on garde
//   le dernier pseudo d'affichage.
// - Écritures atomiques (fichier temporaire puis rename), regroupées (debounce)
//   et sérialisées ; flush synchrone à l'arrêt du process.
// - Fichier corrompu au démarrage : renommé en .corrupt-<date>, on repart à vide.
const fs = require('fs');
const path = require('path');
const { POSITIONS, getTeam } = require('../game');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'stats.json');
const FILE_VERSION = 1;
const DEFAULT_MAX_PLAYERS = 10000;
const DEFAULT_DEBOUNCE_MS = 1000;
const MAX_NAME_LENGTH = 40;
const DEFAULT_PLAYER_NAME_KEY = 'joueur';
const COUNTER_FIELDS = ['gamesPlayed', 'gamesWon', 'gamesLost', 'contractsMade', 'contractsFailed'];
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

function cleanDisplayName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFC').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

// Clé de stockage d'un pseudo ('' si inutilisable).
function normalizeName(raw) {
  return cleanDisplayName(raw).toLowerCase().normalize('NFC');
}

// Pseudo pris en compte : non vide et différent du pseudo par défaut « Joueur ».
function isTrackableName(raw) {
  const key = normalizeName(raw);
  return key !== '' && key !== DEFAULT_PLAYER_NAME_KEY;
}

function isTrackedHuman(player) {
  return !!player && player.isBot !== true && isTrackableName(player.name);
}

function toCounter(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toIsoOrNull(value) {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function rate(part, total) {
  return total > 0 ? Math.round((part / total) * 10000) / 10000 : null;
}

function emptyEntry(name) {
  return {
    name,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    contractsMade: 0,
    contractsFailed: 0,
    lastPlayedAt: null
  };
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanDisplayName(raw.name);
  if (!name) return null;
  const entry = emptyEntry(name);
  for (const field of COUNTER_FIELDS) entry[field] = toCounter(raw[field]);
  entry.lastPlayedAt = toIsoOrNull(raw.lastPlayedAt);
  return entry;
}

function toPublic(entry) {
  const contractsTotal = entry.contractsMade + entry.contractsFailed;
  return {
    name: entry.name,
    gamesPlayed: entry.gamesPlayed,
    gamesWon: entry.gamesWon,
    gamesLost: entry.gamesLost,
    winRate: rate(entry.gamesWon, entry.gamesPlayed),
    contractsMade: entry.contractsMade,
    contractsFailed: entry.contractsFailed,
    contractRate: rate(entry.contractsMade, contractsTotal),
    lastPlayedAt: entry.lastPlayedAt
  };
}

const byName = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
const rateValue = (r) => (r === null ? -1 : r);
const SORTERS = {
  // Classement par défaut : victoires, puis taux de victoire, puis parties jouées.
  wins: (a, b) => b.gamesWon - a.gamesWon
    || rateValue(b.winRate) - rateValue(a.winRate)
    || b.gamesPlayed - a.gamesPlayed
    || b.contractsMade - a.contractsMade
    || byName(a, b),
  winRate: (a, b) => rateValue(b.winRate) - rateValue(a.winRate) || b.gamesWon - a.gamesWon || byName(a, b),
  games: (a, b) => b.gamesPlayed - a.gamesPlayed || b.gamesWon - a.gamesWon || byName(a, b),
  contracts: (a, b) => b.contractsMade - a.contractsMade
    || rateValue(b.contractRate) - rateValue(a.contractRate) || byName(a, b),
  recent: (a, b) => (b.lastPlayedAt || '').localeCompare(a.lastPlayedAt || '') || byName(a, b),
  name: byName
};

class StatsStore {
  constructor(options = {}) {
    this.file = path.resolve(options.file || process.env.STATS_FILE || DEFAULT_FILE);
    this.maxPlayers = options.maxPlayers > 0 ? options.maxPlayers : DEFAULT_MAX_PLAYERS;
    this.debounceMs = options.debounceMs >= 0 ? options.debounceMs : DEFAULT_DEBOUNCE_MS;
    this.log = options.log || console;
    this.players = new Map();
    this.updatedAt = null;
    this.version = 0; // incrémenté à chaque modification
    this.persistedVersion = 0; // dernière version écrite sur disque
    this.timer = null;
    this.writing = null; // promesse de l'écriture en cours
    this.tmpCounter = 0;
    this.exitHandlersInstalled = false;
  }

  // Lecture du fichier au démarrage. Ne lève jamais.
  load() {
    this.players = new Map();
    this.updatedAt = null;
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.error(`[stats] lecture impossible de ${this.file} :`, err.message);
      return this;
    }

    let data;
    try {
      data = JSON.parse(text);
      if (!data || typeof data !== 'object' || !data.players || typeof data.players !== 'object' || Array.isArray(data.players)) {
        throw new Error('structure inattendue');
      }
    } catch (err) {
      this.quarantineCorruptFile(err);
      return this;
    }

    for (const raw of Object.values(data.players)) {
      const entry = sanitizeEntry(raw);
      if (!entry) continue;
      const key = normalizeName(entry.name);
      if (!isTrackableName(entry.name) || this.players.has(key)) continue;
      this.players.set(key, entry);
    }
    this.updatedAt = toIsoOrNull(data.updatedAt);
    this.evictIfNeeded();
    return this;
  }

  quarantineCorruptFile(err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${this.file}.corrupt-${stamp}`;
    try {
      fs.renameSync(this.file, target);
      this.log.error(`[stats] fichier corrompu (${err.message}) : renommé en ${target}, statistiques remises à zéro.`);
    } catch (renameErr) {
      this.log.error(`[stats] fichier corrompu (${err.message}) et impossible à renommer :`, renameErr.message);
    }
  }

  get(name) {
    const entry = this.players.get(normalizeName(name));
    return entry ? toPublic(entry) : null;
  }

  get size() {
    return this.players.size;
  }

  // Liste publique, triée ; `q` filtre par pseudo (insensible à la casse).
  list({ sort = 'wins', limit = 500, q = '' } = {}) {
    const sorter = SORTERS[sort] || SORTERS.wins;
    const ranked = Array.from(this.players.values(), toPublic).sort(sorter);
    const query = normalizeName(q);
    const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : ranked.length;
    const out = [];
    for (let i = 0; i < ranked.length && out.length < max; i++) {
      const player = ranked[i];
      if (query && !normalizeName(player.name).includes(query)) continue;
      out.push({ rank: i + 1, ...player });
    }
    return out;
  }

  // Entrée modifiable d'un joueur (créée au besoin) ; null si pseudo ignoré.
  touch(name, now = new Date()) {
    if (!isTrackableName(name)) return null;
    const key = normalizeName(name);
    let entry = this.players.get(key);
    if (!entry) {
      entry = emptyEntry(cleanDisplayName(name));
      this.players.set(key, entry);
      this.evictIfNeeded(key);
    }
    entry.name = cleanDisplayName(name);
    entry.lastPlayedAt = now.toISOString();
    return entry;
  }

  recordContract(name, made, now = new Date()) {
    const entry = this.touch(name, now);
    if (!entry) return false;
    if (made) entry.contractsMade++;
    else entry.contractsFailed++;
    this.markDirty(now);
    return true;
  }

  recordGame(name, won, now = new Date()) {
    const entry = this.touch(name, now);
    if (!entry) return false;
    entry.gamesPlayed++;
    if (won) entry.gamesWon++;
    else entry.gamesLost++;
    this.markDirty(now);
    return true;
  }

  // Au-delà de la limite, on oublie les joueurs les moins récents.
  evictIfNeeded(keepKey = null) {
    while (this.players.size > this.maxPlayers) {
      let oldestKey = null;
      let oldest = null;
      for (const [key, entry] of this.players) {
        if (key === keepKey) continue;
        const t = entry.lastPlayedAt || '';
        if (oldest === null || t < oldest) {
          oldest = t;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      this.players.delete(oldestKey);
    }
  }

  markDirty(now = new Date()) {
    this.version++;
    this.updatedAt = now.toISOString();
    this.scheduleSave();
  }

  isDirty() {
    return this.persistedVersion < this.version;
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveAsync().catch(() => {});
    }, this.debounceMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  serialize() {
    const players = {};
    for (const [key, entry] of this.players) players[key] = entry;
    return JSON.stringify({ version: FILE_VERSION, updatedAt: this.updatedAt, players });
  }

  tmpPath() {
    this.tmpCounter++;
    return `${this.file}.${process.pid}.${this.tmpCounter}.tmp`;
  }

  // Écriture asynchrone, sérialisée : une seule à la fois, la suivante reprend
  // la dernière version des données.
  async saveAsync() {
    while (this.writing) await this.writing;
    if (!this.isDirty()) return;
    const version = this.version;
    const text = this.serialize();
    const tmp = this.tmpPath();
    this.writing = (async () => {
      try {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        await fs.promises.writeFile(tmp, text, 'utf8');
        if (this.persistedVersion >= version) {
          // Un flush synchrone a déjà écrit des données plus récentes.
          await fs.promises.unlink(tmp).catch(() => {});
          return;
        }
        await fs.promises.rename(tmp, this.file);
        this.persistedVersion = Math.max(this.persistedVersion, version);
      } catch (err) {
        this.log.error('[stats] écriture impossible :', err.message);
        await fs.promises.unlink(tmp).catch(() => {});
        if (this.isDirty()) this.scheduleSave(); // nouvel essai plus tard
      }
    })();
    try {
      await this.writing;
    } finally {
      this.writing = null;
    }
  }

  // Écriture synchrone immédiate (arrêt du process, tests).
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.isDirty()) return true;
    const version = this.version;
    const tmp = this.tmpPath();
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, this.serialize(), 'utf8');
      fs.renameSync(tmp, this.file);
      this.persistedVersion = Math.max(this.persistedVersion, version);
      return true;
    } catch (err) {
      this.log.error('[stats] flush impossible :', err.message);
      try { fs.unlinkSync(tmp); } catch { /* rien */ }
      return false;
    }
  }

  // Flush à l'arrêt, sans empêcher l'arrêt : après le flush, le signal est
  // relancé avec son comportement par défaut (si personne d'autre ne l'écoute).
  installExitHandlers() {
    if (this.exitHandlersInstalled) return;
    this.exitHandlersInstalled = true;
    const flushQuietly = () => {
      try { this.flush(); } catch { /* rien */ }
    };
    process.on('beforeExit', flushQuietly);
    process.on('exit', flushQuietly);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        flushQuietly();
        process.removeListener(signal, handler);
        if (process.listenerCount(signal) > 0) return; // un autre gestionnaire décide
        try {
          process.kill(process.pid, signal);
        } catch {
          process.exit(signal === 'SIGINT' ? 130 : 143);
        }
      };
      process.on(signal, handler);
    }
  }
}

// Applique les règles de comptage à un résultat de fin de manche / de partie.
// - fin de manche : le preneur humain compte un contrat réussi ou raté ;
// - fin de partie : chaque humain assis compte une partie jouée, gagnée ou perdue.
// Retourne le nombre de mises à jour effectuées.
function recordRoundOutcome(store, game, result, now = new Date()) {
  if (!store || !game || !result) return 0;
  if (result.action !== 'round_end' && result.action !== 'game_over') return 0;
  const players = game.players || {};
  let updates = 0;

  const rr = result.roundResult;
  const takerPos = rr && rr.contract ? rr.contract.player : null;
  if (takerPos && POSITIONS.includes(takerPos) && isTrackedHuman(players[takerPos])) {
    if (store.recordContract(players[takerPos].name, rr.contractMet === true, now)) updates++;
  }

  if (result.action === 'game_over' && (result.winner === 'ns' || result.winner === 'eo')) {
    // Un même pseudo compté une seule fois par partie ; ignoré s'il est assis dans les deux équipes.
    const teamsByKey = new Map();
    for (const pos of POSITIONS) {
      const player = players[pos];
      if (!isTrackedHuman(player)) continue;
      const key = normalizeName(player.name);
      const seen = teamsByKey.get(key) || { name: player.name, teams: new Set() };
      seen.teams.add(getTeam(pos));
      teamsByKey.set(key, seen);
    }
    for (const { name, teams } of teamsByKey.values()) {
      if (teams.size !== 1) continue;
      const [team] = teams;
      if (store.recordGame(name, team === result.winner, now)) updates++;
    }
  }
  return updates;
}

function createStatsStore(options) {
  return new StatsStore(options);
}

module.exports = {
  StatsStore,
  createStatsStore,
  recordRoundOutcome,
  normalizeName,
  isTrackableName,
  DEFAULT_FILE
};
