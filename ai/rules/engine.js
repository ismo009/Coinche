// ============================================================
// Moteur de règles : chargement, validation, rapport et exécution.
// Les fichiers sont relus automatiquement quand ils changent sur le disque
// (ex. après un `git pull`), sans redémarrer le serveur.
// ============================================================
const fs = require('fs');
const path = require('path');
const { T, compile, evaluate, num, truthy } = require('./expression');
const schemas = require('./schema');

const RULE_DIR = __dirname;
const FILES = {
  annonce: path.join(RULE_DIR, 'rule_annonce.json'),
  jeux: path.join(RULE_DIR, 'rule_jeux.json')
};

const ANNONCE_ACTIONS = ['bid', 'pass', 'coinche', 'surcoinche'];
const JEU_ACTIONS = ['play', 'score', 'restrict', 'exclude'];
const PICKS = ['lowest', 'highest', 'max', 'min', 'first'];
const RULE_KEYS = new Set(['id', 'name', 'description', 'enabled', 'priority', 'when', 'action', 'source', 'tags', 'note']);

function typeOfValue(v) {
  if (typeof v === 'number') return T.number;
  if (typeof v === 'boolean') return T.bool;
  if (typeof v === 'string') return T.string;
  if (Array.isArray(v)) return T.list(T.any);
  return T.any;
}

function buildSchema(kind, params, varTypes, withCard) {
  const base = kind === 'annonce' ? schemas.ANNONCE_IDENTIFIERS : schemas.JEU_IDENTIFIERS;
  const identifiers = { ...base };
  const paramFields = {};
  for (const [k, v] of Object.entries(params)) paramFields[k] = typeOfValue(v);
  identifiers.params = T.object(paramFields);
  for (const [k, t] of Object.entries(varTypes)) identifiers[k] = t;
  if (withCard) identifiers.card = schemas.PLAY_CARD;
  return {
    identifiers,
    functions: kind === 'annonce' ? schemas.ANNONCE_FUNCTIONS : schemas.JEU_FUNCTIONS
  };
}

function compileExpr(src, schema, expected, label, errors) {
  try {
    return compile(src, schema, expected);
  } catch (err) {
    errors.push(`${label} : ${err.message}`);
    return null;
  }
}

/**
 * Charge et valide un fichier de règles.
 * Retourne { kind, file, ok, fileErrors, params, vars, rules, settings }
 * Chaque règle : { id, name, priority, enabled, valid, errors, when, action, index }
 */
