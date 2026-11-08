#!/usr/bin/env node
/**
 * matchenemies — the enemies, the bosses, the ship and its weapons moved by the remake, against the running original.
 *
 * The acceptance tool of M4: `tools/matchship.mjs` over the recordings of
 * `tools/traceenemies.py` (`build/m4/enemies/<name>/`, the enemies on). For
 * every recording it takes the lower 12.5 KB of WRAM at the frame the
 * section's loader task was spawned, puts it into the game's own code —
 * `app/gameKernel.js`, `app/ship.js`, `app/force.js`, `app/weapons.js`,
 * `app/lasers.js` and the enemies' `app/enemies.js`, `app/enemiesLevel.js`,
 * `app/bosses.js`, the classic scripts the worker runs — and runs frame
 * after frame: a regular frame is the NMI (the joypad of that frame, the
 * map queue, the sprite groups, the NMI job) and the pass of the main
 * loop; a lag frame is skipped as the original skips it (the lag model
 * `app/frameBudget.js` runs beside and is counted against the recording).
 * Before every regular frame the RAM is compared byte for byte:
 *
 * - the direct page (the game's counters, the groups, the flags),
 * - the task pool `$0180`-`$157F` and the roots `$1580`-`$1800`, every
 *   node's every byte — **every enemy, shot, explosion and boss part**,
 *   the enemy list `$168B` the missiles aim at,
 * - the NMI job queue, the panel line, the palette animation table and
 *   slots, the hit box list, the sprite set slots, the sound queue,
 * - the OAM shadow and the high table, the ship's tile buffer, the sprite
 *   groups, the CGRAM shadow.
 *
 * The layers (`$1832`-`$18C1`) are `app/levelScroll.js`'s and are compared
 * through its fields; the scratch of the routines (`$00`-`$17`,
 * `$E0`-`$F3`) is not compared. The comparison ends at the game over
 * (the third death — M5).
 *
 *     tools/matchenemies.mjs                    # all recordings in build/m4/enemies/
 *     tools/matchenemies.mjs --only l1a --verbose --stop
 */
import '../app/svision/tools/nodeEnv.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');
// (the classic scripts publish themselves on `self` in the worker; under Node the globals are set here)
globalThis.LevelScroll = loadClassicScript(path.join(ROOT, 'app', 'levelScroll.js'));
globalThis.ObjectSprites = loadClassicScript(path.join(ROOT, 'app', 'objectSprites.js'));
loadClassicScript(path.join(ROOT, 'app', 'gameKernel.js'));
globalThis.installForceCode = loadClassicScript(path.join(ROOT, 'app', 'force.js'));
if (existsSync(path.join(ROOT, 'app', 'weapons.js'))) {
  globalThis.installWeaponsCode = loadClassicScript(path.join(ROOT, 'app', 'weapons.js'));
}
if (existsSync(path.join(ROOT, 'app', 'lasers.js'))) {
  globalThis.installLaserCode = loadClassicScript(path.join(ROOT, 'app', 'lasers.js'));
}
for (const [file, name] of [['enemies.js', 'installEnemyCode'], ['enemies2.js', 'installEnemyCode2'], ['enemies3.js', 'installEnemyCode3'], ['enemies4.js', 'installEnemyCode4'],
                            ['enemiesLevel.js', 'installLevelEnemyCode'], ['enemiesLevel2.js', 'installLevelEnemyCode2'], ['enemiesLevel3.js', 'installLevelEnemyCode3'],
                            ['bosses.js', 'installBossCode'], ['bosses2.js', 'installBossCode2'], ['bosses3.js', 'installBossCode3']]) {
  if (existsSync(path.join(ROOT, 'app', file))) {
    globalThis[name] = loadClassicScript(path.join(ROOT, 'app', file));
  }
}
const Ship = loadClassicScript(path.join(ROOT, 'app', 'ship.js'));
const FrameBudget = loadClassicScript(path.join(ROOT, 'app', 'frameBudget.js'));

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const verbose = args.includes('--verbose');
const stopAtFirst = args.includes('--stop');
const only = opt('--only');
const dir = opt('--dir', path.join(ROOT, 'build', 'm4', 'enemies'));
const maxReport = +opt('--report', 20);
const maxFrames = +opt('--frames', 1e9);
/** `--watch from-to`: the map queue's words and the layers' columns of both sides, every frame of the range */
const watch = (opt('--watch', '') || '').split('-').map(Number);

