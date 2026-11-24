#!/usr/bin/env node
// Vérifie les emotes : node tools/check-emotes.js [dossier]
// Liste les emotes valides et les fichiers ignorés (avec la raison).
// Code de sortie 1 s'il y a au moins un fichier invalide.
const path = require('path');
const { scanEmotes, EMOTE_SIZE, MAX_EMOTE_BYTES } = require('../lib/emotes');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'public', 'emotes'));
const { valid, invalid } = scanEmotes(dir);

console.log(`Dossier : ${dir}`);
console.log(`Règles : PNG ${EMOTE_SIZE}x${EMOTE_SIZE} avec transparence, ${MAX_EMOTE_BYTES / 1024} Ko max, nom en [a-z0-9_-].\n`);
console.log(`Emotes valides (${valid.length}) :`);
for (const e of valid) console.log(`  ok   ${e.id.padEnd(16)} ${e.label}`);
if (invalid.length) {
  console.log(`\nFichiers ignorés (${invalid.length}) :`);
  for (const f of invalid) console.log(`  ERR  ${f.file} : ${f.reason}`);
  process.exitCode = 1;
} else {
  console.log('\nAucun fichier invalide.');
}
