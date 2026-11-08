#!/usr/bin/env node
/**
 * scancoverage — what the recordings of `tools/traceenemies.py` cover, so that a zero proves something.
 *
 * For every recording in `build/m4/enemies/` (and, with `--m3`, the ship's
 * in `build/m3/ship/`) it walks the task list of every regular frame and
 * sums up: every object code the spawner started (the kinds of
 * `data/waves.json`, named there), every task state that ran (the codes
 * of the nodes), the bosses (the odd sections), the weapons (the laser
 * kind of the `b` scenarios, the Force, the bits, the missiles), the lag
 * frames and the frames the chip's sprite limits overflowed, per level.
 * At the end it lists the kinds of the wave lists **no recording spawned**
 * — the acceptance of M4 (`MILNIKY.md`) wants every kind, every boss and
 * every weapon in at least one recording.
 *
 *     tools/scancoverage.mjs                 # the table and the gaps
 *     tools/scancoverage.mjs --states        # every task state seen, with counts
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const showStates = args.includes('--states');
const dirs = [opt('--dir', path.join(ROOT, 'build', 'm4', 'enemies'))];
if (args.includes('--m3')) dirs.push(path.join(ROOT, 'build', 'm3', 'ship'));

const waves = JSON.parse(readFileSync(path.join(ROOT, 'data', 'waves.json'), 'utf8'));
const hex6 = (v) => '$'+v.toString(16).padStart(6, '0').toUpperCase();
const W = (w, a) => w[a] | (w[a+1] << 8);

/** the kinds of the wave lists: code → {name, sections, count} */
const kinds = new Map();
for (const k of Object.values(waves.kinds)) kinds.set(k.code, {name: k.name, sections: k.sections, count: k.count, seen: 0, where: new Set()});

const states = new Map();          // task state code → passes seen
/** the wave list entries by 24-bit address, from waves.json */
const entries = new Map();
for (const sec of waves.sections) for (let i = 0; i < sec.entries.length; i++) entries.set(sec.spawnList+12*i, sec.entries[i]);
const perLevel = new Map();        // level → {frames, lag, timeOver, rangeOver, recordings, bosses, lasers, force, bits, missiles}
const bosses = new Set();          // the odd sections recorded with a boss object alive
const spawned = new Map();         // object code → entries spawned (summed over recordings)
let recordings = 0;

function level(section) { return (section >> 1)+1; }

function scan(where, name) {
  const meta = JSON.parse(readFileSync(path.join(where, 'meta.json'), 'utf8'));
  const idx = JSON.parse(readFileSync(path.join(where, 'index.json'), 'utf8'));
  const blob = inflateSync(readFileSync(path.join(where, 'frames.bin.zz')));
  const size = meta.wramBytes;
  const L = level(meta.section);
  if (!perLevel.has(L)) perLevel.set(L, {frames: 0, lag: 0, timeOver: 0, rangeOver: 0, recordings: [], bosses: new Set(), lasers: new Set(), force: 0, bits: 0, missiles: 0, deaths: 0, maxTasks: 0});
  const P = perLevel.get(L);
  P.recordings.push(name);
  recordings++;
  const seenHere = new Set();
  let lastShipState = 0, lastPtr = null;
  for (let i = 0; i < idx.index.length; i++) {
    const e = idx.index[i];
    P.frames++;
    if (e.lag) { P.lag++; continue; }
    if (e.timeOver) P.timeOver++;
    if (e.rangeOver) P.rangeOver++;
    const w = blob.subarray(i*size, (i+1)*size);
    // the task list: every node's code; the spawner's children are the objects of the wave lists
    let x = 0x1580, n = 0;
    const codesNow = new Set();
    while (x && x !== 0x1586 && n++ < 90) {
      const code = W(w, x+3) | (w[x+5] << 16);
      states.set(code, (states.get(code) || 0)+1);
      codesNow.add(code);
      x = W(w, x);
    }
    P.maxTasks = Math.max(P.maxTasks, n);
    // ★ the objects the spawner started: the wave list pointer $182B moves past every entry it spawned
    // (an entry below the difficulty $16D5 is skipped, not spawned) — a child's code changes in the
    // very pass it is born, so the entry, not the node, says which kind came
    const ptr = W(w, 0x182B), bank = w[0x94];
    if (lastPtr !== null && ptr > lastPtr && ptr-lastPtr < 12*40) {
      for (let p = lastPtr; p < ptr; p += 12) {
        const e = entries.get((bank << 16) | p);
        if (!e) continue;
        if ((e.flags & 3) > w[0x16D5]) continue;
        if (kinds.has(e.code)) { const k = kinds.get(e.code); k.seen++; k.where.add(name); seenHere.add(e.code); }
        spawned.set(e.code, (spawned.get(e.code) || 0)+1);
      }
    }
    lastPtr = ptr;
    if ((meta.section & 1) && n > 8) P.bosses.add(meta.section);
    // the weapons: the Force's root busy, the bits' roots, the missiles in flight
    if (W(w, 0x16F9+3) !== 0xDE0E && W(w, 0x16F9+3) !== 0xDE1F) P.force++;
    if (W(w, 0x174D+3) !== 0xF77C && W(w, 0x174D+3) !== 0xF78D) P.bits++;
    if (W(w, 0x1687)) P.missiles++;
    const shipState = W(w, 0x1589+3);
    if (shipState === 0xA9B4 && lastShipState !== 0xA9B4) P.deaths++;
    lastShipState = shipState;
  }
  if (meta.scenario === 'b' && meta.laser !== null && meta.laser !== undefined) P.lasers.add(meta.laser);
  if (meta.section & 1) bosses.add(meta.section);
  const lags = idx.index.filter((e) => e.lag).length;
  console.log(`${name}: level ${L} section ${meta.section}${meta.boss ? ' (boss)' : ''} ${meta.scenario}${meta.laser !== null && meta.laser !== undefined ? ' laser '+meta.laser : ''}, `
              + `${idx.index.length} frames, ${lags} lag, kinds spawned: ${[...seenHere].map(hex6).join(' ') || 'none'}`);
}

