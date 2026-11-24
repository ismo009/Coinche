// ============================================================
// Mini-langage d'expressions des fichiers de règles (rule_annonce.json / rule_jeux.json)
//
// - Aucun eval / Function : les expressions sont analysées puis interprétées.
// - Syntaxe proche du JavaScript :
//     role == 'defense' && trick.size == 0
//     card.isTrump ? card.points * 2 : card.points
//     count(hand, c => c.suit == trump) >= 3
//     pGain(card, 21) > 0.5
// - Validation statique (identifiants, champs, fonctions, valeurs d'énumération)
//   avant toute exécution : c'est ce qu'affiche /debug rule.
// Voir RULE.md pour la documentation utilisateur.
// ============================================================

class ExpressionError extends Error {}

// ------------------------------------------------------------
// Tokenizer
// ------------------------------------------------------------
const OPERATORS = ['=>', '==', '!=', '<=', '>=', '&&', '||', '!', '<', '>', '+', '-', '*', '/', '%', '?', ':', '(', ')', '[', ']', ',', '.'];
const WORD_OPERATORS = { and: '&&', or: '||', not: '!' };

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ExpressionError(`nombre invalide '${raw}'`);
      tokens.push({ type: 'num', value, pos: i });
      i = j;
      continue;
    }

    if (ch === '\'' || ch === '"') {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) { out += src[j + 1]; j += 2; continue; }
        out += src[j++];
      }
      if (j >= src.length) throw new ExpressionError('chaîne non terminée');
      tokens.push({ type: 'str', value: out, pos: i });
      i = j + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (WORD_OPERATORS[word]) tokens.push({ type: 'op', value: WORD_OPERATORS[word], pos: i });
      else if (word === 'in') tokens.push({ type: 'op', value: 'in', pos: i });
      else if (word === 'true' || word === 'false') tokens.push({ type: 'bool', value: word === 'true', pos: i });
      else if (word === 'null') tokens.push({ type: 'null', value: null, pos: i });
      else tokens.push({ type: 'id', value: word, pos: i });
      i = j;
      continue;
    }

    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (op) {
      tokens.push({ type: 'op', value: op, pos: i });
      i += op.length;
      continue;
    }
    throw new ExpressionError(`caractère inattendu '${ch}' (position ${i})`);
  }
  tokens.push({ type: 'eof', pos: src.length });
  return tokens;
}

// ------------------------------------------------------------
// Parser (Pratt)
// ------------------------------------------------------------
const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4, in: 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6
};

