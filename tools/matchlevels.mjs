#!/usr/bin/env node
/**
 * matchlevels — the map, scroll and palettes of every section against the running original.
 *
 * The acceptance tool of M2. `tools/tracelevels.py` recorded the original
 * at many frames of every section: VRAM, CGRAM, the layer objects
 * (`$1832`, `$1862`), the global scroll and the pass counter. This tool
 * runs the game's own `app/levelScroll.js` (the classic worker script the
 * browser runs, loaded through `classicScript.cjs`) over `data/levels.json`
 * and holds it against the records three ways:
 *
 * 1. **scene start → the frame**: the section is started as the original
 *    starts it (level record, scene 0, the ten first columns), the layers
 *    are put at the original's positions and the columns the original had
 *    crossed are drawn; every word of the map the routine wrote must equal
 *    the original's VRAM, the collision bytes its `$7E:3160`, the stream
 *    pointer and the last column its layer object, the scroll shadows its
 *    registers;
 * 2. **frame → frame**: from one record to the next of the same scene the
 *    model runs exactly the original's number of passes (`$50`), and the
 *    positions, the scroll, the columns and the map must come out as the
 *    original's — the speeds, the scripts and the clamps pass by pass;
 * 3. **the memory around**: the background tiles (`data/tiles.json`) at
 *    `$2000`, the font at `$5000`, and the palette rows 0-7 of the
 *    section's set (`data/palettes.json`) in CGRAM.
 *
 * A record whose queue was not empty at the vertical blank is still used
 * for 2 (the model drains before comparing, so does the original a frame
 * later) but noted.
 *
 *     tools/matchlevels.mjs                   # build/m2/levels/*.json
 *     tools/matchlevels.mjs --only sec0 [--verbose]
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const verbose = args.includes('--verbose');
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');
const LevelScroll = loadClassicScript(path.join(ROOT, 'app', 'levelScroll.js'));

const levels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'levels.json'), 'utf8'));
const tiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tiles.json'), 'utf8'));
const palettes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'palettes.json'), 'utf8'));

const STEP_NAMES = {0x8E96: null, 0x8EAE: 'wait', 0x8EF6: 'x', 0x8F54: 'y', 0x8FC8: 'xy'};
const FILL_KINDS = [2, 4, 6, 8, 0xC, 0x10];

const bytes = (b64) => Buffer.from(b64, 'base64');
const words = (buf, from, n) => { const out = new Uint16Array(n); for (let i = 0; i < n; i++) { out[i] = buf[from+2*i] | (buf[from+2*i+1] << 8); } return out; };

let checks = 0, differences = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) {
    differences++;
    if (verbose || differences <= 40) { console.log(`    DIFF ${name}: ${detail || ''}`); }
  }
}

/** the section of a record: the level bank, the spawn list and the scene table the original holds
    (sections 14 and 15 share the spawn list; the scene table tells them apart) */
function sectionOf(rec, wram) {
  const spawn = (wram[0x1823] | (wram[0x1824] << 8)) | (rec.game.levelBank << 16);
  const scenes = (wram[0x1829] | (wram[0x182A] << 8)) | (rec.game.levelBank << 16);
  return levels.sections.findIndex((s) => s.bank === rec.game.levelBank && s.spawnList === spawn && s.sceneTable === scenes);
}

/** puts the original's layer object into the model's layer */
function setLayer(model, l, o) {
  l.kind = o.kind;
  l.x = (o.x << 8) | o.xFrac;
  l.y = (o.y << 8) | o.yFrac;
  l.speedX = o.speedX;
  l.speedY = o.speedY;
  l.signX = (o.speedX & 0x8000) ? 0xFF : 0;
  l.signY = (o.speedY & 0x8000) ? 0xFF : 0;
  l.trigger = o.trigger;
  l.stop = o.stop;
  l.wraps = o.wraps;
  l.lastColumn = o.lastColumn;
  l.lastRow = o.lastRow;
  l.hscroll = o.hscroll;
  l.vscroll = o.vscroll;
  l.streamNext = o.stride ? Math.round(((o.streamNext-(l.stream & 0xFFFF)) & 0xFFFF)/o.stride) : 0;
  if ((o.kind & 0x1E) === 8) {
    // +$26 is the address of the next record, +$28 the running step
    const script = Object.values(model.section.scripts).find((s) => s.some((r) => (r.address & 0xFFFF) === o.script) || o.script === (s[s.length-1].address & 0xFFFF)+2);
    l.script = script || [];
    l.scriptIndex = script ? script.findIndex((r) => (r.address & 0xFFFF) === o.script) : 0;
    if (l.scriptIndex < 0) { l.scriptIndex = script.length; }
    l.scriptStep = STEP_NAMES[o.scriptStep] === undefined ? null : STEP_NAMES[o.scriptStep];
  }
}

