#!/usr/bin/env node
/**
 * matchscreen — frames of the original composed by the library, against MesenCE's pixels.
 *
 * The acceptance tool of M1. It takes the frames `tools/mkscreen.py`
 * recorded (VRAM, CGRAM, OAM, the registers at the top of the frame and the
 * brightness writes inside it), lets **svision** compose each one —
 * `app/screenLoader.js` into `SNESPPU.paint32`, the very code the browser
 * draws with — and compares it **pixel by pixel** with the picture the
 * emulator drew of the same frame (`build/ref/*.ppm`, 256×239, of which the
 * 224 rows of the picture).
 *
 * Colours are compared as RGB: the library converts BGR555 and the master
 * brightness the way MesenCE does (`SNESColor`), so a difference is a
 * difference of the picture, not of a palette.
 *
 *     tools/matchscreen.mjs                       # data/screen*.json and build/screens/*.json
 *     tools/matchscreen.mjs --data build/screens/play1_f2000.json [--verbose] [--png out.png]
 *     tools/matchscreen.mjs --next                # against the emulator's picture one frame later (a timing check)
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; };
const verbose = args.includes('--verbose');
const useNext = args.includes('--next');

const { SNESPPU } = await import('../app/svision/js/platform/canvas2D/snes/snesPPU.js');
const { ScreenLoader } = await import('../app/screenLoader.js');

const WIDTH = SNESPPU.WIDTH, HEIGHT = SNESPPU.HEIGHT;
/** ★ MesenCE centres the 224 lines of the picture in its 239-line frame: scanline s goes to row s+6
    (`SnesPpu::ApplyHiResMode`, `_scanline + 6` without overscan), so picture row 0 (scanline 1) is row 7 */
const TOP = 7;

/** a binary PPM (P6) as {width, height, rgb} */
function readPPM(file) {
  const buf = fs.readFileSync(file);
  const head = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(buf.subarray(0, 40).toString('latin1'));
  if (!head) { throw new Error(file+': not a P6 PPM'); }
  return {width: +head[1], height: +head[2], rgb: buf.subarray(head[0].length)};
}

/** the frame's pixels as the library paints them, little-endian RGBA words */
function compose(scene) {
  const ppu = ScreenLoader.build(scene);
  const pixels = new Uint32Array(WIDTH*HEIGHT);
  ppu.paint32(pixels, true);
  return {ppu, pixels};
}

async function matchOne(file) {
  const scene = JSON.parse(fs.readFileSync(file, 'utf8'));
  let shotPath = path.join(ROOT, scene.screenshot);
  if (useNext) { shotPath = shotPath.replace(/\.ppm$/, '.next.ppm'); }
  const shot = readPPM(shotPath);
  const {ppu, pixels} = compose(scene);
  const bad = [];
  let checks = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      checks++;
      const p = pixels[y*WIDTH+x];
      const r = p & 0xFF, g = (p >> 8) & 0xFF, b = (p >> 16) & 0xFF;
      const o = ((y+TOP)*shot.width+x)*3;
      if (shot.rgb[o] !== r || shot.rgb[o+1] !== g || shot.rgb[o+2] !== b) {
        bad.push([x, y, (shot.rgb[o] << 16) | (shot.rgb[o+1] << 8) | shot.rgb[o+2], (r << 16) | (g << 8) | b]);
      }
    }
  }
  const flagsRef = scene.flags || {};
  const flagChecks = [['timeOver', ppu.timeOver, !!flagsRef.timeOver], ['rangeOver', ppu.rangeOver, !!flagsRef.rangeOver]];
  let flagDiffs = 0;
  for (const [name, mine, ref] of flagChecks) {
    checks++;
    if (mine !== ref) { flagDiffs++; console.log(`  ${path.basename(file)}: ${name} ${mine} (emulator ${ref})`); }
  }
  const unsupported = Object.keys(ppu.unsupported).length ? ' unsupported '+JSON.stringify(ppu.unsupported) : '';
  console.log(`  ${path.basename(file).padEnd(28)} frame ${String(scene.frame).padStart(5)}  writes ${String((scene.writes || []).length).padStart(2)}  `
              +`${checks} checks, ${bad.length+flagDiffs} differences${unsupported}`);
  if (bad.length && verbose) {
    const rows = new Map();
    for (const [, y] of bad) { rows.set(y, (rows.get(y) || 0)+1); }
    console.log('    rows:', [...rows].slice(0, 30).map(([y, n]) => `${y}:${n}`).join(' '));
    console.log('    first:', bad.slice(0, 8).map(([x, y, ref, mine]) => `(${x},${y}) emu #${ref.toString(16).padStart(6, '0')} js #${mine.toString(16).padStart(6, '0')}`).join('  '));
  }
  if (opt('--png')) {
    const { encodeRGBAPNG } = await import('../app/svision/tools/retro/png.mjs');
    fs.writeFileSync(opt('--png'), encodeRGBAPNG(WIDTH, HEIGHT, new Uint8Array(pixels.buffer)));
  }
  return {checks, differences: bad.length+flagDiffs};
}

let files;
if (opt('--data')) {
  files = [path.resolve(opt('--data'))];
} else {
  files = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^screen(_.*)?\.json$/.test(f)).map((f) => path.join(ROOT, 'data', f));
  const dir = path.join(ROOT, 'build', 'screens');
  if (fs.existsSync(dir)) {
    files = files.concat(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f)));
  }
}
let checks = 0, differences = 0;
for (const file of files) {
  const r = await matchOne(file);
  checks += r.checks;
  differences += r.differences;
}
console.log(`matchscreen.mjs: ${files.length} frames, ${checks} checks, ${differences} differences`);
process.exit(differences ? 1 : 0);