for (const dir of dirs) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter((n) => /^[lb]\d[a-z]\d*$/.test(n)).sort()) {
    if (existsSync(path.join(dir, name, 'meta.json'))) scan(path.join(dir, name), name);
  }
}

console.log('\nper level:');
console.log('level | recordings | frames | lag | timeOver | rangeOver | deaths | bosses | lasers | Force frames | bits frames | missile frames | max tasks');
for (const [L, P] of [...perLevel.entries()].sort((a, b) => a[0]-b[0])) {
  console.log(`${L} | ${P.recordings.join(' ')} | ${P.frames} | ${P.lag} | ${P.timeOver} | ${P.rangeOver} | ${P.deaths} | ${[...P.bosses].join(' ') || '-'} | ${[...P.lasers].sort().join(' ') || '-'} | ${P.force} | ${P.bits} | ${P.missiles} | ${P.maxTasks}`);
}

console.log('\nkinds of the wave lists (code, name, sections, entries in the lists, entries spawned in the recordings, recordings):');
const missing = [];
for (const [code, k] of [...kinds.entries()].sort((a, b) => a[0]-b[0])) {
  console.log(`  ${hex6(code)} ${(k.name || '?').padEnd(28)} sections ${k.sections.join(',').padEnd(22)} ${String(k.count).padStart(3)} entries  ${String(k.seen).padStart(6)} spawned  ${[...k.where].join(' ')}`);
  if (!k.seen) missing.push(code);
}
console.log(`\n${kinds.size} kinds, ${kinds.size-missing.length} spawned in some recording, ${missing.length} never: ${missing.map(hex6).join(' ') || '-'}`);
const bossSections = [1, 3, 5, 7, 9, 11, 13].filter((s) => !bosses.has(s));
console.log(`bosses recorded: ${[...bosses].sort((a, b) => a-b).join(' ') || '-'}; missing boss sections: ${bossSections.join(' ') || '-'}`);
const lasersSeen = new Set(); for (const P of perLevel.values()) for (const l of P.lasers) lasersSeen.add(l);
console.log(`lasers recorded: ${[...lasersSeen].sort().join(' ') || '-'}; missing: ${[0, 1, 2, 3, 4].filter((l) => !lasersSeen.has(l)).join(' ') || '-'}`);
const noLag = [...perLevel.entries()].filter(([, P]) => !P.lag).map(([L]) => L);
console.log(`levels without a lag frame: ${noLag.join(' ') || '-'}`);
if (showStates) {
  console.log('\ntask states (code: passes seen):');
  for (const [code, n] of [...states.entries()].sort((a, b) => a[0]-b[0])) console.log(`  ${hex6(code)} ${n}`);
}
console.log(`\nscancoverage: ${recordings} recordings, ${states.size} task states, ${spawned.size} object codes`);
