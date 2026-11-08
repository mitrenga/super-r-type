#!/usr/bin/env node
/**
 * measurebudget — the cost of the original's passes, NMIs and tasks in master clocks, fitted from the recordings.
 *
 * The lag model's source (M3, `app/frameBudget.js`). `tools/traceship.py`
 * timed every frame: the master clock (within the frame, from line 0) of
 * `main_frame` (the pass starts), `main_frame_end`, the NMI's entry and
 * exit, and of every task's dispatch and return with the task's code and
 * node. This tool strings them into passes across frames and fits, by
 * least squares, **the cost of a pass** as a constant plus a cost per task
 * state (by its code) plus the sprite drawing (per OAM entry written and
 * per entry hidden) plus the palette animation (per running entry); the
 * NMI the same way from the map blocks it drew and the sprite groups it
 * uploaded. The result is printed as the table `app/frameBudget.js` takes
 * (`--emit`), and every pass of the recordings is replayed through the
 * model to count the lag frames it predicts against the ones recorded.
 *
 * ★ A frame is 357 366 clocks; the NMI falls at the start of the vertical
 * blank (line 225 = clock 306 900) — a pass that starts after the NMI of
 * frame N must end before the NMI of frame N+1, or that NMI is a lag one.
 *
 *     tools/measurebudget.mjs                 # all recordings in build/m3/ship/
 *     tools/measurebudget.mjs --dir build/m3/ship,build/m4/enemies --emit   # M3 + M4 (the enemies' states)
 *     tools/measurebudget.mjs --only l1a --tasks --emit
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const only = opt('--only');
const showTasks = args.includes('--tasks');
const emit = args.includes('--emit');
/** `--dir a,b`: the recording directories (M3 `build/m3/ship`, M4 `build/m4/enemies`), comma-separated */
const dirs = opt('--dir', path.join(ROOT, 'build', 'm3', 'ship')).split(',').map((d) => path.resolve(ROOT, d));

const FRAME = 357366;          // ★ master clocks a frame (the mean of 357 368 / 357 364)
const NMI_CLOCK = 225*1364;    // ★ the NMI at the start of line 225
const LAG_NMI = 1198;          // ★ the NMI that skips everything (measured: every one is 1 198)

class Stat {
  constructor() { this.n = 0; this.sum = 0; this.min = Infinity; this.max = -Infinity; this.sq = 0; }
  add(v) { this.n++; this.sum += v; this.sq += v*v; if (v < this.min) this.min = v; if (v > this.max) this.max = v; }
  get mean() { return this.n ? this.sum/this.n : 0; }
  get sd() { return this.n ? Math.sqrt(Math.max(0, this.sq/this.n-this.mean*this.mean)) : 0; }
  toString() { return `n=${this.n} mean=${this.mean.toFixed(0)} sd=${this.sd.toFixed(0)} min=${this.min} max=${this.max}`; }
}

/** least squares by the normal equations (Gaussian elimination, a little ridge for the unseen) */
function solve(rows, nCols) {
  const A = Array.from({length: nCols}, () => new Float64Array(nCols));
  const b = new Float64Array(nCols);
  for (const [x, y] of rows) {
    for (const i in x) {
      const xi = x[i];
      b[i] += xi*y;
      for (const j in x) A[i][j] += xi*x[j];
    }
  }
  for (let i = 0; i < nCols; i++) A[i][i] += 1e-6;
  for (let i = 0; i < nCols; i++) {
    let p = i;
    for (let r = i+1; r < nCols; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) continue;
    for (let r = 0; r < nCols; r++) {
      if (r === i) continue;
      const f = A[r][i]/A[i][i];
      if (!f) continue;
      for (let c = i; c < nCols; c++) A[r][c] -= f*A[i][c];
      b[r] -= f*b[i];
    }
  }
  const out = new Float64Array(nCols);
  for (let i = 0; i < nCols; i++) out[i] = A[i][i] ? b[i]/A[i][i] : 0;
  return out;
}

const passes = [];     // {tasks: [{code, node, cost, unit}], drawn, hidden, anim, cost, start, end, name}
const nmis = [];       // {blocks, groups, job, cost, lag}
const levels = JSON.parse(readFileSync(path.join(ROOT, 'data', 'levels.json'), 'utf8'));
const shipData = JSON.parse(readFileSync(path.join(ROOT, 'data', 'ship.json'), 'utf8'));
const bank04 = Buffer.from(shipData.data, 'base64');
const bank04b = (a) => bank04[(a-0x8000) & 0x7FFF];
const bank04w = (a) => bank04b(a) | (bank04b(a+1) << 8);