/** the model after the scene start with the original's positions and the columns it crossed */
function fromSceneStart(section, rec) {
  const model = new LevelScroll(levels);
  // ★ a column past the stream may name the bank's WRAM mirror (`LevelScroll.metatile`): the WRAM of that moment is
  // not in these records, so the block is built from zeros and its words are counted apart (`mirrorRead`)
  model.readMirror = () => new Uint8Array(LevelScroll.METATILE_SIZE);
  model.start(section);
  // the fill tasks: one column a pass, BG2 after BG1, a vertical blank after each pass — long done at these frames
  while (model.fillTasks.length) {
    model.fillStep(model.fillTasks[0]);
    if (model.fillTasks[0].columns <= 0) { model.fillTasks.shift(); }
    model.vblank();
  }
  model.scroll = rec.game.scroll;
  model.scrollFrac = rec.game.scrollFrac;
  for (let i = 0; i < 2; i++) {
    const l = model.layers[i], o = rec.layers[i];
    const drawn = l.lastColumn, next = l.streamNext;
    setLayer(model, l, o);
    l.lastColumn = drawn;
    l.streamNext = next;
    if (FILL_KINDS.includes(o.kind & 0x1E) || (o.kind & 0x1E) === 0xA || ((o.kind & 0x1E) === 0 && o.lastColumn > drawn)) {
      for (let c = drawn+1; c <= o.lastColumn; c++) {
        l.lastColumn = c;
        model.enqueueColumn(l, LevelScroll.blockAddress(c+LevelScroll.LOOKAHEAD, 0));
        model.drain();
      }
    }
  }
  model.drain();
  return model;
}