function parse(src) {
  if (typeof src !== 'string') throw new ExpressionError('l\'expression doit être une chaîne de caractères');
  if (!src.trim()) throw new ExpressionError('expression vide');
  if (src.length > 2000) throw new ExpressionError('expression trop longue (> 2000 caractères)');
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isOp = (v) => peek().type === 'op' && peek().value === v;
  const expectOp = (v) => {
    if (!isOp(v)) throw new ExpressionError(`'${v}' attendu (position ${peek().pos})`);
    return next();
  };

  function parseExpression() {
    return parseTernary();
  }

  function parseTernary() {
    const cond = parseBinary(1);
    if (isOp('?')) {
      next();
      const a = parseTernary();
      expectOp(':');
      const b = parseTernary();
      return { t: 'cond', c: cond, a, b };
    }
    return cond;
  }

  function parseBinary(minPrec) {
    let left = parseUnary();
    for (;;) {
      const tok = peek();
      if (tok.type !== 'op') break;
      const prec = BINARY_PRECEDENCE[tok.value];
      if (!prec || prec < minPrec) break;
      next();
      const right = parseBinary(prec + 1);
      left = { t: 'bin', op: tok.value, l: left, r: right };
    }
    return left;
  }

  function parseUnary() {
    if (isOp('!') || isOp('-')) {
      const op = next().value;
      return { t: 'un', op, arg: parseUnary() };
    }
    return parsePostfix(parsePrimary());
  }

  function parsePostfix(node) {
    for (;;) {
      if (isOp('.')) {
        next();
        const id = next();
        if (id.type !== 'id') throw new ExpressionError(`nom de champ attendu après '.' (position ${id.pos})`);
        node = { t: 'mem', obj: node, prop: id.value };
      } else if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) {
          args.push(parseArgument());
          while (isOp(',')) { next(); args.push(parseArgument()); }
        }
        expectOp(')');
        node = { t: 'call', callee: node, args };
      } else if (isOp('[')) {
        next();
        const index = parseExpression();
        expectOp(']');
        node = { t: 'idx', obj: node, index };
      } else {
        break;
      }
    }
    return node;
  }

  function parseArgument() {
    // Lambda : x => expr
    if (peek().type === 'id' && tokens[p + 1] && tokens[p + 1].type === 'op' && tokens[p + 1].value === '=>') {
      const param = next().value;
      next();
      return { t: 'lam', param, body: parseExpression() };
    }
    return parseExpression();
  }

  function parsePrimary() {
    const tok = next();
    switch (tok.type) {
      case 'num': return { t: 'lit', v: tok.value };
      case 'str': return { t: 'lit', v: tok.value };
      case 'bool': return { t: 'lit', v: tok.value };
      case 'null': return { t: 'lit', v: null };
      case 'id': return { t: 'id', name: tok.value };
      case 'op':
        if (tok.value === '(') {
          const e = parseExpression();
          expectOp(')');
          return e;
        }
        if (tok.value === '[') {
          const items = [];
          if (!isOp(']')) {
            items.push(parseExpression());
            while (isOp(',')) { next(); items.push(parseExpression()); }
          }
          expectOp(']');
          return { t: 'arr', items };
        }
        throw new ExpressionError(`opérateur inattendu '${tok.value}' (position ${tok.pos})`);
      default:
        throw new ExpressionError(`fin d'expression inattendue (position ${tok.pos})`);
    }
  }

  const ast = parseExpression();
  if (peek().type !== 'eof') throw new ExpressionError(`élément inattendu '${peek().value}' (position ${peek().pos})`);
  return ast;
}

// ------------------------------------------------------------
// Types (pour la validation statique)
// Un "schéma" décrit les identifiants disponibles :
//   { kind: 'object', fields: { name: type } }
//   { kind: 'list', of: type }
//   { kind: 'enum', values: [...] }           (chaîne parmi des valeurs connues)
//   { kind: 'number' } | { kind: 'bool' } | { kind: 'string' } | { kind: 'any' }
//   { kind: 'func', min, max, returns, args?: [types] }
// ------------------------------------------------------------
const T = {
  number: { kind: 'number' },
  bool: { kind: 'bool' },
  string: { kind: 'string' },
  any: { kind: 'any' },
  enumOf: (values) => ({ kind: 'enum', values }),
  list: (of) => ({ kind: 'list', of }),
  object: (fields) => ({ kind: 'object', fields }),
  func: (min, max, returns, extra = {}) => ({ kind: 'func', min, max, returns, ...extra })
};

