/**
 * Remove emojis dos arquivos do sistema — VERSÃO SEGURA.
 *
 * Diferente de \p{Emoji_Component} (que captura também dígitos 0-9 porque
 * podem fazer parte de keycap emojis tipo 1️⃣), aqui usamos apenas
 * \p{Extended_Pictographic} que captura SÓ os glifos de emoji reais.
 *
 * Uso: node scripts/remove-emojis.js
 */

const fs = require('fs');
const path = require('path');

// Apenas Extended_Pictographic + modificadores de pele + variation selector + ZWJ em sequência
const EMOJI_RX = /\p{Extended_Pictographic}(\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*/gu;

function processFile(file) {
  const original = fs.readFileSync(file, 'utf8');
  const cleaned = original.replace(EMOJI_RX, '');
  if (cleaned !== original) {
    fs.writeFileSync(file, cleaned);
    return true;
  }
  return false;
}

const DIRS = ['public', 'src', 'templates'];
const ROOT_FILES = ['SETUP.md', 'secrets/README.md'];
const EXTS = ['.html', '.js', '.md', '.css'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, out);
    } else if (EXTS.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const ROOT = path.resolve(__dirname, '..');
let files = [];
for (const d of DIRS) files = files.concat(walk(path.join(ROOT, d)));
for (const f of ROOT_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) files.push(p);
}

let changed = 0;
for (const f of files) {
  if (processFile(f)) {
    console.log(`OK ${path.relative(ROOT, f)}`);
    changed++;
  }
}
console.log(`\n${changed} de ${files.length} arquivos modificados.`);
