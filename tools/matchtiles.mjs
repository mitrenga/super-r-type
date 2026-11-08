#!/usr/bin/env node
/**
 * matchtiles — every run of tile bytes of `data/tiles.json` against the VRAM of the running original, byte for byte.
 *
 * Over the frames `tools/tracelevels.py` recorded (every section at many
 * moments) and the title frames of `tools/mkscreen.py`:
 *
 * - the **background set** of the section at VRAM `$2000` — the bytes
 *   inside the set's bank (past it the DMA read WRAM, `dumptiles.py`);
 * - the **font** at `$5000`;
 * - the **common sprite set** at `$6200`-`$6FFF` in a section, the
 *   **title set** at `$6000`-`$7FFF` on the title;
 * - the ship's **animation buffer** at `$6000`-`$61FF`: every 32-byte
 *   tile there is a tile of the ship run `$05:B300` (membership);
 * - the **dynamic sprite slots** at `$7000`-`$7FFF`: every 16×16 group
 *   the VRAM holds (128 B, two rows of 64) is a group of one of the
 *   dynamic sets — or of the title / launch set that was there before
 *   (membership; which set sits where is a state of the game, M5).
 *
 *     tools/matchtiles.mjs [--verbose]
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const verbose = process.argv.includes('--verbose');
const tiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tiles.json'), 'utf8'));
const levels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'levels.json'), 'utf8'));
const bytes = (b64) => Buffer.from(b64, 'base64');

let checks = 0, differences = 0;
function compareRun(name, vram, vramWord, data) {
  let bad = 0;
  for (let i = 0; i < data.length; i++) { if (vram[vramWord*2+i] !== data[i]) { bad++; } }
  checks += data.length; differences += bad;
  if (bad) { console.log(`    DIFF ${name}: ${bad} of ${data.length} bytes`); }
}

// every 16×16 group a dynamic set can put at a slot, by the slot's VRAM word (the slot byte b → word $7000 + 16b,
// two tile rows of 64 B, $100 words apart), and what the title's and the launch's 16 KB hold at the same words
const candidates = new Map();         // VRAM word → Set of hex
function addCandidate(w, hex) {
  if (!candidates.has(w)) { candidates.set(w, new Set()); }
  candidates.get(w).add(hex);
}
for (const r of Object.values(tiles.spriteSets.records)) {
  const d = bytes(r.data);
  r.slots.forEach((b, i) => addCandidate(tiles.spriteSets.slotVram+16*b, d.subarray(128*i, 128*i+128).toString('hex')));
}
for (const name of ['title', 'launch']) {
  const o = tiles.obj[name], d = bytes(o.data);
  for (const w of candidates.keys()) {
    const off = (w-o.vram)*2;
    if (off >= 0 && off+0x240 <= d.length) {
      addCandidate(w, Buffer.concat([d.subarray(off, off+64), d.subarray(off+0x200, off+0x240)]).toString('hex'));
    }
  }
}
const shipTiles = new Set();
{
  const d = bytes(tiles.ship.data);
  for (let i = 0; i+32 <= d.length; i += 32) { shipTiles.add(d.subarray(i, i+32).toString('hex')); }
}
const launchTiles = new Set();
{
  const d = bytes(tiles.obj.launch.data);
  for (let i = 0; i+32 <= d.length; i += 32) { launchTiles.add(d.subarray(i, i+32).toString('hex')); }
}

function checkSlots(name, vram) {
  let n = 0, bad = 0;
  for (const [w, set] of candidates) {
    const g = Buffer.concat([vram.subarray(w*2, w*2+64), vram.subarray((w+0x100)*2, (w+0x100)*2+64)]);
    if (g.every((b) => b === 0)) { continue; }
    n++;
    if (!set.has(g.toString('hex'))) { bad++; if (verbose) { console.log(`    ${name}: slot at $${w.toString(16)} is no group a set puts there`); } }
  }
  checks += n; differences += bad;
  if (bad) { console.log(`    DIFF ${name} dynamic slots: ${bad} of ${n} groups unknown`); }
  return n;
}

function checkShip(name, vram, launch) {
  // in the launch the buffer holds tiles of the launch set (the ship in its dock), in a level tiles of the ship run
  let n = 0, bad = 0;
  for (let w = 0x6000; w < 0x6200; w += 16) {
    const t = vram.subarray(w*2, w*2+32);
    if (t.every((b) => b === 0)) { continue; }
    n++;
    const hex = t.toString('hex');
    if (!(shipTiles.has(hex) || (launch && launchTiles.has(hex)))) { bad++; }
  }
  checks += n; differences += bad;
  if (bad) { console.log(`    DIFF ${name} ship buffer: ${bad} of ${n} tiles not in the ship run`); }
  return n;
}

const dir = path.join(ROOT, 'build', 'm2', 'levels');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
let frames = 0;
for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const vram = bytes(rec.vram), wram = bytes(rec.wram);
  const spawn = (wram[0x1823] | (wram[0x1824] << 8)) | (rec.game.levelBank << 16);
  const section = levels.sections.findIndex((s) => s.bank === rec.game.levelBank && s.spawnList === spawn);
  if (section < 0 || rec.registers.inidisp !== 0x0F) { continue; }     // a fade or a blank: the memory is being replaced
  frames++;
  const before = differences;
  const bg = tiles.bg[String(levels.sections[section].tileSet)];
  compareRun(`${f} background set`, vram, bg.vram, bytes(bg.data));
  compareRun(`${f} font`, vram, tiles.font.vram, bytes(tiles.font.data));
  const launch = section === 14 || section === 15;
  if (launch) {
    // the launch set fills $6000-$7FFF at the first start; the common set replaces $6200-$6FFF when the level
    // starts and stays there through a restart of the launch — either is the original's
    const d = bytes(tiles.obj.launch.data).subarray(0x400, 0x2000), c = bytes(tiles.obj.common.data);
    let badL = 0, badC = 0;
    for (let i = 0; i < d.length; i++) { if (vram[0x6200*2+i] !== d[i]) { badL++; } if (vram[0x6200*2+i] !== c[i]) { badC++; } }
    checks += d.length; differences += Math.min(badL, badC);
    if (Math.min(badL, badC)) { console.log(`    DIFF ${f} $6200-$6FFF: ${badL} bytes off the launch set, ${badC} off the common set`); }
  } else {
    compareRun(`${f} common sprites`, vram, tiles.obj.common.vram, bytes(tiles.obj.common.data));
  }
  const slots = checkSlots(f, vram);
  const ship = checkShip(f, vram, launch);
  console.log(`  ${f.padEnd(22)} section ${String(section).padStart(2)}  ${slots} slots, ${ship} ship tiles  ${differences-before ? (differences-before)+' DIFFERENCES' : 'ok'}`);
}
// the title: data/screen_title.json and build/screens/attract_*.json
const titleFiles = [path.join(ROOT, 'data', 'screen_title.json')].concat(
  fs.existsSync(path.join(ROOT, 'build', 'screens')) ? fs.readdirSync(path.join(ROOT, 'build', 'screens')).filter((f) => f.startsWith('attract_')).map((f) => path.join(ROOT, 'build', 'screens', f)) : []);
for (const file of titleFiles) {
  if (!fs.existsSync(file)) { continue; }
  const scene = JSON.parse(fs.readFileSync(file, 'utf8'));
  const vram = bytes(scene.vram);
  const before = differences;
  compareRun(`${path.basename(file)} font`, vram, tiles.font.vram, bytes(tiles.font.data));
  // the title set: 16 KB at $6000, of which the ship buffer ($6000-$61FF) and the dynamic slots are rewritten
  const t = tiles.obj.title, d = bytes(t.data);
  compareRun(`${path.basename(file)} title sprites $6200-$6FFF`, vram, 0x6200, d.subarray(0x400, 0x2000));
  checkSlots(path.basename(file), vram);
  checkShip(path.basename(file), vram, true);
  frames++;
  console.log(`  ${path.basename(file).padEnd(22)} title  ${differences-before ? (differences-before)+' DIFFERENCES' : 'ok'}`);
}
console.log(`matchtiles.mjs: ${frames} frames, ${checks} checks, ${differences} differences`);
process.exit(differences ? 1 : 0);