// Fonctions génériques toujours disponibles.
// listArg : index de l'argument liste dont le type d'élément est donné aux lambdas.
const GENERIC_FUNCTIONS = {
  count: T.func(1, 2, T.number, { listArg: 0 }),
  any: T.func(2, 2, T.bool, { listArg: 0 }),
  all: T.func(2, 2, T.bool, { listArg: 0 }),
  none: T.func(2, 2, T.bool, { listArg: 0 }),
  sum: T.func(1, 2, T.number, { listArg: 0 }),
  avg: T.func(1, 2, T.number, { listArg: 0 }),
  filter: T.func(2, 2, 'sameList', { listArg: 0 }),
  first: T.func(1, 2, 'element', { listArg: 0 }),
  last: T.func(1, 2, 'element', { listArg: 0 }),
  minBy: T.func(2, 2, 'element', { listArg: 0 }),
  maxBy: T.func(2, 2, 'element', { listArg: 0 }),
  len: T.func(1, 1, T.number),
  contains: T.func(2, 2, T.bool),
  min: T.func(1, 10, T.number),
  max: T.func(1, 10, T.number),
  abs: T.func(1, 1, T.number),
  round: T.func(1, 2, T.number),
  floor: T.func(1, 1, T.number),
  ceil: T.func(1, 1, T.number),
  clamp: T.func(3, 3, T.number),
  roundTo10: T.func(1, 1, T.number),
  binom: T.func(2, 2, T.number),
  // P(au moins une "réussite") en tirant `draws` cartes parmi `population` dont `successes` réussites.
  pAtLeastOne: T.func(3, 3, T.number),
  // P(exactement k réussites) — loi hypergéométrique.
  pExactly: T.func(4, 4, T.number),
  // P(au moins k réussites) — loi hypergéométrique.
  pAtLeast: T.func(4, 4, T.number)
};

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function hyperExactly(population, successes, draws, k) {
  const denom = binomial(population, draws);
  if (!denom) return 0;
  return (binomial(successes, k) * binomial(population - successes, draws - k)) / denom;
}

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function callLambda(fn, item) {
  return typeof fn === 'function' ? fn(item) : item;
}

const GENERIC_IMPL = {
  count: (list, pred) => (pred === undefined ? toList(list).length : toList(list).filter(x => truthy(callLambda(pred, x))).length),
  any: (list, pred) => toList(list).some(x => truthy(callLambda(pred, x))),
  all: (list, pred) => toList(list).every(x => truthy(callLambda(pred, x))),
  none: (list, pred) => !toList(list).some(x => truthy(callLambda(pred, x))),
  sum: (list, map) => toList(list).reduce((acc, x) => acc + num(map === undefined ? x : callLambda(map, x)), 0),
  avg: (list, map) => {
    const l = toList(list);
    return l.length ? GENERIC_IMPL.sum(l, map) / l.length : 0;
  },
  filter: (list, pred) => toList(list).filter(x => truthy(callLambda(pred, x))),
  first: (list, pred) => (pred === undefined ? toList(list)[0] : toList(list).find(x => truthy(callLambda(pred, x)))) ?? null,
  last: (list, pred) => {
    const l = pred === undefined ? toList(list) : toList(list).filter(x => truthy(callLambda(pred, x)));
    return l.length ? l[l.length - 1] : null;
  },
  minBy: (list, map) => {
    let best = null; let bestV = Infinity;
    for (const x of toList(list)) { const v = num(callLambda(map, x)); if (v < bestV) { bestV = v; best = x; } }
    return best;
  },
  maxBy: (list, map) => {
    let best = null; let bestV = -Infinity;
    for (const x of toList(list)) { const v = num(callLambda(map, x)); if (v > bestV) { bestV = v; best = x; } }
    return best;
  },
  len: (x) => (Array.isArray(x) || typeof x === 'string' ? x.length : 0),
  contains: (list, value) => toList(list).some(x => looseEquals(x, value)),
  min: (...args) => Math.min(...flattenNumbers(args)),
  max: (...args) => Math.max(...flattenNumbers(args)),
  abs: (x) => Math.abs(num(x)),
  round: (x, digits) => {
    const f = Math.pow(10, num(digits) || 0);
    return Math.round(num(x) * f) / f;
  },
  floor: (x) => Math.floor(num(x)),
  ceil: (x) => Math.ceil(num(x)),
  clamp: (x, lo, hi) => Math.min(num(hi), Math.max(num(lo), num(x))),
  roundTo10: (x) => Math.round(num(x) / 10) * 10,
  binom: (n, k) => binomial(num(n), num(k)),
  pAtLeastOne: (population, successes, draws) => {
    const N = num(population); const K = num(successes); const n = num(draws);
    if (K <= 0 || n <= 0 || N <= 0) return 0;
    return 1 - hyperExactly(N, K, Math.min(n, N), 0);
  },
  pExactly: (population, successes, draws, k) => hyperExactly(num(population), num(successes), num(draws), num(k)),
  pAtLeast: (population, successes, draws, k) => {
    let p = 0;
    for (let i = Math.max(0, num(k)); i <= num(draws); i++) p += hyperExactly(num(population), num(successes), num(draws), i);
    return Math.min(1, p);
  }
};

