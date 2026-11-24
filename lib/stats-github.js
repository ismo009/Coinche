// ============================================================
// Sauvegarde des statistiques sur une branche GitHub dédiée.
//
// Pourquoi : sur Heroku, le disque est effacé à chaque déploiement et au
// redémarrage quotidien du dyno. Les statistiques sont donc envoyées
// régulièrement sur une branche du dépôt (par défaut `stats-data`, qui ne
// contient que `stats.json`) et rechargées au démarrage.
//
// Activation (variables d'environnement, ex. "Config Vars" Heroku) :
//   STATS_GITHUB_TOKEN   jeton GitHub (fine-grained, "Contents: Read and write" sur ce dépôt)
//   STATS_GITHUB_REPO    "proprietaire/depot", ex. ismo009/Coinche
// Optionnel :
//   STATS_GITHUB_BRANCH        branche de sauvegarde (défaut : stats-data)
//   STATS_GITHUB_PATH          fichier dans la branche (défaut : stats.json)
//   STATS_GITHUB_SYNC_MINUTES  intervalle d'envoi si changement (défaut : 5)
//   STATS_GITHUB_API           URL de l'API (défaut : https://api.github.com, utile pour les tests)
//
// Fusion sans perte : chaque envoi relit la version distante et y ajoute les
// progrès réalisés localement depuis la dernière synchronisation
// (distant + (local - base)). Deux serveurs qui tournent en même temps (ex. pendant
// un déploiement Heroku) ne s'écrasent donc pas : leurs progrès s'additionnent.
// ============================================================
const { COUNTER_FIELDS, sanitizeEntry, normalizeName } = require('./stats-store');

const DEFAULTS = {
  branch: 'stats-data',
  path: 'stats.json',
  syncMinutes: 5,
  apiUrl: 'https://api.github.com',
  requestTimeoutMs: 15000,
  shutdownTimeoutMs: 20000 // Heroku laisse 30 s après SIGTERM
};

function readConfigFromEnv(env = process.env) {
  const token = (env.STATS_GITHUB_TOKEN || '').trim();
  const repo = (env.STATS_GITHUB_REPO || '').trim();
  if (!token || !repo) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`STATS_GITHUB_REPO invalide ("${repo}") : format attendu "proprietaire/depot"`);
  }
  const minutes = Number(env.STATS_GITHUB_SYNC_MINUTES);
  return {
    token,
    repo,
    branch: (env.STATS_GITHUB_BRANCH || DEFAULTS.branch).trim(),
    path: (env.STATS_GITHUB_PATH || DEFAULTS.path).trim().replace(/^\/+/, ''),
    syncMs: Math.max(1, Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULTS.syncMinutes) * 60 * 1000,
    apiUrl: (env.STATS_GITHUB_API || DEFAULTS.apiUrl).replace(/\/+$/, '')
  };
}

// Entrées valides d'un contenu stats.json : { clé normalisée: entrée }.
function parseEntries(text) {
  const out = {};
  if (!text) return out;
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.players || typeof data.players !== 'object') {
    throw new Error('structure inattendue');
  }
  for (const raw of Object.values(data.players)) {
    const entry = sanitizeEntry(raw);
    if (!entry) continue;
    const key = normalizeName(entry.name);
    if (key && !out[key]) out[key] = entry;
  }
  return out;
}

function activity(entry) {
  return entry ? COUNTER_FIELDS.reduce((s, f) => s + (entry[f] || 0), 0) : 0;
}

function laterIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a >= b ? a : b;
}

// distant + (local - base), champ par champ ; jamais négatif.
function mergeWithDeltas(remote, local, base) {
  const keys = new Set([...Object.keys(remote), ...Object.keys(local)]);
  const out = {};
  for (const key of keys) {
    const r = remote[key];
    const l = local[key];
    const b = base[key];
    if (!l) {
      // Absent localement : soit jamais vu ici, soit oublié (limite de taille) -> on garde le distant.
      out[key] = { ...r };
      continue;
    }
    const merged = { ...(r || l) };
    for (const f of COUNTER_FIELDS) {
      const delta = Math.max(0, (l[f] || 0) - (b ? b[f] || 0 : 0));
      merged[f] = (r ? r[f] || 0 : 0) + delta;
    }
    const lNewer = (l.lastPlayedAt || '') >= ((r && r.lastPlayedAt) || '');
    merged.name = lNewer || !r ? l.name : r.name;
    merged.lastPlayedAt = laterIso(l.lastPlayedAt, r && r.lastPlayedAt);
    out[key] = merged;
  }
  return out;
}