function loadRuleFile(kind, file = FILES[kind]) {
  const result = {
    kind,
    file,
    ok: false,
    fileErrors: [],
    params: {},
    vars: [],
    rules: [],
    settings: {},
    mtimeMs: 0
  };

  let raw;
  try {
    result.mtimeMs = fs.statSync(file).mtimeMs;
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    result.fileErrors.push(`lecture impossible : ${err.message}`);
    return result;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    result.fileErrors.push('le fichier doit contenir un objet JSON');
    return result;
  }

  // Paramètres réglables
  if (raw.params !== undefined) {
    if (!raw.params || typeof raw.params !== 'object' || Array.isArray(raw.params)) {
      result.fileErrors.push('"params" doit être un objet');
    } else {
      for (const [k, v] of Object.entries(raw.params)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) result.fileErrors.push(`params.${k} : nom invalide`);
        else if (!['number', 'boolean', 'string'].includes(typeof v)) result.fileErrors.push(`params.${k} : valeur nombre / booléen / texte attendue`);
        else result.params[k] = v;
      }
    }
  }

  if (kind === 'jeux') {
    const sim = raw.simulation && typeof raw.simulation === 'object' ? raw.simulation : {};
    result.settings.samples = Math.max(4, Math.min(400, Math.round(num(sim.samples) || 48)));
    const fin = raw.final && typeof raw.final === 'object' ? raw.final : {};
    result.settings.tieBreak = ['lowest', 'highest', 'evNet'].includes(fin.tieBreak) ? fin.tieBreak : 'lowest';
  }

  // Variables calculées (dans l'ordre)
  const varTypes = {};
  const reserved = new Set(Object.keys(kind === 'annonce' ? schemas.ANNONCE_IDENTIFIERS : schemas.JEU_IDENTIFIERS).concat(['params', 'card']));
  if (raw.vars !== undefined && !Array.isArray(raw.vars)) {
    result.fileErrors.push('"vars" doit être une liste');
  }
  for (const [i, v] of (Array.isArray(raw.vars) ? raw.vars : []).entries()) {
    const label = `variable n°${i + 1}${v && v.name ? ` (${v.name})` : ''}`;
    if (!v || typeof v.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name)) {
      result.fileErrors.push(`${label} : "name" invalide`);
      continue;
    }
    if (reserved.has(v.name) || varTypes[v.name]) {
      result.fileErrors.push(`${label} : le nom "${v.name}" est déjà utilisé`);
      continue;
    }
    const errs = [];
    const compiled = compileExpr(v.expr, buildSchema(kind, result.params, varTypes, false), null, 'expr', errs);
    if (!compiled) {
      result.fileErrors.push(`${label} : ${errs.join(' ; ')}`);
      continue;
    }
    varTypes[v.name] = compiled.type || T.any;
    result.vars.push({ name: v.name, compiled });
  }

  const ctxSchema = buildSchema(kind, result.params, varTypes, false);
  const cardSchema = buildSchema(kind, result.params, varTypes, true);

  if (!Array.isArray(raw.rules)) {
    result.fileErrors.push('"rules" doit être une liste');
    return result;
  }

  raw.rules.forEach((r, index) => {
    const errors = [];
    const rule = {
      index,
      id: r && r.id,
      name: r && typeof r.name === 'string' ? r.name : '',
      enabled: !(r && r.enabled === false),
      priority: 0,
      valid: false,
      errors,
      when: null,
      action: null
    };
    result.rules.push(rule);

    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      errors.push('la règle doit être un objet');
      return;
    }
    if (!Number.isInteger(r.id) || r.id <= 0) errors.push('"id" doit être un entier positif');
    for (const key of Object.keys(r)) {
      if (!RULE_KEYS.has(key)) errors.push(`clé inconnue "${key}"`);
    }
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') errors.push('"enabled" doit être true ou false');
    if (r.priority !== undefined) {
      if (typeof r.priority !== 'number' || !Number.isFinite(r.priority)) errors.push('"priority" doit être un nombre');
      else rule.priority = r.priority;
    }
    if (r.when !== undefined) rule.when = compileExpr(r.when, ctxSchema, null, 'when', errors);

    const a = r.action;
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      errors.push('"action" manquante');
    } else if (kind === 'annonce') {
      if (!ANNONCE_ACTIONS.includes(a.type)) {
        errors.push(`action.type inconnu "${a.type}" (possibles : ${ANNONCE_ACTIONS.join(', ')})`);
      } else {
        rule.action = { type: a.type };
        const allowed = a.type === 'bid' ? ['type', 'points', 'suit'] : ['type'];
        for (const key of Object.keys(a)) if (!allowed.includes(key)) errors.push(`action : clé inconnue "${key}" pour "${a.type}"`);
        if (a.type === 'bid') {
          if (a.points === undefined) errors.push('action.points manquant');
          else rule.action.points = compileExpr(String(a.points), ctxSchema, 'number', 'action.points', errors);
          if (a.suit === undefined) errors.push('action.suit manquant');
          else rule.action.suit = compileExpr(a.suit, ctxSchema, 'string', 'action.suit', errors);
        }
      }
    } else {
      if (!JEU_ACTIONS.includes(a.type)) {
        errors.push(`action.type inconnu "${a.type}" (possibles : ${JEU_ACTIONS.join(', ')})`);
      } else {
        rule.action = { type: a.type };
        const allowedByType = {
          play: ['type', 'cards', 'pick', 'by'],
          score: ['type', 'cards', 'value'],
          restrict: ['type', 'cards'],
          exclude: ['type', 'cards']
        };
        for (const key of Object.keys(a)) if (!allowedByType[a.type].includes(key)) errors.push(`action : clé inconnue "${key}" pour "${a.type}"`);
        if (a.cards !== undefined) rule.action.cards = compileExpr(a.cards, cardSchema, null, 'action.cards', errors);
        else if (a.type === 'restrict' || a.type === 'exclude') errors.push('action.cards manquant');
        if (a.type === 'score') {
          if (a.value === undefined) errors.push('action.value manquant');
          else rule.action.value = compileExpr(String(a.value), cardSchema, 'number', 'action.value', errors);
        }
        if (a.type === 'play') {
          const pick = a.pick === undefined ? 'lowest' : a.pick;
          if (!PICKS.includes(pick)) errors.push(`action.pick inconnu "${pick}" (possibles : ${PICKS.join(', ')})`);
          rule.action.pick = pick;
          if (pick === 'max' || pick === 'min') {
            if (a.by === undefined) errors.push(`action.by est requis avec pick "${pick}"`);
            else rule.action.by = compileExpr(String(a.by), cardSchema, 'number', 'action.by', errors);
          } else if (a.by !== undefined) {
            errors.push('action.by n\'est utilisé qu\'avec pick "max" ou "min"');
          }
        }
      }
    }
    rule.valid = errors.length === 0;
  });

  result.ok = result.fileErrors.length === 0;
  // Ordre d'évaluation : priorité décroissante, puis ordre du fichier.
  result.ordered = result.rules
    .filter(r => r.valid && r.enabled)
    .sort((a, b) => (b.priority - a.priority) || (a.index - b.index));
  return result;
}

