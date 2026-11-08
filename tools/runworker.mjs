#!/usr/bin/env node
/**
 * runworker — the worker's protocol without a browser.
 *
 *   ./tools/runworker.mjs [--frames N] [--verbose]
 *
 * `app/gameWorker.js` (a classic script, `importScripts`) runs in a stand-in
 * of the worker's environment in the `headless` mode, where it ticks on
 * request, and the protocol of `app/WORKER-PROTOCOL.md` is walked through:
 * `init`, `controls`, `tick`, `pause`, `continue`, `random`, `reset`.
 *
 * Checked: the answer to `init` is a frame with the panel; ★ the choices of
 * the original (level NOVICE/EASY/NORMAL/HARD, sound STEREO/NORMAL) arrive
 * in the worker and an unknown one is dropped for the default (★ EASY,
 * STEREO); a tick moves the frame and the pass counters by one; the joypad
 * word arrives whole and keeps its low nibble clear; `pause` / `continue` /
 * `reset`; **the seed carries through** — two runs with the same seed give
 * the same random values and the same frames, another seed other values.
 * M2: the attract mode scrolls a section. **M3: the game** — the ship's
 * tiles and the panel reach the chip, the section's tiles and brightness
 * come as events, the lag frames of the song load are reported and change
 * nothing, the ship moves on the joypad, the OAM carries its sprites, the
 * game is deterministic, a death and the game over arrive.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const frames = parseInt((args.find((a) => a.startsWith('--frames=')) || '--frames=50').split('=')[1], 10) || 50;
const verbose = args.includes('--verbose');

function startWorker(onMessage) {
  const sandbox = {
    console, Date, Math, atob,
    setTimeout: () => 0, clearTimeout: () => {},
    postMessage: onMessage,
    importScripts(...files) {
      files.forEach((file) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', file.split('?')[0]), 'utf8'), context, {filename: file}));
    }
  };
  sandbox.self = sandbox;
  sandbox.location = {search: ''};
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'), context, {filename: 'gameWorker.js'});
  return {send(message) { sandbox.onmessage({data: message}); }, sandbox};
}

let checks = 0, failures = 0;
function check(condition, label) {
  checks++;
  if (!condition) { failures++; console.log('  CHYBA: '+label); }
  else if (verbose) { console.log('  ok: '+label); }
}

function run(seed, count, init) {
  const messages = [];
  const worker = startWorker((m) => { messages.push(m); if (verbose) console.log(JSON.stringify(m).slice(0, 160)); });
  worker.send({id: 'init', initData: Object.assign({headless: true, seed: seed, hiScore: 0}, init || {})});
  for (let i = 0; i < count; i++) worker.send({id: 'tick'});
  return {worker, messages, sandbox: worker.sandbox};
}

// init and the panel
{
  const {messages} = run(7, 0, {level: 'HARD', sound: 'NORMAL', hiScore: 12345});
  check(messages.length === 1 && messages[0].id === 'frame', 'init odpoví snímkem');
  const m = messages[0];
  check(m.frame === 0 && m.pass === 0 && m.lag === false, 'první snímek: frame 0, pass 0, lag false');
  check(m.panel && m.panel.level === 'HARD' && m.panel.sound === 'NORMAL', '★ volby originálu dorazí (HARD, NORMAL)');
  check(m.panel.hiScore === 12345 && m.panel.score === 0, 'panel nese hiScore a skóre 0');
  check(m.joypad === 0, 'ovladač v klidu');
}
// unknown choices
{
  const {messages} = run(1, 0, {level: 'IMPOSSIBLE', sound: 'QUAD'});
  check(messages[0].panel.level === 'EASY' && messages[0].panel.sound === 'STEREO', '★ neznámé volby se zahodí (EASY, STEREO — výchozí US)');
}
// ticks, controls, pause, continue, reset
{
  const {worker, messages, sandbox} = run(3, frames, {});
  check(messages.length === frames+1, 'každý tick dá snímek ('+frames+')');
  check(messages[frames].frame === frames && messages[frames].pass === frames, 'počítadla snímků a průchodů');
  worker.send({id: 'controls', joypad: 0x8100 | 0x000F});
  worker.send({id: 'tick'});
  check(messages[messages.length-1].joypad === 0x8100, 'ovladač dorazí celý (B + vpravo), dolní nibble vynulovaný');
  worker.send({id: 'controls', joypad: 0});
  worker.send({id: 'pause'}); worker.send({id: 'tick'});
  check(messages[messages.length-1].frame === frames+2, 'headless tick jde i v pauze (jen časovač stojí)');
  worker.send({id: 'continue'}); worker.send({id: 'tick'});
  check(messages[messages.length-1].frame === frames+3, 'po continue tiká dál');
  worker.send({id: 'reset'});
  const n = messages.length; worker.send({id: 'tick'});
  check(messages.length === n, 'po resetu netiká');
}
// the seed
{
  const draw = (seed) => {
    const {worker, messages, sandbox} = run(seed, 0, {});
    for (let i = 0; i < 16; i++) worker.send({id: 'random', site: 0x8000+i});
    return messages.filter((m) => m.id === 'random').map((m) => m.value);
  };
  const a = draw(1234), b = draw(1234), c = draw(4321);
  check(a.length === 16 && a.every((v) => Number.isInteger(v) && v >= 0 && v < 256), 'random odpoví 16 bajty');
  check(JSON.stringify(a) === JSON.stringify(b), 'stejný seed → stejná posloupnost');
  check(JSON.stringify(a) !== JSON.stringify(c), 'jiný seed → jiná posloupnost');
  const fa = run(99, 30, {}).messages.map((m) => JSON.stringify(m)).join('|');
  const fb = run(99, 30, {}).messages.map((m) => JSON.stringify(m)).join('|');
  check(fa === fb, 'stejný seed → stejné snímky');
}

// M2: the scroll of the sections (levelScroll.js over data/levels.json)
{
  const levels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'levels.json'), 'utf8'));
  const {worker, messages, sandbox} = run(5, 0, {data: {levels}, section: 0});
  const first = messages[0];
  check(first.sectionStart && first.sectionStart.section === 0 && first.sectionStart.tileSet === levels.sections[0].tileSet,
        'init s levels: první snímek nese sectionStart (sekce 0, sada dlaždic)');
  check(first.regs && first.regs.hofs[0] === 0 && first.regs.vofs[0] === 24, '★ registry scrollu na startu: BG1 H 0, V 24 (y 536 − 512)');
  let written = 0;
  for (let i = 0; i < 40; i++) { worker.send({id: 'tick'}); written += messages[messages.length-1].writes.length; }
  const last = messages[messages.length-1];
  check(written === 160, '★ prvních 10 sloupců × 8 bloků × 2 vrstvy = 160 bloků dorazí jako zápisy VRAM ('+written+')');
  check(last.writes.length === 0 && last.sectionStart === undefined, 'po naplnění snímek bez zápisů a bez sectionStart');
  check(last.regs.hofs[0] === Math.floor(40*84/256) && last.regs.hofs[1] === Math.floor(40*42/256),
        '★ po 40 průchodech BG1 H '+last.regs.hofs[0]+' (84/256 px na průchod), BG2 H '+last.regs.hofs[1]+' (42/256)');
  for (let i = 0; i < 60; i++) { worker.send({id: 'tick'}); }
  const m100 = messages[messages.length-1];
  check(m100.scroll === Math.floor(100*84/256) && m100.section === 0, '★ scroll $1830 po 100 průchodech = '+m100.scroll);
  const {messages: again} = run(5, 100, {data: {levels}, section: 0});
  check(JSON.stringify(again[100].regs) === JSON.stringify(m100.regs) && JSON.stringify(again[100].writes) === JSON.stringify(m100.writes),
        'scroll je deterministický (druhý běh dává totéž)');
}

// M3: the game (gameKernel.js, ship.js, frameBudget.js over data/*.json)
{
  const data = {};
  for (const name of ['ship', 'levels', 'sprites', 'tiles', 'palettes', 'waves']) {
    data[name] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
  }
  const {worker, messages, sandbox} = run(5, 0, {data, level: 'NORMAL', hiScore: 54321});
  const first = messages[0];
  check(first.frame === 0 && first.pass === 0 && first.lag === false && first.sectionStart === undefined, 'init s daty hry: snímek 0 bez sectionStart');
  const last = () => messages[messages.length-1];
  worker.send({id: 'tick'});
  const f1 = last();
  check(f1.pass === 1 && f1.lag === false && f1.oam && f1.oam.length === 544 && f1.cgram && f1.cgram.length === 512, 'první tik: průchod 1, OAM 544 B a CGRAM 512 B ve zprávě');
  check(f1.events.some((e) => e.kind === 'commonTiles') && f1.events.some((e) => e.kind === 'inidisp' && (e.value & 0x80)),
        '★ první průchod: font a společná sada sprajtů, zatemnění (INIDISP bit 7)');
  check(f1.section === 0 && f1.panel.level === 'NORMAL' && f1.panel.hiScore === 54321 && f1.panel.score === 0, 'sekce 0, volba NORMAL, hiScore z init, skóre 0');
  // the loader: the tiles, the song — ★ the song load is 19 lag frames (FrameBudget.SONGS[1])
  let lag = 0, bgTiles = null, blankOff = null, shipTiles = 0, panelLines = 0;
  for (let i = 2; i <= 400; i++) {
    worker.send({id: 'tick'});
    const m = last();
    if (m.lag) { lag++; check(m.writes.length === 0 && m.oam === undefined, 'zpožděný snímek f'+i+' nic nezapisuje'); continue; }
    if (bgTiles === null && m.events.some((e) => e.kind === 'bgTiles')) bgTiles = m.events.find((e) => e.kind === 'bgTiles');
    if (blankOff === null && m.events.some((e) => e.kind === 'inidisp' && !(e.value & 0x80))) blankOff = i;
    if (m.shipTiles) shipTiles++;
    if (m.panelLine && m.panelLine.length === 54 && m.panelVram === 0x5F40) panelLines++;
  }
  check(bgTiles !== null && bgTiles.section === 0 && bgTiles.tileSet === data.levels.sections[0].tileSet, '★ dlaždice pozadí sekce 0 (sada '+(bgTiles && bgTiles.tileSet)+')');
  check(lag === 19, '★ nahrání skladby úrovně 1 = 19 zpožděných snímků ('+lag+')');
  check(blankOff !== null && blankOff < 300, '★ obraz se rozsvítí po nahrání (f'+blankOff+')');
  check(shipTiles > 0 && last().shipTilesVram === 0x6000, '★ dlaždice lodi → VRAM $6000 ('+shipTiles+' snímků)');
  check(panelLines > 0, '★ řádek panelu 54 B → VRAM $5F40 ('+panelLines+' snímků)');
  const l400 = last();
  const drawn = (m) => { let n = 0; for (let i = 0; i < 128; i++) if (!(m.oam[4*i] === 1 && m.oam[4*i+1] === 0xFF)) n++; return n; };
  check(drawn(l400) >= 1, '★ loď je v OAM ('+drawn(l400)+' sprajtů)');
  check(l400.scroll > 0 && l400.regs.hofs[0] > 0 && Math.abs(l400.regs.hofs[0]-l400.scroll) <= 1, '★ sekce scrolluje: $1830 = '+l400.scroll+', BG1 H = '+l400.regs.hofs[0]);
  // M4: the game's RAM through the sandbox (`ship` of gameWorker.js) — the OAM alone no longer tells the ship
  // from the enemies
  const ram = () => sandbox.ship.ram;
  const r16 = (a) => ram()[a] | (ram()[a+1] << 8);
  // B fires: the shot registers in the hit list ($1992, its end $3E)
  worker.send({id: 'controls', joypad: 0x8000});
  let shots = 0;
  for (let i = 0; i < 4; i++) { worker.send({id: 'tick'}); shots = Math.max(shots, r16(0x3E)); }
  worker.send({id: 'controls', joypad: 0});
  check(shots > 0, '★ B vystřelí: střela v seznamu zásahů ($3E = '+shots+')');
  // the ship on the joypad: Right for 60 frames moves the ship right — unless an enemy got it (M4)
  const x0 = r16(0x15A3);
  worker.send({id: 'controls', joypad: 0x0100});
  for (let i = 0; i < 60; i++) worker.send({id: 'tick'});
  worker.send({id: 'controls', joypad: 0});
  const x1 = r16(0x15A3), dead = (r16(0x158F) & 0x80) !== 0;
  check(x1 > x0 || dead, '★ vpravo držené 60 snímků posune loď ('+x0+' → '+x1+(dead ? ', loď mezitím zemřela' : '')+')');
  // M4: the enemies are there — an object of bank $02, $03 or $08 lived in the pool at some pass
  let enemies = 0;
  for (let n = 0x180; n < 0x1580; n += 0x40) { if (ram()[n+2] && [2, 3, 8].includes(ram()[n+5])) enemies++; }
  check(enemies > 0, '★ M4: nepřátelé v zásobníku úloh ('+enemies+' objektů bank $02/$03/$08 v tomto snímku)');
  // determinism: the same run twice
  const replay = (seed) => {
    const r = run(seed, 0, {data, level: 'NORMAL', hiScore: 54321});
    for (let i = 0; i < 400; i++) r.worker.send({id: 'tick'});
    r.worker.send({id: 'controls', joypad: 0x0100});
    for (let i = 0; i < 60; i++) r.worker.send({id: 'tick'});
    const m = r.messages[r.messages.length-1];
    return JSON.stringify([m.frame, m.pass, m.scroll, Array.from(m.oam), Array.from(m.cgram), m.regs]);
  };
  check(replay(5) === replay(9), 'hra je deterministická (dva běhy se stejným vstupem dávají stejný snímek)');
  // the game over: the ship flies into the terrain three times (Down + Right held into the floor)
  const over = run(1, 0, {data, level: 'NORMAL', hiScore: 0});
  over.worker.send({id: 'controls', joypad: 0x0500});
  let gameOver = null;
  for (let i = 0; i < 6000 && gameOver === null; i++) {
    over.worker.send({id: 'tick'});
    const m = over.messages[over.messages.length-1];
    if (m.id === 'gameOver') gameOver = {frame: i, score: m.score};
  }
  check(gameOver !== null, '★ tři smrti o terén = game over (snímek '+(gameOver && gameOver.frame)+')');
  const n = over.messages.length;
  over.worker.send({id: 'tick'});
  check(over.messages.length === n, 'po game over worker netiká');
}

console.log(`runworker.mjs: ${checks} kontrol, ${failures} chyb`);
process.exit(failures ? 1 : 0);