// Restauration : par joueur, la version la plus avancée entre le distant et le
// fichier local lu au démarrage, plus les parties jouées depuis le démarrage
// (actuel - fichier de démarrage).
function mergeForRestore(remote, bootLocal, current) {
  const out = {};
  const keys = new Set([...Object.keys(remote), ...Object.keys(bootLocal), ...Object.keys(current)]);
  for (const key of keys) {
    const r = remote[key];
    const f = bootLocal[key];
    const c = current[key];
    const start = (f && (!r || activity(f) > activity(r))) ? f : r;
    if (!c && !start) continue;
    const merged = { ...(start || c) };
    for (const field of COUNTER_FIELDS) {
      const sinceBoot = c ? Math.max(0, (c[field] || 0) - (f ? f[field] || 0 : 0)) : 0;
      merged[field] = (start ? start[field] || 0 : 0) + sinceBoot;
    }
    if (c && (c.lastPlayedAt || '') >= (merged.lastPlayedAt || '')) {
      merged.name = c.name;
      merged.lastPlayedAt = c.lastPlayedAt;
    }
    out[key] = merged;
  }
  return out;
}

function sameEntries(a, b) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => b[k] && COUNTER_FIELDS.every(f => (a[k][f] || 0) === (b[k][f] || 0)));
}