const data = {};
for (const name of ['ship', 'levels', 'sprites', 'tiles', 'palettes', 'waves']) {
  data[name] = JSON.parse(readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
}

/** the regions compared: [from, to, name] */
const REGIONS = [
  [0x18, 0x1C, 'dp current/previous node'], [0x20, 0x2E, 'dp pool/jobs'], [0x2E, 0x34, 'dp map queue'],
  [0x3E, 0x40, 'dp hit list end'], [0x46, 0x48, 'dp default layer'], [0x4A, 0x4C, 'dp game flags'], [0x4C, 0x4E, 'dp frame flags'],
  [0x50, 0x52, 'dp pass counter'], [0x58, 0x60, 'dp charge/sound'], [0x60, 0x62, 'dp joypad raw'], [0x64, 0x66, 'dp joypad frame'],
  [0x68, 0x6C, 'dp group upload'], [0x6C, 0x7A, 'dp sprite groups'], [0x7A, 0x80, 'dp tilt/oam'], [0x80, 0x84, 'dp inidisp'],
  [0x84, 0x9C, 'dp level/difficulty'], [0xF4, 0xF6, 'dp stat77'],
  [0x0180, 0x1580, 'task pool'], [0x1580, 0x1801, 'root tasks'], [0x1801, 0x1811, 'nmi job'],
  [0x1821, 0x1832, 'level record'], [0x18CC, 0x1902, 'panel line'], [0x1902, 0x1982, 'palette anim table'],
  [0x1982, 0x1992, 'palette slots'], [0x1992, 0x1C92, 'hit box list'], [0x1CA7, 0x1CA9, 'spc sequence'],
  [0x1CAC, 0x1DBC, 'sprite set slots'], [0x1F00, 0x2000, 'sound queue'], [0x2000, 0x2200, 'nmi job ring'],
  [0x2200, 0x24A0, 'oam shadow'], [0x24A0, 0x28A0, 'ship tile buffer'], [0x28A0, 0x2F60, 'sprite groups'],
  [0x2F60, 0x3160, 'cgram shadow']
];
/** ★ bytes left out: $1A/$1C of the dp hold the previous node, which the original's loop keeps one pass longer; the panel's $18DE/$18F0 and $18E0-$18EF follow the beam in the pass (S_018855) */
const SKIP = new Set([0x1A, 0x1B]);

const bytes = (b64) => Buffer.from(b64, 'base64');
let checks = 0, diffs = 0, lagTotal = 0, lagBad = 0, framesTotal = 0, lagSkipped = 0;

class Recording {
  constructor(where) {
    this.where = where;
    this.meta = JSON.parse(readFileSync(path.join(where, 'meta.json'), 'utf8'));
    const idx = JSON.parse(readFileSync(path.join(where, 'index.json'), 'utf8'));
    this.index = idx.index;
    this.joypad = idx.joypad;
    this.timing = idx.timing;
    this.blob = inflateSync(readFileSync(path.join(where, 'frames.bin.zz')));
    this.size = this.meta.wramBytes;
    this.first = this.meta.first;
  }
  /** the WRAM of frame f */
  wram(f) {
    const i = f-this.first;
    return this.blob.subarray(i*this.size, (i+1)*this.size);
  }
  lag(f) { return this.index[f-this.first].lag; }
}

const W = (w, a) => w[a] | (w[a+1] << 8);

/** the frame the section's loader was spawned: $1580 in $81D7, the child in $832D, the section the recording's */
function loaderFrame(rec) {
  for (let f = rec.first; f <= rec.meta.frames; f++) {
    if (rec.lag(f)) continue;
    const w = rec.wram(f);
    if (W(w, 0x1583) === 0x81D7 && (w[0x16E5] & 0xF) === rec.meta.section) {
      const child = W(w, 0x1580);
      if (W(w, child+3) === 0x832D && w[child+5] === 1) return f;
    }
  }
  return -1;
}

function matchRecording(name) {
  const where = path.join(dir, name);
  if (!existsSync(path.join(where, 'meta.json'))) { console.log(`${name}: no recording`); return; }
  const rec = new Recording(where);
  const f0 = loaderFrame(rec);
  if (f0 < 0) { console.log(`${name}: the loader's frame not found`); diffs++; return; }
  const ship = new Ship(data);
  ship.noEnemies = false;
  ship.reset();
  ship.ram.set(rec.wram(f0), 0);
  layersFromRam(ship, rec.wram(f0));
  // ★ the lag model runs beside the replay: the recording's flags drive the match, the model's are counted against them
  ship.budget = new FrameBudget();
  let lagChecks = 0, lagMismatches = 0, firstLagBad = null;
  // the original's $1A/$1C are left from the last pass
  const before = checks, beforeDiffs = diffs;
  let reported = 0, compared = 0, lagFrames = 0, firstBad = null, gameOver = null;
  const report = (f, what, detail) => {
    diffs++;
    if (reported < maxReport || verbose) { console.log(`    f${f} ${what}: ${detail}`); reported++; }
  };
  const last = Math.min(rec.meta.frames, f0+maxFrames);
  let f = f0;
  try {
    for (; f <= last; f++) {
      if (f > f0) {
        const predicted = ship.budget.nmiIsLag(f);
        lagChecks++;
        if (predicted !== rec.lag(f)) { lagMismatches++; if (firstLagBad === null) firstLagBad = f; if (verbose) console.log(`    f${f} lag: model ${predicted} recorded ${rec.lag(f)}`); }
        if (rec.lag(f)) { ship.budget.passEnd = Math.max(ship.budget.passEnd, (f+1)*FrameBudget.FRAME+FrameBudget.NMI_CLOCK-1); }
        else { ship.budget.passEnd = -1; }
      }
      if (watch.length === 2 && f >= watch[0] && f <= watch[1]) {
        const ww = rec.wram(f);
        const q = (r) => `$2E=${W(r, 0x2E)} $30=${W(r, 0x30).toString(16)} $32=${W(r, 0x32).toString(16)}`;
        console.log(`    f${f} ${rec.lag(f) ? 'LAG ' : ''}got ${q(ship.ram)} col ${ship.level.layers[0].lastColumn}/${ship.level.layers[1].lastColumn} queue ${ship.level.queue.length}`
                    + ` | want ${q(ww)} col ${W(ww, 0x1848)}/${W(ww, 0x1878)}`);
      }
      if (rec.lag(f)) { lagFrames++; continue; }
      const w = rec.wram(f);
      // ★ the game over (the third death): the manager spawned the transition of bank $03 at $80B1 — M5
      if (isGameOver(w)) { gameOver = f; break; }
      // the comparison (not at f0: that is the image itself)
      if (f > f0) {
        const bad0 = diffs;
        for (const [a, b, label] of REGIONS) {
          let n = 0, firstAddr = -1;
          for (let addr = a; addr < b; addr++) {
            if (SKIP.has(addr)) continue;
            checks++;
            if (ship.ram[addr] !== w[addr]) {
              n++;
              if (firstAddr < 0) firstAddr = addr;
            }
          }
          if (n) {
            report(f, label, `${n} bytes differ, first $${firstAddr.toString(16).padStart(4, '0')}: got $${ship.ram[firstAddr].toString(16).padStart(2, '0')} want $${w[firstAddr].toString(16).padStart(2, '0')}`
                   + (verbose ? ' ' + dumpAround(ship.ram, w, firstAddr) : ''));
          }
        }
        // the scroll and the layers through LevelScroll
        checks++;
        if (ship.level.scroll !== W(w, 0x1830)) report(f, 'scroll $1830', `got ${ship.level.scroll} want ${W(w, 0x1830)}`);
        for (let i = 0; i < 2; i++) {
          const base = 0x1832+0x30*i, l = ship.level.layers[i];
          const want = {kind: W(w, base+0x12), x: W(w, base+0x1B), y: W(w, base+0x1E), hscroll: W(w, base+4), vscroll: W(w, base+6),
                        lastColumn: W(w, base+0x16), speedX: W(w, base+0x14)};
          const got = {kind: l.kind, x: (l.x >> 8) & 0xFFFF, y: (l.y >> 8) & 0xFFFF, hscroll: l.hscroll & 0xFFFF, vscroll: l.vscroll & 0xFFFF,
                       lastColumn: l.lastColumn, speedX: l.speedX & 0xFFFF};
          for (const k in want) {
            checks++;
            if (got[k] !== want[k]) report(f, `layer ${i+1} ${k}`, `got ${got[k]} want ${want[k]}`);
          }
        }
        compared++;
        if (diffs > bad0 && firstBad === null) firstBad = f;
        if (diffs > bad0 && stopAtFirst) break;
      }
      // the frame: the NMI with this frame's joypad, then the pass
      const joy = rec.joypad[f] || 0;
      const entry = rec.index[f-rec.first];
      // ★ STAT77 of the frame is the PPU's (the remake's SNESPPU tells it); here the recording's
      ship.timeOver = !!entry.timeOver;
      ship.rangeOver = !!entry.rangeOver;
      ship.events = [];
      ship.nmi(joy);
      ship.pass();
      // ★ a boss recording holds the section byte with the harness poke until frame 5000 (`traceenemies.py`
      // `BOSS_POKE_UNTIL`, at the start of every frame — after the pass of the frame before): the same here
      if (rec.meta.boss && f+1 < 5000) {
        ship.w8(0x16E5, rec.meta.section);
      }
    }
  } catch (e) {
    report(f, 'exception', e.message);
    if (verbose) console.log(e.stack);
  }
  console.log(`${name}: level ${rec.meta.level} ${rec.meta.scenario}, loader at f${f0}, ${compared} frames compared, ${lagFrames} lag frames skipped, `
              + `${checks-before} checks, ${diffs-beforeDiffs} differences` + (firstBad !== null ? ` (first at f${firstBad})` : '')
              + (gameOver !== null ? `, game over at f${gameOver} (M5)` : '')
              + `; lag model: ${lagChecks} frames, ${lagMismatches} mispredicted` + (firstLagBad !== null ? ` (first at f${firstLagBad})` : ''));
  lagTotal += lagChecks; lagBad += lagMismatches; framesTotal += compared; lagSkipped += lagFrames;
}

/**
 * The layers as the original holds them at the loader's frame — the launch's
 * second section (15) still on the screen; the loader replaces them. The
 * scroll too.
 */
function layersFromRam(ship, w) {
  ship.level.loadRecord(15);
  for (let i = 0; i < 2; i++) {
    const base = 0x1832+0x30*i, l = ship.level.layers[i];
    l.kind = W(w, base+0x12);
    l.x = w[base+0x1A] | (W(w, base+0x1B) << 8);
    l.y = w[base+0x1D] | (W(w, base+0x1E) << 8);
    l.speedX = W(w, base+0x14);
    l.speedY = W(w, base+0x24);
    l.signX = (l.speedX & 0x8000) ? 0xFF : 0;
    l.signY = (l.speedY & 0x8000) ? 0xFF : 0;
    l.hscroll = W(w, base+4);
    l.vscroll = W(w, base+6);
    l.lastColumn = W(w, base+0x16);
    l.lastRow = W(w, base+0x18);
    l.trigger = W(w, base+0x2A);
    l.stop = W(w, base+0x2E);
    l.wraps = W(w, base+0x2C);
    l.scriptStep = null;
  }
  ship.level.scroll = W(w, 0x1830);
  ship.level.scrollFrac = w[0x182F];
  ship.level.scrollEnd = W(w, 0x1825);
  ship.level.scrollSpeed = W(w, 0x1827);
}

/** the loader task in $8760 (no lives left) or the bank $03 game-over transition in the list */
function isGameOver(w) {
  let x = 0x1580, n = 0;
  while (x && x !== 0x1586 && n++ < 100) {
    const code = W(w, x+3) | (w[x+5] << 16);
    if (code === 0x018760 || code === 0x0380B1) return true;
    x = W(w, x);
  }
  return false;
}

function dumpAround(got, want, addr) {
  const a = addr & ~0xF;
  const hex = (buf) => Array.from(buf.subarray(a, a+16)).map((v) => v.toString(16).padStart(2, '0')).join(' ');
  return `\n      got  $${a.toString(16)}: ${hex(got)}\n      want $${a.toString(16)}: ${hex(want)}`;
}

const names = existsSync(dir) ? readdirSync(dir).filter((n) => /^[lb]\d[a-z]\d*$/.test(n)).sort() : [];
for (const name of names) {
  if (only && name !== only) continue;
  matchRecording(name);
}
console.log(`\nmatchenemies: ${names.filter((n) => !only || n === only).length} recordings, ${framesTotal} frames compared (${lagSkipped} lag), ${checks} checks, ${diffs} differences; lag model: ${lagTotal} frames, ${lagBad} mispredicted`);
process.exit(diffs ? 1 : 0);
