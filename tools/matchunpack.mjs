#!/usr/bin/env node
/**
 * matchunpack — every block the original moves from the cartridge into VRAM, against the ROM and `data/tiles.json`.
 *
 * `MILNIKY.md` M2 expected an unpacking routine. ★ There is none: the
 * original's graphics are not compressed — every DMA into VRAM reads the
 * ROM as it is (`sources/docs/disasm_notes.md` §8), and the maps are not
 * stored at all but built from metatile references (`matchlevels.mjs`).
 * This tool proves the first half: over the DMA catalogue the surveys
 * recorded (`build/m2/collect/*.json`, hook `watch_dma` of `snesemu.py`
 * — the title, the demo, a play, every section), every transfer from the
 * ROM into VRAM (`$2118`) is listed with its source, size and target, and
 * its bytes are read from the cartridge **by the same rule the DMA unit
 * uses** — the A-bus address wraps within the bank, and below `$8000` a
 * LoROM bank mirrors WRAM, which seven background sets run into — and
 * held against the run `data/tiles.json` keeps for that source: byte for
 * byte, as the unpacking would be if there were one.
 *
 *     tools/matchunpack.mjs [--verbose]
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const verbose = process.argv.includes('--verbose');
const rom = fs.readFileSync(path.join(ROOT, 'sources', 'cart', 'Super R-Type (USA).sfc'));
const tiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tiles.json'), 'utf8'));
const bytes = (b64) => Buffer.from(b64, 'base64');

/** the runs of tiles.json by their source address */
const runs = new Map();
for (const bg of Object.values(tiles.bg)) { runs.set(bg.address, {name: 'background set', vram: bg.vram, data: bytes(bg.data)}); }
runs.set(tiles.font.address, {name: 'font', vram: tiles.font.vram, data: bytes(tiles.font.data)});
for (const [name, o] of Object.entries(tiles.obj)) { runs.set(o.address, {name: name+' sprites', vram: o.vram, data: bytes(o.data)}); }

/** a ROM byte as the DMA unit reads it at a 24-bit A-bus address: null for a WRAM mirror */
function romByte(addr) {
  const bank = (addr >> 16) & 0x7F, a = addr & 0xFFFF;
  if (a < 0x8000 || bank > 0x3F) { return null; }
  return rom[(bank << 15) | (a & 0x7FFF)];
}

const dir = path.join(ROOT, 'build', 'm2', 'collect');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
const transfers = new Map();      // src:size:vram → count
for (const f of files) {
  for (const d of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).dmas) {
    if (d.dst !== 0x2118 || (d.src >> 16) >= 0x7E || (d.src & 0xFFFF) < 0x8000) { continue; }   // WRAM (the panel row $00:18CC) is not the cartridge
    const key = `${d.src}:${d.size}:${d.vaddr}`;
    transfers.set(key, (transfers.get(key) || 0)+1);
  }
}
let checks = 0, differences = 0, unknown = 0, mirrored = 0;
for (const [key, count] of [...transfers].sort()) {
  const [src, size, vaddr] = key.split(':').map(Number);
  const run = runs.get(src);
  if (!run) {
    unknown++;
    console.log(`  DIFF transfer $${src.toString(16)} (${size} B → VRAM $${vaddr.toString(16)}) has no run in tiles.json`);
    differences += size;
    continue;
  }
  let bad = 0, inBank = 0;
  for (let i = 0; i < size; i++) {
    const a = (src & 0xFF0000) | ((src+i) & 0xFFFF);      // the DMA's A-bus address wraps within the bank
    const b = romByte(a);
    if (b === null) { mirrored++; continue; }              // below $8000: the WRAM mirror — not data, not dumped
    inBank++;
    checks++;
    if (i >= run.data.length || run.data[i] !== b) { bad++; }
  }
  differences += bad;
  check(run.vram === vaddr, `${run.name} $${src.toString(16)} lands at VRAM $${vaddr.toString(16)}, tiles.json says $${run.vram.toString(16)}`);
  console.log(`  $${src.toString(16).padStart(6, '0')} ${String(size).padStart(5)} B → VRAM $${vaddr.toString(16)}  ${run.name.padEnd(16)} ×${String(count).padStart(3)}  ${inBank} B in the bank${size-inBank ? ', '+(size-inBank)+' B past it (WRAM mirror)' : ''}  ${bad ? bad+' DIFFERENCES' : 'ok'}`);
}
function check(ok, text) { checks++; if (!ok) { differences++; console.log('  DIFF '+text); } }
console.log(`matchunpack.mjs: ${transfers.size} distinct ROM→VRAM transfers in ${files.length} surveys, ${mirrored} bytes read past a bank (WRAM mirror), ${checks} checks, ${differences} differences`);
process.exit(differences ? 1 : 0);
