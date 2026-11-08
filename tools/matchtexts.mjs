#!/usr/bin/env node
/**
 * matchtexts — the text records of `data/texts.json` against the BG3 map of the running original.
 *
 * The title screen the original drew (`data/screen_title.json`, and the
 * title and menu frames in `build/screens/`, `tools/mkscreen.py`) holds in
 * its BG3 map (VRAM word `$5C00`) the texts its code printed with
 * `S_008938`. This tool runs every record the same way — a byte ≥ `$10` is
 * a tile word of the ASCII tile with the current attribute, the commands
 * set the address, the palette, the tile bank and the priority
 * (`tools/srtlib.py`, "Texts") — and holds the words against the map: a
 * record whose every word is in the map was printed on that frame and is
 * decoded right. The records of the title (PUSH START, LEVEL, the licence
 * line) must be found on the title; the others (the stage-clear texts,
 * the credits) belong to frames no survey reached and are only counted.
 *
 *     tools/matchtexts.mjs [--verbose]
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const verbose = process.argv.includes('--verbose');
const texts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'texts.json'), 'utf8'));
const BG3_MAP = 0x5C00;

/** the words a record writes: [{vram, word}] — the printing task of `L_00895A` */
function expand(record) {
  const out = [];
  let addr = BG3_MAP, attr = 0x2000;
  for (const item of record.items) {
    if (item.text !== undefined) {
      for (const ch of item.text.replace(/\\x([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))) {
        out.push({vram: addr, word: ch.charCodeAt(0) | attr});
        addr++;
      }
      continue;
    }
    switch (item.op) {
      case 'at': addr = item.vram; break;
      case 'palette': attr = (attr & 0xE3FF) | (item.value << 10); break;
      case 'tileHigh': attr = (attr & 0xFC7F) | (item.value << 7); break;
      case 'priorityOn': attr |= 0x2000; break;
      case 'priorityOff': attr &= 0xDFFF; break;
      case 'raw': for (const t of item.tiles) { out.push({vram: addr, word: t | attr}); addr++; } break;
      default: break;
    }
  }
  return out;
}

const frames = [path.join(ROOT, 'data', 'screen_title.json')];
const dir = path.join(ROOT, 'build', 'screens');
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).sort()) { if (/^(attract|menu)_/.test(f)) { frames.push(path.join(dir, f)); } }
}
let checks = 0, differences = 0, found = 0, total = 0;
const seen = new Set();
const titleRecords = texts.calls.filter((c) => (c.caller >> 16) === 0x01 && c.op === 'print').map((c) => String(c.record));
for (const file of frames) {
  if (!fs.existsSync(file)) { continue; }
  const scene = JSON.parse(fs.readFileSync(file, 'utf8'));
  const vram = Buffer.from(scene.vram, 'base64');
  const word = (a) => vram[2*a] | (vram[2*a+1] << 8);
  let onFrame = 0;
  const covered = new Set();          // map words a record found whole wrote — a later print over an earlier one
  const entries = Object.entries(texts.records).map(([key, rec]) => [key, rec, expand(rec)]).filter((e) => e[2].length);
  for (const [key, rec, words] of entries) {
    if (words.every((w) => word(w.vram) === w.word)) {
      onFrame++; seen.add(key); words.forEach((w) => covered.add(w.vram));
      if (verbose) { console.log(`    ${path.basename(file)}: ${rec.plain.slice(0, 40)}`); }
    }
  }
  for (const [key, rec, words] of entries) {
    if (seen.has(key)) { continue; }
    // the rest of a record whose other words a later record overwrote (the choices inside the brackets)
    const rest = words.filter((w) => !covered.has(w.vram));
    if (rest.length && rest.length < words.length && rest.every((w) => word(w.vram) === w.word)) {
      onFrame++; seen.add(key);
      if (verbose) { console.log(`    ${path.basename(file)}: ${rec.plain.slice(0, 40)} (${words.length-rest.length} words under a later print)`); }
    }
  }
  console.log(`  ${path.basename(file).padEnd(26)} ${onFrame} records printed on it`);
}
// every text the title code prints must have been seen on a title frame — by its wording, since the same
// words exist as more records (the LEVEL line and the SELECT SCENE line print them at other places)
const byText = new Map();
for (const key of new Set(titleRecords)) {
  const rec = texts.records[key];
  if (!byText.has(rec.plain)) { byText.set(rec.plain, []); }
  byText.get(rec.plain).push(key);
}
for (const [plain, keys] of byText) {
  // a text only a choice shows (NOVICE/NORMAL/HARD, MONO, BGM/S.E, the cursor) is on no plain-title frame
  if (/NOVICE|NORMAL|HARD|MONO|BGM|S\.E|__00__|\\x10/.test(plain) || plain.trim() === '') { continue; }
  total++;
  const n = expand(texts.records[keys[0]]).length;
  checks += n;
  if (keys.some((k) => seen.has(k))) { found++; } else { differences += n; console.log(`    DIFF "${plain}" on no title frame`); }
}
console.log(`matchtexts.mjs: ${frames.length} frames, ${Object.keys(texts.records).length} records (${seen.size} seen printed, ${found} of ${total} title records), ${checks} checks, ${differences} differences`);
process.exit(differences ? 1 : 0);