function flattenNumbers(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) a.forEach(x => out.push(num(x)));
    else out.push(num(a));
  }
  return out.length ? out : [0];
}

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return 0;
}

function truthy(v) {
  return !!v;
}

function looseEquals(a, b) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && 'rank' in a && 'suit' in a) {
    return a.rank === b.rank && a.suit === b.suit;
  }
  return a === b;
}

// ------------------------------------------------------------
// Validation statique
// ------------------------------------------------------------
const FORBIDDEN_FIELDS = new Set(['__proto__', 'prototype', 'constructor']);
// Valeurs texte courantes : si on les écrit sans guillemets, on le signale clairement.
const LITERAL_HINTS = new Set(['coeur', 'carreau', 'trefle', 'pique', 'as', 'roi', 'dame', 'valet',
  'sud', 'nord', 'est', 'ouest', 'attack', 'defense', 'us', 'them', 'me', 'opponent', 'none', 'couleur']);

/**
 * Valide un AST contre un schéma. Lance ExpressionError en cas de problème.
 * schema : { identifiers: {name: type}, functions: {name: funcType} }
 * Retourne le type inféré de l'expression.
 */
function validate(ast, schema, expected) {
  const type = check(ast, schema, new Map());
  if (expected === 'number' && type && (type.kind === 'bool' || type.kind === 'string' || type.kind === 'enum' || type.kind === 'list' || type.kind === 'object')) {
    throw new ExpressionError(`un nombre est attendu (l'expression donne un ${kindLabel(type)})`);
  }
  if (expected === 'string' && type && (type.kind === 'number' || type.kind === 'bool' || type.kind === 'list' || type.kind === 'object')) {
    throw new ExpressionError(`une chaîne est attendue (l'expression donne un ${kindLabel(type)})`);
  }
  return type;
}

function kindLabel(type) {
  return { number: 'nombre', bool: 'booléen', string: 'texte', enum: 'texte', list: 'liste', object: 'objet', func: 'fonction' }[type.kind] || type.kind;
}

