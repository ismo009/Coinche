// Emotes en image : validation des fichiers PNG de public/emotes/ et registre en cache.
// Sans dépendance externe : on lit juste l'en-tête PNG (signature + IHDR) et la liste des chunks.
//
// Une emote valide est un PNG 256x256 avec une transparence réelle :
//   - type de couleur 6 (RGBA) ou 4 (niveaux de gris + alpha),
//   - ou type 3 (palette) accompagné d'un chunk tRNS.
// Son identifiant est le nom du fichier sans extension (caractères [a-z0-9_-] uniquement).
const fs = require('fs');
const path = require('path');

const EMOTE_SIZE = 256;
const MAX_EMOTE_BYTES = 300 * 1024;
const MAX_LABEL_LENGTH = 24;
const EMOTE_ID_REGEX = /^[a-z0-9_-]{1,40}$/;
const LABELS_FILE = 'emotes.json';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RESCAN_CHECK_MS = 2000;

function isValidEmoteId(id) {
  return typeof id === 'string' && EMOTE_ID_REGEX.test(id);
}

// Analyse un tampon PNG. Retourne { ok: true, width, height, colorType } ou { ok: false, reason }.
function validatePngBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < PNG_SIGNATURE.length + 25) {
    return { ok: false, reason: 'fichier trop court pour être un PNG' };
  }
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, reason: 'signature PNG absente (ce n\'est pas un PNG)' };
  }
  if (buf.readUInt32BE(8) !== 13 || buf.toString('latin1', 12, 16) !== 'IHDR') {
    return { ok: false, reason: 'chunk IHDR manquant ou invalide' };
  }

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25];
  if (width !== EMOTE_SIZE || height !== EMOTE_SIZE) {
    return { ok: false, reason: `taille ${width}x${height}, attendu ${EMOTE_SIZE}x${EMOTE_SIZE}` };
  }

  if (colorType === 6 || colorType === 4) return { ok: true, width, height, colorType };
  if (colorType !== 3) {
    return { ok: false, reason: `pas de canal alpha (type de couleur ${colorType}, attendu 6 RGBA, 4 gris+alpha ou 3 palette+tRNS)` };
  }

  // Palette : chercher un chunk tRNS (placé avant le premier IDAT).
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (type === 'tRNS') return { ok: true, width, height, colorType };
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }
  return { ok: false, reason: 'image en palette sans chunk tRNS (aucune transparence)' };
}

// Libellé par défaut : "coup-de-coeur" -> "Coup de coeur".
function labelFromId(id) {
  const words = id.replace(/[-_]+/g, ' ').trim();
  if (!words) return id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function sanitizeLabel(raw) {
  if (typeof raw !== 'string') return null;
  // Retire les caractères de contrôle / bidi, comme pour les pseudos.
  const value = raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim();
  if (!value) return null;
  return value.slice(0, MAX_LABEL_LENGTH);
}

function readLabels(dir, warn) {
  const file = path.join(dir, LABELS_FILE);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('objet attendu');
    return parsed;
  } catch (err) {
    warn(`[emotes] ${LABELS_FILE} ignoré : JSON invalide (${err.message})`);
    return {};
  }
}

// Parcourt un dossier d'emotes. Retourne { valid: [{ id, label, url, file }], invalid: [{ file, reason }] }.
function scanEmotes(dir, { warn = () => {} } = {}) {
  const valid = [];
  const invalid = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') warn(`[emotes] dossier illisible ${dir} : ${err.message}`);
    return { valid, invalid };
  }

  const labels = readLabels(dir, warn);
  // Ordre d'affichage : celui de emotes.json, puis les autres par ordre alphabétique.
  const order = Object.keys(labels);
  const rank = (name) => {
    const i = order.indexOf(path.basename(name, path.extname(name)));
    return i === -1 ? order.length : i;
  };
  const files = entries
    .filter(e => e.isFile() && path.extname(e.name).toLowerCase() === '.png')
    .map(e => e.name)
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));

  for (const file of files) {
    const id = path.basename(file, path.extname(file));
    const reject = (reason) => {
      invalid.push({ file, reason });
      warn(`[emotes] ${file} ignoré : ${reason}`);
    };

    if (!isValidEmoteId(id) || path.extname(file) !== '.png') {
      reject('nom invalide (seulement a-z, 0-9, _ et -, extension .png en minuscules)');
      continue;
    }
    const full = path.join(dir, file);
    let buf;
    try {
      const { size } = fs.statSync(full);
      if (size > MAX_EMOTE_BYTES) {
        reject(`fichier trop lourd (${Math.ceil(size / 1024)} Ko, max ${MAX_EMOTE_BYTES / 1024} Ko)`);
        continue;
      }
      buf = fs.readFileSync(full);
    } catch (err) {
      reject(`lecture impossible (${err.message})`);
      continue;
    }
    const check = validatePngBuffer(buf);
    if (!check.ok) {
      reject(check.reason);
      continue;
    }
    valid.push({
      id,
      label: sanitizeLabel(labels[id]) || labelFromId(id),
      url: `/emotes/${id}.png`,
      file
    });
  }
  return { valid, invalid };
}

// Signature peu coûteuse du dossier (noms, tailles, dates) pour savoir s'il faut rescanner.
function dirSignature(dir) {
  try {
    const parts = [];
    for (const name of fs.readdirSync(dir).sort()) {
      const lower = name.toLowerCase();
      if (!lower.endsWith('.png') && name !== LABELS_FILE) continue;
      try {
        const st = fs.statSync(path.join(dir, name));
        parts.push(`${name}:${st.size}:${st.mtimeMs}`);
      } catch {
        parts.push(`${name}:?`);
      }
    }
    return parts.join('|');
  } catch {
    return '';
  }
}

// Registre en cache : rescanne le dossier quand son contenu change (vérifié au plus toutes les 2 s).
function createEmoteRegistry(dir, { warn = (msg) => console.warn(msg), checkIntervalMs = RESCAN_CHECK_MS } = {}) {
  let signature = null;
  let lastCheck = 0;
  let emotes = [];
  let byId = new Map();

  function refresh() {
    const now = Date.now();
    if (signature !== null && now - lastCheck < checkIntervalMs) return;
    lastCheck = now;
    const sig = dirSignature(dir);
    if (sig === signature) return;
    signature = sig;
    emotes = scanEmotes(dir, { warn }).valid.map(({ id, label, url }) => ({ id, label, url }));
    byId = new Map(emotes.map(e => [e.id, e]));
  }

  return {
    list() {
      refresh();
      return emotes.map(e => ({ ...e }));
    },
    has(id) {
      if (!isValidEmoteId(id)) return false;
      refresh();
      return byId.has(id);
    }
  };
}

module.exports = {
  EMOTE_SIZE,
  MAX_EMOTE_BYTES,
  isValidEmoteId,
  validatePngBuffer,
  scanEmotes,
  createEmoteRegistry,
  labelFromId
};