let dropped = 0, objectWritten = 0, switchedOff = 0, mirrorRead = 0;
/** every 16-word expansion (four flips) of a section's metatiles, by section — what the object code can draw */
const expansions = new Map();
function expansionsOf(section) {
  if (expansions.has(section)) { return expansions.get(section); }
  const set = new Set();
  for (const m of Object.values(levels.sections[section].metatiles)) {
    for (let flip = 0; flip < 4; flip++) {
      const w = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const src = (flip & 2 ? 3-r : r)*4+(flip & 1 ? 3-c : c);
          w.push(m.tiles[src] ^ ((flip & 1) ? 0x4000 : 0) ^ ((flip & 2) ? 0x8000 : 0));
        }
      }
      set.add(w.join(','));
    }
  }
  expansions.set(section, set);
  return set;
}
/** the 16 words of the block that holds map word `a`, as the picture has them */
function blockOf(map, a) {
  const base = (a & 0x1000) | (a & 0x0C00) | (a & 0x0380) | (a & 0x1C);
  const w = [];
  for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) { w.push(map[(base+r*32+c) & 0x1FFF]); } }
  return w;
}
/** per scenario: VRAM words the original rewrote outside the scroll (map_enqueue_b/c from the object code — M5) */
const rewritten = new Map();
function compareState(name, model, rec, touched, regs) {
  const vram = bytes(rec.vram), wram = bytes(rec.wram);
  const map = words(vram, 0, 0x2000);
  let n = 0, bad = 0, firstBad = null, drop = 0;
  const objectWords = new Set();      // what the loop below lays to the object code — their collision bytes are theirs too
  const mirrorWords = new Set();      // the blocks built from the WRAM mirror (unknowable here — the kernel of M4 has the WRAM)
  for (const v of model.mirrorBlocks) {
    for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) { mirrorWords.add((v+r*32+c) & 0x1FFF); } }
  }
  for (let a = 0; a < 0x2000; a++) {
    if (!touched[a]) { continue; }
    if (mirrorWords.has(a)) { mirrorRead++; continue; }
    if (map[a] === 0 && model.vram[a] !== 0) {
      // ★ a block the original never drew: `map_enqueue_a` drops blocks when the queue holds 64, which happens when
      // lag frames (no NMI, no draining) pile up — the lag model is M3; counted apart, not as a difference
      drop++;
      continue;
    }
    if (rewritten.get(rec.scenario) && rewritten.get(rec.scenario).has(a)) {
      // ★ a word the object code rewrote (`map_enqueue_b` / `map_enqueue_c`, bank $02 — section 6 at frame 5446
      // of its survey): the objects are M5; counted apart
      objectWritten++;
      objectWords.add(a);
      continue;
    }
    if (map[a] !== model.vram[a] && model.section && expansionsOf(model.section.section).has(blockOf(map, a).join(','))
        && !expansionsOf(model.section.section).has(blockOf(map, a).map((w, i) => model.vram[(((a & 0x1000) | (a & 0x0C00) | (a & 0x0380) | (a & 0x1C))+(i >> 2)*32+(i & 3)) & 0x1FFF]).join(',')) === false) {
      // the block the picture holds is a whole metatile of the section, only not the one the stream names here:
      // drawn by the object code before the first record of the scene (a boss area's door) — counted apart
      objectWritten++;
      objectWords.add(a);
      continue;
    }
    if (map[a] !== model.vram[a] && rec.game.objectMapWrites > 0) {
      // ★ the object code's map writes ran since the section load (map_enqueue_b/c counted by tracelevels.py):
      // a block that is not the stream's is theirs — M5
      objectWritten++;
      objectWords.add(a);
      continue;
    }
    if (map[a] !== model.vram[a]) {
      // the scroll routine writes whole 4×4 blocks; a block of which only some words differ while the others hold
      // the stream's tiles was patched by the object code after the column was drawn (a wall that opens) — M5
      const base = (a & 0x1000) | (a & 0x0C00) | (a & 0x0380) | (a & 0x1C);
      let same = 0;
      for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) { const i = (base+r*32+c) & 0x1FFF; if (map[i] === model.vram[i] && map[i] !== 0) { same++; } } }
      if (same > 0) { objectWritten++; objectWords.add(a); continue; }
    }
    n++;
    if (map[a] !== model.vram[a]) {
      bad++;
      if (!firstBad) { firstBad = `word $${a.toString(16)}: emu $${map[a].toString(16)} js $${model.vram[a].toString(16)}`; }
      if (verbose && bad <= 40) { console.log(`      $${a.toString(16)} emu $${map[a].toString(16)} js $${model.vram[a].toString(16)}`); }
    }
  }
  checks += n; differences += bad; dropped += drop;
  if (bad) { console.log(`    DIFF ${name} map: ${bad} of ${n} words, first ${firstBad}`); }
  if (drop && verbose) { console.log(`    note ${name}: ${drop} words of blocks the original's full queue dropped`); }
  let cn = 0, cbad = 0;
  for (let a = 0; a < 0x2000; a++) {
    if (!touched[a]) { continue; }
    if (map[a] === 0 && model.vram[a] !== 0) { continue; }                                      // dropped (above)
    if ((rewritten.get(rec.scenario) && rewritten.get(rec.scenario).has(a)) || objectWords.has(a)) { continue; }   // the object code's
    if (mirrorWords.has(a)) { continue; }                                                        // the WRAM mirror's (above)
    if (rec.game.objectMapWrites > 0 && wram[0x3160+a] !== model.collision[a]) { objectWritten++; continue; }
    cn++;
    if (wram[0x3160+a] !== model.collision[a]) { cbad++; }
  }
  checks += cn; differences += cbad;
  if (cbad) { console.log(`    DIFF ${name} collision: ${cbad} of ${cn} bytes`); }
  for (let i = 0; i < 2; i++) {
    const l = model.layers[i], o = rec.layers[i];
    if ((o.kind & 0x1E) === 0 && (levels.sections[model.section.section].scenes[0].layers[i].kind & 0x1E) !== 0) {
      // ★ the boss code switched the layer off (kind 0) at a moment of its own — when, is M5; its fields are not held
      switchedOff++;
      continue;
    }
    check(`${name} BG${i+1} x`, ((l.x >> 8) & 0xFFFF) === o.x && (l.x & 0xFF) === o.xFrac, `js ${(l.x >> 8) & 0xFFFF}.${l.x & 0xFF} emu ${o.x}.${o.xFrac}`);
    check(`${name} BG${i+1} y`, ((l.y >> 8) & 0xFFFF) === o.y && (l.y & 0xFF) === o.yFrac, `js ${(l.y >> 8) & 0xFFFF}.${l.y & 0xFF} emu ${o.y}.${o.yFrac}`);
    check(`${name} BG${i+1} kind`, l.kind === o.kind, `js ${l.kind} emu ${o.kind}`);
    check(`${name} BG${i+1} lastColumn`, l.lastColumn === o.lastColumn, `js ${l.lastColumn} emu ${o.lastColumn}`);
    check(`${name} BG${i+1} streamNext`, ((l.stream+l.streamNext*l.stride) & 0xFFFF) === o.streamNext, `js $${((l.stream+l.streamNext*l.stride) & 0xFFFF).toString(16)} emu $${o.streamNext.toString(16)}`);
    check(`${name} BG${i+1} hscroll`, l.hscroll === o.hscroll, `js ${l.hscroll} emu ${o.hscroll}`);
    check(`${name} BG${i+1} vscroll`, l.vscroll === o.vscroll, `js ${l.vscroll} emu ${o.vscroll}`);
    if (regs && !rec.registersAtVblank) {
      // the registers at scanline 0 are what the NMI before the last pass wrote: the shadows one pass earlier
      check(`${name} BG${i+1} register H`, regs.hofs[i] === rec.registers.hofs[i], `js ${regs.hofs[i]} emu ${rec.registers.hofs[i]}`);
      check(`${name} BG${i+1} register V`, regs.vofs[i] === rec.registers.vofs[i], `js ${regs.vofs[i]} emu ${rec.registers.vofs[i]}`);
    }
  }
  check(`${name} scroll`, model.scroll === rec.game.scroll && model.scrollFrac === rec.game.scrollFrac, `js ${model.scroll}.${model.scrollFrac} emu ${rec.game.scroll}.${rec.game.scrollFrac}`);
  return n;
}