function check(node, schema, locals) {
  switch (node.t) {
    case 'lit':
      if (typeof node.v === 'number') return T.number;
      if (typeof node.v === 'boolean') return T.bool;
      if (typeof node.v === 'string') return { kind: 'string', literal: node.v };
      return T.any;
    case 'arr':
      node.items.forEach(i => check(i, schema, locals));
      return T.list(T.any);
    case 'id': {
      if (locals.has(node.name)) return locals.get(node.name);
      if (schema.identifiers[node.name]) return schema.identifiers[node.name];
      if (schema.functions[node.name] || GENERIC_FUNCTIONS[node.name]) {
        throw new ExpressionError(`'${node.name}' est une fonction : utilise ${node.name}(...)`);
      }
      if (LITERAL_HINTS.has(node.name)) {
        throw new ExpressionError(`identifiant inconnu '${node.name}' : pour une valeur texte, écris '${node.name}' entre guillemets`);
      }
      throw new ExpressionError(`identifiant inconnu '${node.name}'`);
    }
    case 'mem': {
      if (FORBIDDEN_FIELDS.has(node.prop)) throw new ExpressionError(`champ interdit '${node.prop}'`);
      const objType = check(node.obj, schema, locals);
      if (objType.kind === 'object') {
        const f = objType.fields[node.prop];
        if (!f) throw new ExpressionError(`champ inconnu '${node.prop}' (champs possibles : ${Object.keys(objType.fields).join(', ')})`);
        return f;
      }
      if (objType.kind === 'list' && node.prop === 'length') return T.number;
      if (objType.kind === 'any') return T.any;
      throw new ExpressionError(`impossible de lire '.${node.prop}' sur une valeur de type ${kindLabel(objType)}`);
    }
    case 'idx': {
      const objType = check(node.obj, schema, locals);
      check(node.index, schema, locals);
      if (objType.kind === 'list') return objType.of || T.any;
      return T.any;
    }
    case 'lam':
      throw new ExpressionError('une fonction fléchée (x => ...) n\'est permise qu\'en argument de fonction');
    case 'call': {
      if (node.callee.t !== 'id') throw new ExpressionError('seules les fonctions intégrées peuvent être appelées');
      const name = node.callee.name;
      const fn = schema.functions[name] || GENERIC_FUNCTIONS[name];
      if (!fn) throw new ExpressionError(`fonction inconnue '${name}()'`);
      if (node.args.length < fn.min || node.args.length > fn.max) {
        const expectedArgs = fn.min === fn.max ? `${fn.min}` : `${fn.min} à ${fn.max}`;
        throw new ExpressionError(`${name}() attend ${expectedArgs} argument(s), ${node.args.length} donné(s)`);
      }
      let listType = null;
      node.args.forEach((arg, i) => {
        if (arg.t === 'lam') {
          const elementType = listType && listType.kind === 'list' ? (listType.of || T.any) : T.any;
          const inner = new Map(locals);
          inner.set(arg.param, elementType);
          check(arg.body, schema, inner);
          return;
        }
        const argType = check(arg, schema, locals);
        if (fn.listArg === i) listType = argType;
        const expectedType = fn.args && fn.args[i];
        if (expectedType && expectedType.kind === 'enum' && argType.kind === 'string' && argType.literal !== undefined && !expectedType.values.includes(argType.literal)) {
          throw new ExpressionError(`${name}() : valeur '${argType.literal}' inconnue (valeurs possibles : ${expectedType.values.join(', ')})`);
        }
      });
      if (fn.returns === 'sameList') return listType || T.list(T.any);
      if (fn.returns === 'element') return listType && listType.kind === 'list' ? (listType.of || T.any) : T.any;
      return fn.returns || T.any;
    }
    case 'un': {
      check(node.arg, schema, locals);
      return node.op === '!' ? T.bool : T.number;
    }
    case 'bin': {
      const lt = check(node.l, schema, locals);
      const rt = check(node.r, schema, locals);
      if (node.op === '==' || node.op === '!=') {
        checkEnumComparison(lt, rt);
        checkEnumComparison(rt, lt);
        return T.bool;
      }
      if (node.op === 'in') {
        if (node.r.t === 'arr' && lt.kind === 'enum') {
          for (const item of node.r.items) {
            if (item.t === 'lit' && typeof item.v === 'string' && !lt.values.includes(item.v)) {
              throw new ExpressionError(`valeur '${item.v}' inconnue (valeurs possibles : ${lt.values.join(', ')})`);
            }
          }
        }
        return T.bool;
      }
      if (['&&', '||', '<', '<=', '>', '>='].includes(node.op)) return T.bool;
      if (node.op === '+' && (lt.kind === 'string' || rt.kind === 'string')) return T.string;
      return T.number;
    }
    case 'cond': {
      check(node.c, schema, locals);
      const a = check(node.a, schema, locals);
      check(node.b, schema, locals);
      return a;
    }
    default:
      throw new ExpressionError('expression non comprise');
  }
}

function checkEnumComparison(enumType, otherType) {
  if (enumType.kind === 'enum' && otherType.kind === 'string' && otherType.literal !== undefined) {
    if (!enumType.values.includes(otherType.literal)) {
      throw new ExpressionError(`valeur '${otherType.literal}' inconnue (valeurs possibles : ${enumType.values.join(', ')})`);
    }
  }
}

// ------------------------------------------------------------
// Évaluation
// ------------------------------------------------------------
const MAX_STEPS = 200000;

/**
 * Évalue un AST.
 * env : { values: objet racine (identifiants), functions: {name: fn} }
 */
function evaluate(ast, env, locals = null) {
  const state = { steps: 0 };
  return evalNode(ast, env, locals || new Map(), state);
}