// ------------------------------------------------------------
// Cache + rechargement à chaud
// ------------------------------------------------------------
const cache = { annonce: null, jeux: null };
const runtimeErrors = new Map(); // id -> { count, message }

function fileMtime(kind) {
  try {
    return fs.statSync(FILES[kind]).mtimeMs;
  } catch {
    return -1;
  }
}

function getRuleSet(kind, { forceReload = false } = {}) {
  const current = cache[kind];
  if (!forceReload && current && current.mtimeMs === fileMtime(kind)) return current;
  cache[kind] = loadRuleFile(kind);
  if (forceReload || !current || current.mtimeMs !== cache[kind].mtimeMs) {
    for (const r of cache[kind].rules) runtimeErrors.delete(`${kind}:${r.id}`);
  }
  return cache[kind];
}

function reloadAll() {
  runtimeErrors.clear();
  return { annonce: getRuleSet('annonce', { forceReload: true }), jeux: getRuleSet('jeux', { forceReload: true }) };
}

/** Rapport de validation (utilisé par /debug rule et les tests). */
function buildReport({ reload = false, files = null } = {}) {
  let sets;
  if (files) {
    // Validation de fichiers arbitraires (tests, outils) sans toucher au cache du serveur.
    sets = { annonce: loadRuleFile('annonce', files.annonce), jeux: loadRuleFile('jeux', files.jeux) };
  } else {
    sets = reload ? reloadAll() : { annonce: getRuleSet('annonce'), jeux: getRuleSet('jeux') };
  }
  const all = [];
  const fileErrors = [];
  for (const kind of ['annonce', 'jeux']) {
    const set = sets[kind];
    for (const e of set.fileErrors) fileErrors.push({ file: path.basename(set.file), message: e });
    for (const r of set.rules) all.push({ ...r, file: path.basename(set.file) });
  }

  // Identifiants uniques sur l'ensemble des deux fichiers.
  const seen = new Map();
  for (const r of all) {
    if (!Number.isInteger(r.id)) continue;
    if (seen.has(r.id)) {
      const first = seen.get(r.id);
      r.errors.push(`id ${r.id} déjà utilisé (${first.file}, règle n°${first.index + 1})`);
      r.valid = false;
    } else {
      seen.set(r.id, r);
    }
  }
  // Une règle devenue invalide (doublon) ne doit pas être exécutée.
  for (const kind of ['annonce', 'jeux']) {
    sets[kind].ordered = sets[kind].ordered.filter(r => r.valid);
  }

  const invalid = all.filter(r => !r.valid);
  const runtime = [];
  for (const [key, info] of runtimeErrors.entries()) runtime.push({ key, ...info });
  return {
    total: all.length,
    valid: all.length - invalid.length,
    invalid: invalid.map(r => ({
      id: Number.isInteger(r.id) ? r.id : `#${r.index + 1}`,
      file: r.file,
      name: r.name,
      errors: r.errors
    })),
    disabled: all.filter(r => r.valid && !r.enabled).length,
    fileErrors,
    runtime
  };
}

function formatReportLines(report, { maxLines = 25 } = {}) {
  const lines = [`${report.total} rules - ${report.valid} valides - ${report.total - report.valid} invalides`];
  if (report.disabled) lines.push(`(${report.disabled} règle(s) valide(s) désactivée(s) avec "enabled": false)`);
  for (const f of report.fileErrors) lines.push(`${f.file} : ${f.message}`);
  for (const r of report.invalid) {
    lines.push(`rule ${r.id} invalide (${r.file}) : ${r.errors.join(' ; ')}`);
  }
  for (const r of report.runtime) {
    lines.push(`rule ${r.key} : erreur à l'exécution (${r.count}x) : ${r.message}`);
  }
  if (lines.length > maxLines) {
    const hidden = lines.length - maxLines + 1;
    return [...lines.slice(0, maxLines - 1), `... ${hidden} ligne(s) supplémentaire(s), voir la console du serveur.`];
  }
  return lines;
}

function noteRuntimeError(kind, rule, err) {
  const key = `${kind}:${rule.id}`;
  const prev = runtimeErrors.get(key);
  runtimeErrors.set(key, { count: (prev ? prev.count : 0) + 1, message: err && err.message ? err.message : String(err) });
}

// ------------------------------------------------------------
// Exécution
// ------------------------------------------------------------
function makeEnv(values, functions) {
  return { values, functions };
}

function computeVars(set, values, functions) {
  for (const v of set.vars) {
    try {
      values[v.name] = evaluate(v.compiled.ast, makeEnv(values, functions));
    } catch {
      values[v.name] = null;
    }
  }
}