const animated = new Map();           // section → Set of row*16+colour that change between the section's records
function findAnimated(recsBySection) {
  for (const [section, recs] of recsBySection) {
    const set = new Set();
    const first = bytes(recs[0].cgram);
    for (const r of recs.slice(1)) {
      const cg = bytes(r.cgram);
      for (let i = 0; i < 128; i++) {
        if (cg[2*i] !== first[2*i] || cg[2*i+1] !== first[2*i+1]) { set.add(i); }
      }
    }
    animated.set(section, set);
  }
}

function compareMemory(name, section, rec) {
  const vram = bytes(rec.vram), cgram = bytes(rec.cgram);
  const sec = levels.sections[section];
  const bg = tiles.bg[String(sec.tileSet)];
  const data = bytes(bg.data);           // only the bytes inside the bank — past it the DMA read WRAM (dumptiles.py)
  let bad = 0;
  for (let i = 0; i < data.length; i++) { if (vram[bg.vram*2+i] !== data[i]) { bad++; } }
  checks += data.length; differences += bad;
  if (bad) { console.log(`    DIFF ${name} background tiles: ${bad} of ${data.length} bytes`); }
  const font = bytes(tiles.font.data);
  bad = 0;
  for (let i = 0; i < font.length; i++) { if (vram[tiles.font.vram*2+i] !== font[i]) { bad++; } }
  checks += font.length; differences += bad;
  if (bad) { console.log(`    DIFF ${name} font: ${bad} of ${font.length} bytes`); }
  const set = palettes.sets[section].bg;
  const anim = animated.get(section) || new Set();
  for (let row = 0; row < 8; row++) {
    if (set[row] === null) { continue; }
    const pal = palettes.palettes[String(set[row])];
    for (let c = 0; c < 16; c++) {
      if (anim.has(row*16+c)) { continue; }   // ★ a colour the game animates (S_00A1C9) — not the set's data
      const v = cgram[row*32+2*c] | (cgram[row*32+2*c+1] << 8);
      check(`${name} CGRAM row ${row} colour ${c}`, v === pal[c], `emu $${v.toString(16)} js $${pal[c].toString(16)}`);
    }
  }
}

// ------------------------------------------------------------------- main