function readField(obj, prop) {
  if (obj === null || obj === undefined) return null;
  if (FORBIDDEN_FIELDS.has(prop)) return null;
  if (Array.isArray(obj) && prop === 'length') return obj.length;
  if (typeof obj !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(obj, prop)) return null;
  const v = obj[prop];
  return v === undefined ? null : v;
}

function evalNode(node, env, locals, state) {
  if (++state.steps > MAX_STEPS) throw new ExpressionError('expression trop coûteuse (boucle trop longue)');
  switch (node.t) {
    case 'lit': return node.v;
    case 'arr': return node.items.map(i => evalNode(i, env, locals, state));
    case 'id':
      if (locals.has(node.name)) return locals.get(node.name);
      return readField(env.values, node.name);
    case 'mem':
      return readField(evalNode(node.obj, env, locals, state), node.prop);
    case 'idx': {
      const obj = evalNode(node.obj, env, locals, state);
      const index = evalNode(node.index, env, locals, state);
      if (Array.isArray(obj) && typeof index === 'number') return obj[Math.trunc(index)] ?? null;
      if (obj && typeof obj === 'object' && typeof index === 'string') return readField(obj, index);
      return null;
    }
    case 'call': {
      const name = node.callee.name;
      const fn = (env.functions && Object.prototype.hasOwnProperty.call(env.functions, name) && env.functions[name]) || GENERIC_IMPL[name];
      if (typeof fn !== 'function') throw new ExpressionError(`fonction inconnue '${name}()'`);
      const args = node.args.map(arg => {
        if (arg.t === 'lam') {
          return (item) => {
            const inner = new Map(locals);
            inner.set(arg.param, item);
            return evalNode(arg.body, env, inner, state);
          };
        }
        return evalNode(arg, env, locals, state);
      });
      const result = fn(...args);
      return result === undefined ? null : result;
    }
    case 'un': {
      const v = evalNode(node.arg, env, locals, state);
      return node.op === '!' ? !truthy(v) : -num(v);
    }
    case 'bin': {
      if (node.op === '&&') {
        const l = evalNode(node.l, env, locals, state);
        return truthy(l) ? truthy(evalNode(node.r, env, locals, state)) : false;
      }
      if (node.op === '||') {
        const l = evalNode(node.l, env, locals, state);
        return truthy(l) ? true : truthy(evalNode(node.r, env, locals, state));
      }
      const l = evalNode(node.l, env, locals, state);
      const r = evalNode(node.r, env, locals, state);
      switch (node.op) {
        case '==': return looseEquals(l, r);
        case '!=': return !looseEquals(l, r);
        case '<': return num(l) < num(r);
        case '<=': return num(l) <= num(r);
        case '>': return num(l) > num(r);
        case '>=': return num(l) >= num(r);
        case 'in': return Array.isArray(r) ? r.some(x => looseEquals(x, l)) : false;
        case '+':
          if (typeof l === 'string' || typeof r === 'string') return `${l ?? ''}${r ?? ''}`;
          return num(l) + num(r);
        case '-': return num(l) - num(r);
        case '*': return num(l) * num(r);
        case '/': return num(r) === 0 ? 0 : num(l) / num(r);
        case '%': return num(r) === 0 ? 0 : num(l) % num(r);
        default: throw new ExpressionError(`opérateur inconnu '${node.op}'`);
      }
    }
    case 'cond':
      return truthy(evalNode(node.c, env, locals, state))
        ? evalNode(node.a, env, locals, state)
        : evalNode(node.b, env, locals, state);
    default:
      throw new ExpressionError('expression non comprise');
  }
}

/** Compile une expression : parse + validation. Retourne { ast, type }. */
function compile(src, schema, expected) {
  const ast = parse(src);
  const type = validate(ast, schema, expected);
  return { ast, type, src };
}

module.exports = {
  ExpressionError,
  T,
  GENERIC_FUNCTIONS,
  tokenize,
  parse,
  validate,
  compile,
  evaluate,
  num,
  truthy
};