function analyse(name, dir) {
  const where = path.join(dir, name);
  if (!existsSync(path.join(where, 'index.json'))) return;
  const meta = JSON.parse(readFileSync(path.join(where, 'meta.json'), 'utf8'));
  const idx = JSON.parse(readFileSync(path.join(where, 'index.json'), 'utf8'));
  const blob = inflateSync(readFileSync(path.join(where, 'frames.bin.zz')));
  const wram = (f) => blob.subarray((f-meta.first)*meta.wramBytes, (f-meta.first+1)*meta.wramBytes);
  const W = (w, a) => w[a] | (w[a+1] << 8);
  const events = [];
  for (const f of Object.keys(idx.timing)) {
    const t = idx.timing[f], fn = +f;
    for (const c of t.pass || []) events.push({t: fn*FRAME+c, kind: 'pass', frame: fn});
    for (const c of t.passEnd || []) events.push({t: fn*FRAME+c, kind: 'passEnd', frame: fn});
    for (const c of t.nmi || []) events.push({t: fn*FRAME+c, kind: 'nmi', frame: fn});
    for (const c of t.nmiExit || []) events.push({t: fn*FRAME+c, kind: 'nmiExit', frame: fn});
    for (const [code, node, c] of t.task || []) events.push({t: fn*FRAME+c, kind: 'task', code, node, frame: fn});
    for (const c of t.taskEnd || []) events.push({t: fn*FRAME+c, kind: 'taskEnd', frame: fn});
  }
  events.sort((a, b) => a.t-b.t);
  let nmiStart = null, nmiFrame = null, passStart = null, features = null, lagInside = 0, tasks = [], taskOpen = null, lastTaskEnd = null;
  const sections = levels.sections;
  /** the work a state does this pass, read from the snapshot of its frame (the task's node) */
  const unitOf = (code, node, w) => {
    if (code === 0x01DDBD) {
      // the sprite set loader: the next record of its list and the groups of that set
      const p = W(w, node+0x30);
      const rec = bank04w(p);
      if (!rec) return 0;
      let n = 0, q = rec+5;
      while (bank04b(q) !== 0xFF && n < 64) { n++; q++; }
      return n;
    }
    if (code === 0x008D38) {
      const layerBase = W(w, node+0x30);
      return W(w, layerBase+0xA);   // the layer's blocks a column
    }
    if (code === 0x01844D) return bank04b(0x8A3F+(w[0x16E5] & 0x1F));   // the song
    return undefined;
  };
  for (const e of events) {
    switch (e.kind) {
      case 'nmi': nmiStart = e.t; nmiFrame = e.frame; break;
      case 'nmiExit':
        if (nmiStart !== null && nmiFrame >= meta.first) {
          const entry = idx.index[nmiFrame-meta.first];
          const lag = !!(entry && entry.lag);
          const w = wram(nmiFrame);
          const queue = W(w, 0x2E);
          nmis.push({lag, blocks: lag ? 0 : Math.min(queue, 13), groups: lag ? 0 : (queue ? 0 : Math.min(W(w, 0x68), 4)),
                     job: (!lag && !queue && !W(w, 0x68)) ? (W(w, 0x1801) !== 0x8711) : false, cost: e.t-nmiStart, frame: nmiFrame});
          if (lag && passStart !== null) lagInside++;
        }
        nmiStart = null;
        break;
      case 'pass': passStart = e.t; features = {}; lagInside = 0; tasks = []; break;
      case 'task':
        if (features) {
          const w = wram(Math.min(meta.frames, Math.max(meta.first, e.frame)));
          const unit = unitOf(e.code, e.node, w);
          tasks.push({code: e.code, node: e.node, start: e.t, unit});
          taskOpen = tasks[tasks.length-1];
        }
        break;
      case 'taskEnd':
        if (taskOpen) { taskOpen.cost = e.t-taskOpen.start; taskOpen = null; lastTaskEnd = e.t; }
        break;
      case 'passEnd':
        if (passStart !== null && features) {
          // the snapshot that shows this pass's end: the vertical blank after it
          const endFrame = Math.floor(e.t/FRAME), endClock = e.t-endFrame*FRAME;
          const snapFrame = endClock < NMI_CLOCK ? endFrame : endFrame+1;
          if (snapFrame-meta.first >= 0 && snapFrame <= meta.frames) {
            const w = wram(snapFrame);
            const next = W(w, 0x7E);
            const drawn = (W(w, 0x6C)+W(w, 0x72)) === 0 && next === 0x1FC ? 0 : Math.max(0, (0x1FC-next)/4);
            // the palette animations the pass really stepped: running, and not masked out by the pass counter
            let anim = 0;
            for (let i = 0; i < 16; i++) if ((w[0x1902+8*i] & 3) && !(w[0x1905+8*i] & w[0x50])) anim++;
            const first = tasks.length ? tasks[0].start : e.t;
            passes.push({tasks: tasks.filter((t) => t.cost !== undefined), drawn, hidden: 128-drawn, anim,
                         cost: e.t-passStart-lagInside*LAG_NMI, start: passStart, end: e.t, name, lagInside,
                         head: first-passStart, tail: (lastTaskEnd !== null && lastTaskEnd > passStart) ? e.t-lastTaskEnd : 0});
          }
        }
        passStart = null; features = null;
        break;
    }
  }
  console.log(`${name}: ${events.length} events, ${passes.filter((p) => p.name === name).length} passes`);
}

