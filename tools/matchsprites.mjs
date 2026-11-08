#!/usr/bin/env node
/**
 * matchsprites — the OAM the original built from its objects, rebuilt from `data/sprites.json` by the game's code.
 *
 * `tools/tracesprites.py` logged, frame by frame, every object the
 * original handed to `draw_object_sprites` (X, Y, metasprite, attribute
 * word, slot table) in the order it drew them, and the OAM shadow it had
 * at the vertical blank. This tool feeds the same objects to the game's
 * own `app/objectSprites.js` (the classic worker script, through
 * `classicScript.cjs`) with the metasprite records of `sprites.json` and
 * the slot tables of the frame, and compares the **544 bytes** of OAM
 * byte for byte — every part's position, tile, palette, size and X sign,
 * the order of the entries, the hidden rest, the packed high table.
 *
 * The shadow at the vertical blank belongs to the pass that ended there;
 * when the frame's NMI was skipped (lag) the shadow is still the last
 * pass's and matches the log of the frame the same way — the NMI counter
 * only tells whether the PPU saw it.
 *
 *     tools/matchsprites.mjs                 # build/m2/sprites/*.json
 *     tools/matchsprites.mjs --only sec4 [--verbose]
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
const ObjectSprites = loadClassicScript(path.join(ROOT, 'app', 'objectSprites.js'));
const sprites = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sprites.json'), 'utf8'));

const SLOT_TABLES = 0x1CBC, SLOT_BYTES = 32;
const GROUP2 = 0x2AE0;

const dir = path.join(ROOT, 'build', 'm2', 'sprites');
let files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
if (opt('--only')) { files = files.filter((f) => f.startsWith(opt('--only')+'_')); }

let checks = 0, differences = 0, frames = 0, objects = 0, unknown = 0, lagged = 0;
for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (rec.game.frameFlags & 0x80) {
    // ★ bit 7 of `$4C` still up at the vertical blank: the pass is not over, the shadow is the last pass's and the
    // calls logged in this frame belong to the next — a lag frame (disasm_notes.md §2), left out
    lagged++;
    continue;
  }
  const shadow = Buffer.from(rec.oamShadow, 'base64');
  const tables = Buffer.from(rec.slotTables, 'base64');
  const drawer = new ObjectSprites(sprites);
  const group1 = [], group2 = [];
  // the order logged is the order drawn; group 2 backwards is already in that order, so the groups are replayed as
  // logged. A frame may hold the tail of one pass and the head of the next (a pass straddles frames): the drawing
  // that made the shadow at this vertical blank is the last run that started at OAM index $1FC
  // calls after the vertical blank of f (scanline 225 on) belong to the next pass and the next shadow
  const beforeBlank = rec.calls.filter((c) => c.frame === undefined || c.frame < rec.frame || c.line < 225);
  let from = 0;
  beforeBlank.forEach((c, i) => { if (c.oamIndex === 0x1FC) { from = i; } });
  let calls = beforeBlank.slice(from);
  // `$50` counts the pass at its start: a shadow of a later pass than the last call's was drawn with no objects
  if (calls.length && calls[calls.length-1].pass < rec.game.passes) { calls = []; }
  const objs = calls.map((c) => ({
    x: c.x, y: c.y, metasprite: 0x040000 | (c.metasprite & 0xFFFF), attr: c.attr,
    slots: c.slots ? tables.subarray(c.slots-SLOT_TABLES, c.slots-SLOT_TABLES+SLOT_BYTES) : null,
    group: c.object >= GROUP2 ? 2 : 1
  }));
  for (const o of objs) {
    if (!drawer.record(o.metasprite)) { unknown++; if (verbose) { console.log(`  ${f}: metasprite $${o.metasprite.toString(16)} not in sprites.json`); } }
  }
  // replay in the logged order (a frame with time over on an odd pass has group 2 reversed by the original itself)
  drawer.begin();
  if (objs.length === 0) {
    drawer.drawPass([], [], false, 0);
  } else {
    for (const o of objs) { drawer.drawObject(o); }
    drawer.hideUnused();
    drawer.pack();
  }
  // ★ `oam_hide_unused` writes only X and Y of the entries it hides; their tile bytes keep what an earlier
  // frame left — stale bytes of sprites that are off the picture, so they are not compared
  const firstUnused = objs.length ? 0 : 0x200, lastDrawn = drawer.index+4;
  let bad = 0, first = null;
  for (let i = 0; i < 544; i++) {
    if (i < 0x200 && i < lastDrawn && (i & 3) >= 2) { continue; }
    checks++;
    if (drawer.oam[i] !== shadow[i]) { bad++; if (first === null) { first = i; } }
  }
  differences += bad;
  frames++;
  objects += objs.length;
  const note = bad ? `${bad} DIFFERENCES (first byte ${first}: js $${drawer.oam[first].toString(16)} emu $${shadow[first].toString(16)})` : 'ok';
  console.log(`  ${f.padEnd(20)} ${String(objs.length).padStart(3)} objects, pass ${String(rec.game.passes).padStart(5)}, stat77 $${rec.game.stat77.toString(16).padStart(2, '0')}  ${note}`);
}
console.log(`matchsprites.mjs: ${frames} frames (${lagged} lag frames left out), ${objects} objects (${unknown} with a metasprite the dump lacks), ${checks} checks, ${differences} differences`);
process.exit(differences ? 1 : 0);