const dir = path.join(ROOT, 'build', 'm2', 'levels');
let files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
if (opt('--only')) { files = files.filter((f) => f.startsWith(opt('--only')+'_')); }
const byScenario = new Map();
for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  rec.file = f;
  if (!byScenario.has(rec.scenario)) { byScenario.set(rec.scenario, []); }
  byScenario.get(rec.scenario).push(rec);
}
let frames = 0, skipped = 0, pairs = 0, frozenPairs = 0, heldPasses = 0;
const sectionsSeen = new Set();
{
  const bySection = new Map();
  for (const recs of byScenario.values()) {
    for (const rec of recs) {
      const s = sectionOf(rec, bytes(rec.wram));
      if (s >= 0 && rec.registers.inidisp === 0x0F) { if (!bySection.has(s)) { bySection.set(s, []); } bySection.get(s).push(rec); }
    }
  }
  findAnimated(bySection);
}
for (const [scenario, recs] of byScenario) {
  recs.sort((a, b) => a.frame-b.frame);
  let prev = null;
  for (const rec of recs) {
    const wram = bytes(rec.wram);
    const section = sectionOf(rec, wram);
    const kinds = rec.layers.slice(0, 2).map((l) => l.kind & 0x1E);
    // the record must be in scene 0 of its section (a kind the scene set, or one it moves to on its own)
    const sceneKinds = section >= 0 ? levels.sections[section].scenes[0].layers.map((l) => l.kind & 0x1E) : [];
    // (kind 0 is allowed where the boss code switches a layer off — the odd sections; the launch has no such code)
    const follows = (k, s) => k === s || (s === 6 && k === 8) || (s === 0x10 && k === 0xE) || (s === 0xE && k === 0x10) || (k === 0 && (section & 1) === 1);
    // a fade or a blank (INIDISP ≠ $0F) is a transition: the memory is being replaced, not a picture of the level
    // section 15 in a play is the second half of the launch, whose own code places the layers (the ship leaving the
    // mother ship — M3); only the `sec15` survey, where 15 is started as a level, shows the generic start of its data
    const launchByCode = section === 15 && rec.scenario !== 'sec15';
    const usable = section >= 0 && kinds.every((k, i) => follows(k, sceneKinds[i])) && rec.layers[0].stride > 0
                   && rec.registers.inidisp === 0x0F && !launchByCode;
    if (!usable) {
      skipped++;
      if (verbose) { console.log(`  ${rec.file}: skipped (section ${section}, kinds ${kinds})`); }
      prev = null;
      continue;
    }
    frames++;
    sectionsSeen.add(section);
    const before = differences;
    // 1. scene start → the frame
    const model = fromSceneStart(section, rec);
    const touched = new Uint8Array(0x2000);
    markTouched(model, touched);
    noteRewritten(section, rec, prev, model, touched);
    const n1 = compareState(`${rec.file} start→frame`, model, rec, touched, null);
    if (opt('--word')) { const a = parseInt(opt('--word'), 16); console.log(`    word $${a.toString(16)}: start path js $${model.vram[a].toString(16)} touched ${touched[a]} emu $${(bytes(rec.vram)[2*a] | (bytes(rec.vram)[2*a+1] << 8)).toString(16)}`); }
    // 3. the memory around
    compareMemory(rec.file, section, rec);
    // 2. frame → frame
    let n2 = 0;
    // (a record at scroll 0 may still be in the start-up states of the game task, before the scroll runs; a scroll
    // that stood through many passes was held by a state of the game task — the respawn after a lost life — M3)
    // the scroll `$1830` moves by `scrollSpeed` every pass the game task is in its play state (S_008D6F from
    // L_0184F4); passes it stood still in (the respawn after a lost life) are the game's states — M3
    let frozen = false;
    if (prev && prev.section === section && rec.game.scroll < rec.game.scrollEnd && rec.game.scrollSpeed) {
      const moved = ((rec.game.scroll << 8) | rec.game.scrollFrac)-((prev.rec.game.scroll << 8) | prev.rec.game.scrollFrac);
      const held = (rec.game.passes-prev.rec.game.passes)-Math.round(moved/rec.game.scrollSpeed);
      if (moved >= 0 && held > 0) { frozen = true; frozenPairs++; heldPasses += held; }
    }
    if (prev && prev.section === section && rec.game.passes > prev.rec.game.passes && prev.rec.game.queue === 0
        && prev.rec.game.scroll > 0 && !frozen && samePlay(prev.rec, rec)) {
      const m2 = fromSceneStart(section, prev.rec);
      const passes = rec.game.passes-prev.rec.game.passes;
      let regs = null;
      for (let p = 0; p < passes; p++) {
        if (p === passes-1) { regs = m2.registers(); }
        m2.pass(); m2.vblank();
      }
      m2.drain();
      const t2 = new Uint8Array(0x2000);
      markTouched(m2, t2);
      n2 = compareState(`${rec.file} ${prev.rec.frame}→${rec.frame} (${passes} passes)`, m2, rec, t2, regs);
      if (opt('--word')) { const a = parseInt(opt('--word'), 16); console.log(`    word $${a.toString(16)}: pair path js $${m2.vram[a].toString(16)} touched ${t2[a]}`); }
      pairs++;
    }
    console.log(`  ${rec.file.padEnd(22)} section ${String(section).padStart(2)} scroll ${String(rec.game.scroll).padStart(5)} kinds ${kinds.join('/')}`
                +` queue ${rec.game.queue}  map words ${n1}${n2 ? ' / '+n2 : ''}  ${differences-before ? (differences-before)+' DIFFERENCES' : 'ok'}`);
    prev = {section, rec};
  }
}