for (const dir of dirs) {
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => /^[lb]\d[a-z]\d*$/.test(n)).sort() : [];
  for (const name of names) {
    if (only && name !== only) continue;
    analyse(name, dir);
  }
}

// --- the NMI: a constant, a cost a map block, a cost a sprite group, the job's share
const nmiRows = nmis.filter((n) => !n.lag).map((n) => [{0: 1, 1: n.blocks, 2: n.groups, 3: n.job ? 1 : 0}, n.cost]);
const nmiFit = solve(nmiRows, 4);
const nmiRes = new Stat();
for (const n of nmis) if (!n.lag) nmiRes.add(n.cost-(nmiFit[0]+nmiFit[1]*n.blocks+nmiFit[2]*n.groups+nmiFit[3]*(n.job ? 1 : 0)));
console.log(`\nNMI: base ${nmiFit[0].toFixed(0)} + ${nmiFit[1].toFixed(0)} a map block + ${nmiFit[2].toFixed(0)} a sprite group + ${nmiFit[3].toFixed(0)} a job; residual ${nmiRes}`);

// --- the pass: every task state's own cost (dispatch → return) as its mean; the states whose cost
// follows their work get a unit cost: the sprite set loader (a group), the fill task (a block), the
// song load (the song); the rest of the pass (the joypad, the sprites into the OAM, the palette
// animation, the lag NMIs spanned) against the entries drawn and hidden and the running animations
const taskCost = new Map();
for (const p of passes) {
  for (const t of p.tasks) {
    if (!taskCost.has(t.code)) taskCost.set(t.code, new Stat());
    taskCost.get(t.code).add(t.cost);
  }
}
// the per-unit states
const UNIT = {0x01DDBD: 'groups', 0x008D38: 'blocks'};
const unitFit = {};
for (const code of Object.keys(UNIT).map(Number)) {
  const rowsU = [];
  for (const p of passes) for (const t of p.tasks) if (t.code === code && t.unit !== undefined) rowsU.push([{0: 1, 1: t.unit}, t.cost]);
  if (rowsU.length) {
    const f = solve(rowsU, 2);
    unitFit[code] = {base: f[0], unit: f[1], n: rowsU.length};
  }
}
// the song load: a constant a song (★ the IPL transfer of the song's bytes)
const songCost = new Map();
for (const p of passes) for (const t of p.tasks) if (t.code === 0x01844D && t.unit !== undefined) {
  if (!songCost.has(t.unit)) songCost.set(t.unit, new Stat());
  songCost.get(t.unit).add(t.cost);
}
const estTask = (t) => {
  if (t.code === 0x01844D && songCost.has(t.unit)) return songCost.get(t.unit).mean;
  const u = unitFit[t.code];
  if (u && t.unit !== undefined) return u.base+u.unit*t.unit;
  return taskCost.get(t.code).mean;
};
// (★ the rest is fitted over the ordinary passes only — no task over 30 000 clocks — so that the
// loads of a section, whose per-state means are rough, do not bend the coefficients of the play)
// the tail (the last task's return → main_frame_end: the sprites, the palette animation, the score)
// is fitted on its own measurement, the head (main_frame → the first task: the joypad) as a mean
const restRows = [];
const headStat = new Stat();
for (const p of passes) {
  let tasks = 0;
  for (const t of p.tasks) tasks += estTask(t);
  p.taskEst = tasks;
  headStat.add(p.head);
  if (p.tail) restRows.push([{0: 1, 1: p.drawn, 2: p.hidden, 3: p.anim}, p.tail]);
}
const restFit = solve(restRows, 4);
restFit[0] += headStat.mean;
const res = new Stat();
for (const p of passes) {
  p.est = p.taskEst+restFit[0]+restFit[1]*p.drawn+restFit[2]*p.hidden+restFit[3]*p.anim;
  res.add(p.cost-p.est);
}
console.log(`pass: ${passes.length} passes; the rest = ${restFit[0].toFixed(0)} (head ${headStat.mean.toFixed(0)}) + ${restFit[1].toFixed(0)} an entry drawn + ${restFit[2].toFixed(0)} an entry hidden + ${restFit[3].toFixed(0)} a palette animation stepped; residual ${res}`);
for (const code of Object.keys(unitFit).map(Number)) {
  const u = unitFit[code];
  console.log(`  $${code.toString(16).padStart(6, '0')}: ${u.base.toFixed(0)} + ${u.unit.toFixed(0)} a ${UNIT[code]} (${u.n} runs)`);
}
for (const [song, st] of [...songCost.entries()].sort((a, b) => a[0]-b[0])) console.log(`  song ${song}: ${st}`);
if (showTasks || emit) {
  const rowsOut = [...taskCost.entries()].sort((a, b) => b[1].sum-a[1].sum);
  for (const [code, st] of rowsOut) console.log(`  task $${code.toString(16).padStart(6, '0')}: ${st}`);
}