function evalWhen(kind, rule, env) {
  if (!rule.when) return true;
  try {
    return truthy(evaluate(rule.when.ast, env));
  } catch (err) {
    noteRuntimeError(kind, rule, err);
    return false;
  }
}

/**
 * Décision d'annonce.
 * ctx : { values, functions, isLegal(action) -> bool, normalizeBid(points) -> points|0 }
 * Retourne { action, rule } ou null si aucune règle ne s'applique.
 */
function runAnnonce(set, ctx) {
  const values = { ...ctx.values, params: { ...set.params } };
  computeVars(set, values, ctx.functions);
  const env = makeEnv(values, ctx.functions);

  for (const rule of set.ordered) {
    if (!evalWhen('annonce', rule, env)) continue;
    const a = rule.action;
    let action;
    try {
      if (a.type === 'bid') {
        const points = ctx.normalizeBid(num(evaluate(a.points.ast, env)));
        const suit = evaluate(a.suit.ast, env);
        if (!points || typeof suit !== 'string') continue;
        action = { type: 'bid', points, suit };
      } else {
        action = { type: a.type };
      }
    } catch (err) {
      noteRuntimeError('annonce', rule, err);
      continue;
    }
    if (ctx.isLegal(action)) return { action, rule };
  }
  return null;
}

/**
 * Décision de jeu.
 * ctx : { values, functions, candidates: [cardView], cardValue(view) -> number (pour lowest/highest) }
 * Retourne { card: cardView, rule, scores } (rule = règle "play" décisive ou null si choix par score)
 */
function runJeu(set, ctx) {
  const values = { ...ctx.values, params: { ...set.params } };
  computeVars(set, values, ctx.functions);
  const env = makeEnv(values, ctx.functions);

  let candidates = ctx.candidates.slice();
  const scores = new Map(candidates.map(c => [c, 0]));
  const scoredBy = [];

  const matches = (rule, card) => {
    if (!rule.action.cards) return true;
    try {
      return truthy(evaluate(rule.action.cards.ast, env, new Map([['card', card]])));
    } catch (err) {
      noteRuntimeError('jeux', rule, err);
      return false;
    }
  };

  for (const rule of set.ordered) {
    if (candidates.length <= 1) break;
    if (!evalWhen('jeux', rule, env)) continue;
    const a = rule.action;

    if (a.type === 'restrict' || a.type === 'exclude') {
      const kept = candidates.filter(c => (a.type === 'restrict' ? matches(rule, c) : !matches(rule, c)));
      if (kept.length > 0 && kept.length < candidates.length) candidates = kept;
      continue;
    }

    if (a.type === 'play') {
      const pool = candidates.filter(c => matches(rule, c));
      if (!pool.length) continue;
      let chosen = pool[0];
      try {
        if (a.pick === 'lowest') chosen = pool.reduce((m, c) => (ctx.cardValue(c) < ctx.cardValue(m) ? c : m));
        else if (a.pick === 'highest') chosen = pool.reduce((m, c) => (ctx.cardValue(c) > ctx.cardValue(m) ? c : m));
        else if (a.pick === 'max' || a.pick === 'min') {
          const sign = a.pick === 'max' ? 1 : -1;
          let best = -Infinity;
          for (const c of pool) {
            const v = sign * num(evaluate(a.by.ast, env, new Map([['card', c]])));
            if (v > best) { best = v; chosen = c; }
          }
        }
      } catch (err) {
        noteRuntimeError('jeux', rule, err);
        continue;
      }
      return { card: chosen, rule, scores, scoredBy };
    }

    if (a.type === 'score') {
      for (const c of candidates) {
        if (!matches(rule, c)) continue;
        try {
          const v = num(evaluate(a.value.ast, env, new Map([['card', c]])));
          if (v) {
            scores.set(c, scores.get(c) + v);
            scoredBy.push(rule.id);
          }
        } catch (err) {
          noteRuntimeError('jeux', rule, err);
        }
      }
    }
  }

  let best = candidates[0];
  for (const c of candidates) {
    const d = scores.get(c) - scores.get(best);
    if (d > 1e-9) best = c;
    else if (Math.abs(d) <= 1e-9 && c !== best) {
      if (set.settings.tieBreak === 'lowest' && ctx.cardValue(c) < ctx.cardValue(best)) best = c;
      else if (set.settings.tieBreak === 'highest' && ctx.cardValue(c) > ctx.cardValue(best)) best = c;
      else if (set.settings.tieBreak === 'evNet' && num(c.evNet) > num(best.evNet)) best = c;
    }
  }
  return { card: best, rule: null, scores, scoredBy };
}

module.exports = {
  FILES,
  loadRuleFile,
  getRuleSet,
  reloadAll,
  buildReport,
  formatReportLines,
  runAnnonce,
  runJeu
};