/** words the original changed since the last record of this play without a scroll column over them */
function noteRewritten(section, rec, prev, model, touched) {
    if (prev && prev.section === section && samePlay(prev.rec, rec)) {
      const now = words(bytes(rec.vram), 0, 0x2000), was = words(bytes(prev.rec.vram), 0, 0x2000);
      const covered = new Uint8Array(0x2000);
      for (let i = 0; i < 2; i++) {
        const l = model.layers[i];
        for (let c = prev.rec.layers[i].lastColumn+1; c <= rec.layers[i].lastColumn; c++) {
          let addr = LevelScroll.blockAddress(c+LevelScroll.LOOKAHEAD, 0);
          for (let b = 0; b < l.blocks; b++) {
            for (let r = 0; r < 4; r++) { for (let x = 0; x < 4; x++) { covered[(addr+l.mapBase+r*32+x) & 0x1FFF] = 1; } }
            addr = LevelScroll.blockBelow(addr);
          }
        }
      }
      if (!rewritten.has(rec.scenario)) { rewritten.set(rec.scenario, new Set()); }
      const cNow = bytes(rec.wram), cWas = bytes(prev.rec.wram);
      for (let a = 0; a < 0x2000; a++) {
        if ((now[a] !== was[a] || cNow[0x3160+a] !== cWas[0x3160+a]) && !covered[a] && touched[a]) { rewritten.get(rec.scenario).add(a); }
      }
    } else if (!prev || prev.section !== section) {
      rewritten.set(rec.scenario, new Set());
    }
}

function markTouched(model, touched) {
  // every word a drawn column covers: the model's writes since the start
  for (const l of model.layers) {
    for (let c = 0; c < l.streamNext && c < l.columns.length; c++) {
      let addr = LevelScroll.blockAddress(c, 0);
      for (let b = 0; b < l.blocks; b++) {
        for (let r = 0; r < 4; r++) { for (let x = 0; x < 4; x++) { touched[(addr+l.mapBase+r*32+x) & 0x1FFF] = 1; } }
        addr = LevelScroll.blockBelow(addr);
      }
    }
  }
}

/** the same scene went on between the two records: no restart (the stream pointer never goes back), no death
    (a lost life stops the scroll for the explosion and the respawn — the game's states, M3) */
function samePlay(a, b) {
  return b.layers[0].streamNext >= a.layers[0].streamNext && b.layers[1].streamNext >= a.layers[1].streamNext
         && b.game.scroll >= a.game.scroll && b.game.lives === a.game.lives
         && (b.layers[0].kind === a.layers[0].kind || (a.layers[0].kind & 0x1E) === 6);
}

console.log(`matchlevels.mjs: ${frames} frames of ${sectionsSeen.size} sections (${[...sectionsSeen].sort((a, b) => a-b).join(', ')}), ${pairs} frame pairs (${frozenPairs} more with the scroll held by the game for ${heldPasses} passes — M3), ${skipped} skipped, ${checks} checks, ${differences} differences`
            +` (${dropped} map words of blocks the original's full queue dropped — the lag model of M3; `
            +`${[...animated.values()].reduce((n, s) => n+s.size, 0)} animated colours left to M4-M5; `
            +`${objectWritten} words the object code rewrote, map_enqueue_b/c — M5; ${switchedOff} layer records switched off by the boss code — M5; ${mirrorRead} words of blocks a garbage word past the stream built from the WRAM mirror — the kernel's, M4)`);
process.exit(differences ? 1 : 0);