class GitHubStatsBackup {
  constructor(store, config, { log = console, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch indisponible (Node 18+ requis)');
    this.store = store;
    this.config = config;
    this.log = log;
    this.fetch = fetchImpl;
    this.bootSnapshot = store.snapshot(); // contenu du fichier local au démarrage
    this.base = {}; // état distant connu à la dernière synchronisation
    this.syncedVersion = 0; // version du store à la dernière synchronisation
    this.timer = null;
    this.running = null;
    this.status = { enabled: true, restoredAt: null, lastSyncAt: null, lastError: null, syncs: 0 };
  }

  describe() {
    return `${this.config.repo}@${this.config.branch}:${this.config.path}`;
  }

  async request(method, apiPath, body, { accept = 'application/vnd.github+json', okStatuses = [] } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULTS.requestTimeoutMs);
    try {
      const res = await this.fetch(`${this.config.apiUrl}${apiPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'caricoinche-stats-backup',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      if (!res.ok && !okStatuses.includes(res.status)) {
        let detail = '';
        try { detail = (await res.json()).message || ''; } catch { /* rien */ }
        const err = new Error(`GitHub ${method} ${apiPath.split('?')[0]} : HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
        err.status = res.status;
        throw err;
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  repoPath(suffix) {
    return `/repos/${this.config.repo}${suffix}`;
  }

  // SHA du dernier commit de la branche, ou null si elle n'existe pas encore.
  async getBranchHead() {
    const res = await this.request('GET', this.repoPath(`/git/ref/heads/${encodeURIComponent(this.config.branch)}`), null, { okStatuses: [404] });
    if (res.status === 404) return null;
    const data = await res.json();
    return data && data.object ? data.object.sha : null;
  }

  // Contenu distant de stats.json (texte) ou null s'il n'existe pas.
  async downloadText() {
    const p = this.config.path.split('/').map(encodeURIComponent).join('/');
    const res = await this.request('GET', this.repoPath(`/contents/${p}?ref=${encodeURIComponent(this.config.branch)}`), null, {
      accept: 'application/vnd.github.raw',
      okStatuses: [404]
    });
    if (res.status === 404) return null;
    return res.text();
  }

  async downloadEntries() {
    const text = await this.downloadText();
    try {
      return parseEntries(text);
    } catch (err) {
      throw new Error(`sauvegarde distante illisible (${err.message})`);
    }
  }

  // Commit d'un nouveau stats.json sur la branche (création de la branche si besoin).
  // Retourne false si la branche a bougé entre-temps (à réessayer).
  async commitText(text, parentSha) {
    const blob = await (await this.request('POST', this.repoPath('/git/blobs'), {
      content: Buffer.from(text, 'utf8').toString('base64'),
      encoding: 'base64'
    })).json();
    const tree = await (await this.request('POST', this.repoPath('/git/trees'), {
      tree: [{ path: this.config.path, mode: '100644', type: 'blob', sha: blob.sha }]
    })).json();
    const commit = await (await this.request('POST', this.repoPath('/git/commits'), {
      message: `Sauvegarde automatique des statistiques (${new Date().toISOString()})`,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : []
    })).json();
    if (parentSha) {
      const res = await this.request('PATCH', this.repoPath(`/git/refs/heads/${encodeURIComponent(this.config.branch)}`), {
        sha: commit.sha,
        force: false
      }, { okStatuses: [409, 422] });
      return res.ok;
    }
    const res = await this.request('POST', this.repoPath('/git/refs'), {
      ref: `refs/heads/${this.config.branch}`,
      sha: commit.sha
    }, { okStatuses: [409, 422] });
    return res.ok;
  }

  // Au démarrage : recharge la sauvegarde distante dans le store.
  async restore() {
    try {
      const remote = await this.downloadEntries();
      const merged = mergeForRestore(remote, this.bootSnapshot, this.store.snapshot());
      this.store.replaceAll(merged, { markDirty: false });
      // La base est ce qui est déjà en ligne : tout écart sera envoyé au prochain envoi.
      this.base = remote;
      this.syncedVersion = this.store.version;
      if (!sameEntries(merged, remote)) this.store.markDirty();
      this.status.restoredAt = new Date().toISOString();
      this.status.lastError = null;
      this.log.log(`[stats] ${Object.keys(remote).length} joueur(s) rechargé(s) depuis ${this.describe()}`);
      return true;
    } catch (err) {
      this.status.lastError = err.message;
      this.log.error(`[stats] restauration depuis ${this.describe()} impossible : ${err.message}`);
      return false;
    }
  }

  needsSync() {
    return this.store.version > this.syncedVersion;
  }

  // Envoie les progrès locaux (fusion distant + delta). Sérialisé.
  async sync({ force = false } = {}) {
    if (this.running) return this.running;
    // Sans restauration réussie, la base est inconnue : envoyer compterait des parties en double.
    if (!this.status.restoredAt && !(await this.restore())) return false;
    if (!force && !this.needsSync()) return true;
    this.running = (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const version = this.store.version;
          const parent = await this.getBranchHead();
          const remote = parent ? await this.downloadEntries() : {};
          const local = this.store.snapshot();
          const merged = mergeWithDeltas(remote, local, this.base);
          const text = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), players: merged });
          const ok = await this.commitText(text, parent);
          if (!ok) continue; // la branche a bougé : on relit et on refusionne
          if (this.store.version === version) {
            // Rien de nouveau pendant l'envoi : le store adopte l'état fusionné.
            this.store.replaceAll(merged, { markDirty: false });
            this.syncedVersion = this.store.version;
            this.base = merged;
          } else {
            // Des parties ont été enregistrées pendant l'envoi : on garde le store tel
            // quel et la base devient l'état local envoyé, pour que le prochain envoi
            // ne transmette que ces nouvelles parties.
            this.base = local;
            this.syncedVersion = version;
          }
          this.status.lastSyncAt = new Date().toISOString();
          this.status.lastError = null;
          this.status.syncs++;
          return true;
        } catch (err) {
          this.status.lastError = err.message;
          this.log.error(`[stats] sauvegarde vers ${this.describe()} impossible (essai ${attempt}/3) : ${err.message}`);
          if (err.status === 401 || err.status === 403 || err.status === 404) break; // inutile de réessayer
        }
      }
      return false;
    })();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.sync().catch(() => {}); }, this.config.syncMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // À l'arrêt (SIGTERM Heroku, Ctrl+C) : dernier envoi, puis sortie.
  installExitHandlers() {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        this.stop();
        const code = signal === 'SIGINT' ? 130 : 143;
        if (!this.needsSync()) {
          process.exit(code);
          return;
        }
        this.log.log(`[stats] ${signal} : envoi des statistiques vers ${this.describe()}...`);
        const fallback = setTimeout(() => process.exit(code), DEFAULTS.shutdownTimeoutMs);
        this.sync().finally(() => {
          clearTimeout(fallback);
          process.exit(code);
        });
      });
    }
  }
}

/**
 * Active la sauvegarde GitHub si les variables d'environnement sont présentes.
 * Retourne l'instance (ou null si désactivée). Ne lève jamais.
 */
function setupGitHubStatsBackup(store, { env = process.env, log = console, fetchImpl } = {}) {
  let config;
  try {
    config = readConfigFromEnv(env);
  } catch (err) {
    log.error(`[stats] ${err.message} : sauvegarde GitHub désactivée.`);
    return null;
  }
  if (!config) return null;
  const backup = new GitHubStatsBackup(store, config, { log, fetchImpl: fetchImpl || globalThis.fetch });
  backup.installExitHandlers();
  backup.ready = backup.restore().then(() => backup.start());
  return backup;
}

module.exports = {
  GitHubStatsBackup,
  setupGitHubStatsBackup,
  readConfigFromEnv,
  mergeWithDeltas,
  mergeForRestore,
  parseEntries
};