// --- the lag frames the model predicts: a pass starts at the NMI's exit, ends after its cost (plus the lag NMIs it spans)
let predicted = 0, actual = 0, mismatches = 0;
for (const p of passes) {
  const startFrame = Math.floor(p.start/FRAME);
  const firstNmi = (startFrame+1)*FRAME+NMI_CLOCK;
  const actualLags = Math.max(0, Math.floor((p.end-firstNmi)/FRAME)+1);
  let t = p.start+p.est, lags = 0;
  while (t > firstNmi+lags*FRAME) { lags++; t += LAG_NMI; }
  predicted += lags; actual += actualLags;
  if (lags !== actualLags) { mismatches++; if (mismatches <= 12) console.log(`  mismatch ${p.name} pass at frame ${startFrame}: predicted ${lags} lag frames, recorded ${actualLags} (cost ${p.cost}, estimate ${p.est.toFixed(0)})`); }
}
console.log(`lag frames: predicted ${predicted}, recorded ${actual}, passes mispredicted ${mismatches} of ${passes.length}`);

if (emit) {
  const table = {};
  for (const [code, st] of [...taskCost.entries()].sort((a, b) => a[0]-b[0])) table['$'+code.toString(16).padStart(6, '0')] = Math.round(st.mean);
  const units = {};
  for (const code of Object.keys(unitFit).map(Number)) units['$'+code.toString(16).padStart(6, '0')] = {base: Math.round(unitFit[code].base), unit: Math.round(unitFit[code].unit), what: UNIT[code]};
  console.log('\n// the fitted costs, master clocks (tools/measurebudget.mjs --emit)');
  console.log('FrameBudget.NMI = ' + JSON.stringify({base: Math.round(nmiFit[0]), block: Math.round(nmiFit[1]), group: Math.round(nmiFit[2]), job: Math.round(nmiFit[3]), lag: LAG_NMI}) + ';');
  console.log('FrameBudget.REST = ' + JSON.stringify({base: Math.round(restFit[0]), drawn: Math.round(restFit[1]), hidden: Math.round(restFit[2]), anim: Math.round(restFit[3])}) + ';');
  const songs = {};
  for (const [song, st] of songCost.entries()) songs[song] = Math.round(st.mean);
  console.log('FrameBudget.SONGS = ' + JSON.stringify(songs) + ';');
  console.log('FrameBudget.UNITS = ' + JSON.stringify(units) + ';');
  console.log('FrameBudget.TASKS = ' + JSON.stringify(table) + ';');
}
