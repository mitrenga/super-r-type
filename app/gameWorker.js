// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The world of Super R-Type, ticking in its own thread. It has the clock of
 * the machine, the seeded source of randomness, the joypad and — from M3 —
 * **the game itself**: the original's task scheduler, its level manager,
 * the ship with its weapons, the Force, the bits, the scroll of the
 * sections, the sprites into the OAM and the palette animation, every
 * one of them the original's routine over the cartridge's data
 * (`gameKernel.js`, `ship.js`, `force.js`, `weapons.js`, `lasers.js`, `levelScroll.js`,
 * `objectSprites.js`), and **the model of the lag frame** (`frameBudget.js`).
 * Every tick is one frame of the machine: the NMI (the joypad, the map
 * queue, the sprite groups, the NMI job, the DMA of the OAM, the CGRAM, the
 * ship's tiles and the panel) and the pass of the main loop after it — or,
 * when the budget says the pass of the frame before is still running, a
 * **lag frame** in which the NMI does nothing and the picture stands.
 * The frame message carries what the NMI put into the chip; the model
 * (`levelModel.js`, `levelLoader.js`) puts it into the library's PPU.
 *
 * ★ **The tick is one frame of the NTSC machine**: 262 lines of 1 364
 * master clocks at 21.477 MHz, every other frame four clocks shorter
 * (`tools/snesemu.py` `selftest`: 357 368 / 357 364), which is 16.639 ms —
 * 60.10 frames a second. The clock is `setTimeout` with an accumulator,
 * never `setInterval` (R-046).
 *
 * ★ The unit of the game's time is the **pass of the main loop**, not the
 * frame (`sources/docs/disasm_notes.md` §2): a pass that does not fit into
 * a frame makes the next NMI skip everything, and that **lag frame is a
 * state of the game** — `lag` in the frame message, predicted by
 * `FrameBudget` from the master clocks the original's tasks were measured
 * to cost (`tools/measurebudget.mjs`), held against the recordings by
 * `tools/matchship.mjs`.
 *
 * ★ The sprite limits of the chip (STAT77: *range over*, *time over*) are
 * a state of the game too — the original blinks its second sprite group
 * when the frame before overflowed — and the worker computes them from the
 * OAM the last NMI sent, with the library's `snesSpriteLimits` (the same
 * rule `SNESPPU` paints by), because the PPU of the main thread paints
 * later than the game reads the flags.
 *
 * **The enemies (M4)** are the original's objects carried over state by
 * state (`enemies.js` … `enemies4.js` the wave-spawned kinds of bank $02,
 * `enemiesLevel.js` … `enemiesLevel3.js` the explosions, shots and
 * level-bound objects of bank $03, `bosses.js` … `bosses3.js` the bosses
 * of bank $08), measured by `tools/matchenemies.mjs`; `Ship.noEnemies` —
 * the harness patch of M3 — stays off here. The game still starts in the
 * first section of the level, not with the launch from the mother ship
 * (sections 14-15, part 2 of M3).
 *
 * **Attract mode** (ABOUT GAME behind the menu, M2): with `data.levels`
 * alone the worker scrolls the sections of the play order without a ship,
 * as the M2 worker did.
 *
 * The version the application was started with rides on this worker's own
 * URL; whoever is pulled in later gets it passed on, so that a browser does
 * not keep an old copy of a file edited every day (dev mode serves `app/`
 * file by file).
 */
var workerVersion = (typeof self !== 'undefined' && self.location && self.location.search) || '';
importScripts('levelScroll.js'+workerVersion, 'objectSprites.js'+workerVersion, 'gameKernel.js'+workerVersion,
              'force.js'+workerVersion, 'weapons.js'+workerVersion, 'lasers.js'+workerVersion,
              'enemies.js'+workerVersion, 'enemies2.js'+workerVersion, 'enemies3.js'+workerVersion, 'enemies4.js'+workerVersion,
              'enemiesLevel.js'+workerVersion, 'enemiesLevel2.js'+workerVersion, 'enemiesLevel3.js'+workerVersion,
              'bosses.js'+workerVersion, 'bosses2.js'+workerVersion, 'bosses3.js'+workerVersion,
              'ship.js'+workerVersion, 'frameBudget.js'+workerVersion,
              'svision/js/platform/canvas2D/snes/snesSpriteLimits.js'+workerVersion);

/** ★ one NTSC frame in ms: (357 368 + 357 364) / 2 master clocks at 21 477 270 Hz */
var FRAME_MS = 357366/21477.27;
/** ★ at most this many ticks at once after the tab was in the background */
var MAX_CATCHUP = 4;
/** ★ the difficulty levels of the original's SELECT SCENE (manual p. 5) and the sound choice (p. 6) */
var LEVELS = ['NOVICE', 'EASY', 'NORMAL', 'HARD'];
var SOUNDS = ['STEREO', 'NORMAL'];
/** ★ OBSEL of the game ($2101 = 3: 8×8 and 16×16 sprites, tiles at VRAM $6000), `data/screen.json` */
var OBJ_SIZE = 0;
/** ★ the VRAM word addresses of the NMI's DMAs: the ship's tile buffer `$7E:24A0` and the panel line `$18CC` (`disasm_notes.md` §2) */
var SHIP_TILES_VRAM = 0x6000;
var PANEL_VRAM = 0x5F40;

/** ★ the play order of the sections the attract mode cycles through (dumpglobal.py) */
var PLAY_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
/** frames the picture stands at a section's end before the next one starts (the attract mode's own pause) */
var SECTION_END_HOLD = 120;

var state = null;
/** the game (M3): the ship's kernel, or null */
var ship = null;
/** the attract mode (M2): the scroll alone, or null */
var level = null;
/** the OAM the last regular NMI sent to the chip — the frame the PPU paints from it tells STAT77 */
var oamSent = null;
var timer = 0;
var lastTime = false;
var accumulator = 0;

/**
 * ★ The world's source of randomness — **injectable from the first line of
 * the project** (`../STANDARDS.md`). M0 found **no hardware entropy and no
 * time dependence** in the original (`disasm_notes.md` §5: the run is a
 * function of the input alone), and M3 confirmed it over the ship's code:
 * nothing reads this. It stays so that a place that turns out to need one
 * in M4-M5 gets a seeded source, never `Math.random()`. `site` is the
 * address of the read, which a match tool uses to feed recorded values in.
 */
var randState = 1;

function seedRand(seed) {
  randState = (seed >>> 0) || 1;
} // seedRand

function nextRand(site) {
  randState ^= randState << 13; randState >>>= 0;
  randState ^= randState >>> 17;
  randState ^= randState << 5;  randState >>>= 0;
  return randState & 0xFF;
} // nextRand

function reset() {
  clearTimeout(timer);
  timer = 0;
  lastTime = false;
  accumulator = 0;
  seedRand(1);
  state = {
    running: false, paused: false, headless: false,
    seed: 1,
    /** the frames of the machine since init */
    frame: 0,
    /** ★ the passes of the main loop (`$50`): one a regular frame, none in a lag frame */
    pass: 0,
    /** ★ the joypad word as `$4219:$4218` reads it (SNESJoypad), the last one the main thread sent */
    joypad: 0,
    /** the original's choices */
    level: LEVELS[1],
    sound: SOUNDS[0],
    hiScore: 0,
    score: 0,
    /** the attract mode: the section being scrolled, its place in the play order, frames since its end */
    section: 0,
    orderIndex: 0,
    endHold: 0,
    sectionStart: null,
    gameOver: false
  };
  ship = null;
  level = null;
  oamSent = null;
} // reset

// ------------------------------------------------------------------ the game

/** a decimal number as the BCD the original keeps its score in (`$16E7` low word, `$16E9` high) */
function toBcd(n) {
  return parseInt(String(Math.max(0, Math.floor(n)) % 1000000), 16);
} // toBcd

function fromBcd(low, high) {
  return parseInt(((high & 0xFF)*0x10000+low).toString(16), 10) || 0;
} // fromBcd

/**
 * ★ `L_018175`: a new game at the title's difficulty, in the first section
 * (M3: without the launch), the hi score as the title keeps it.
 * @param {Object} data - {ship, levels, sprites, tiles, palettes, waves} — the `data/*.json` files.
 */
function startGame(data) {
  ship = new Ship(data);
  ship.budget = new FrameBudget();
  ship.newGame(Math.max(0, LEVELS.indexOf(state.level)), 0);
  var hi = toBcd(state.hiScore);
  ship.w16(0x16CF, hi & 0xFFFF);
  ship.w16(0x16D1, (hi >> 16) & 0xFF);
  oamSent = new Uint8Array(ship.ram.subarray(0x2200, 0x2420));
} // startGame

/**
 * One frame of the game: the lag model first — a lag NMI does nothing —
 * then the NMI with the joypad and the pass of the main loop.
 * @returns {Object} The 'frame' message.
 */
function gameTick() {
  var out = frame();
  if (ship.budget.nmiIsLag(state.frame)) {
    out.lag = true;
    return out;
  }
  // ★ STAT77 of the frame the chip painted from the OAM the last NMI sent
  var limits = snesSpriteLimits(oamSent, OBJ_SIZE);
  ship.timeOver = limits.timeOver;
  ship.rangeOver = limits.rangeOver;
  ship.events = [];
  ship.soundSent = [];
  var nmi = ship.nmi(state.joypad);
  oamSent = new Uint8Array(nmi.oam);
  state.pass++;
  ship.pass();
  // what the NMI put into the chip
  out.pass = state.pass;
  out.regs = nmi.regs;
  out.writes = nmi.writes;
  out.oam = oamSent;
  out.cgram = new Uint8Array(ship.ram.subarray(0x2F60, 0x3160));
  out.shipTiles = nmi.shipTiles ? new Uint8Array(ship.ram.subarray(0x24A0, 0x28A0)) : null;
  out.shipTilesVram = SHIP_TILES_VRAM;
  out.panelLine = nmi.panel ? new Uint8Array(ship.ram.subarray(0x18CC, 0x1902)) : null;
  out.panelVram = PANEL_VRAM;
  out.groups = nmi.groups ? nmi.groups.map(function (g) { return {vaddr: g.vaddr, words: Array.prototype.slice.call(g.words)}; }) : null;
  out.sound = ship.soundSent.slice();
  out.section = ship.r16(0x16E5) & 0xFF;
  out.scroll = ship.level.scroll;
  state.score = fromBcd(ship.r16(0x16E7), ship.r16(0x16E9));
  state.hiScore = Math.max(state.hiScore, fromBcd(ship.r16(0x16CF), ship.r16(0x16D1)));
  out.panel = panel();
  // what the pass did to the chip beside the NMI (the section's tiles, the brightness, the mosaic)
  out.events = [];
  for (var i = 0; i < ship.events.length; i++) {
    var e = ship.events[i];
    switch (e.kind) {
      case 'bgTiles':
        var sec = ship.level.sectionData(e.section);
        out.events.push({kind: 'bgTiles', section: e.section, tileSet: sec ? sec.tileSet : null});
        break;
      case 'commonTiles': case 'inidisp': case 'mosaic':
        out.events.push(e);
        break;
      case 'gameOver':
        state.gameOver = true;
        break;
      case 'unported':
        postMessage({id: 'error', message: 'gameWorker: not carried over yet — '+e.what});
        break;
    }
  }
  return out;
} // gameTick

// ---------------------------------------------------------- the attract mode

/**
 * Starts a section of the attract mode: the scroll model and the message
 * the model loads the tiles and palettes on.
 * @param {number} section - The section (0-17).
 */
function startSection(section) {
  level.start(section);
  var sec = level.section;
  state.section = section;
  state.endHold = 0;
  state.sectionStart = {section: section, tileSet: sec.tileSet, paletteSets: sec.paletteSets, bank: sec.bank};
} // startSection

function attractTick() {
  state.pass++;
  level.pass();
  var writes = level.vblank();
  if (level.scroll >= level.scrollEnd && level.queue.length == 0 && level.fillTasks.length == 0) {
    state.endHold++;
    if (state.endHold > SECTION_END_HOLD) {
      state.orderIndex = (state.orderIndex+1) % PLAY_ORDER.length;
      startSection(PLAY_ORDER[state.orderIndex]);
    }
  }
  var out = frame();
  out.scroll = level.scroll;
  out.regs = level.registers();
  for (var i = 0; i < writes.length; i++) {
    out.writes.push({vaddr: writes[i].vaddr, words: Array.prototype.slice.call(writes[i].words)});
  }
  if (state.sectionStart) {
    out.sectionStart = state.sectionStart;
    state.sectionStart = null;
  }
  return out;
} // attractTick

// ------------------------------------------------------------------ the tick

function panel() {
  return {level: state.level, sound: state.sound, score: state.score, hiScore: state.hiScore};
} // panel

/**
 * The frame the model draws on, before the mode fills it in.
 * @returns {Object} The 'frame' message.
 */
function frame() {
  return {
    id: 'frame',
    frame: state.frame,
    pass: state.pass,
    lag: false,
    joypad: state.joypad,
    panel: panel(),
    section: state.section,
    scroll: 0,
    writes: [],
    regs: null
  };
} // frame

/**
 * One frame of the machine — one tick.
 */
function tick() {
  state.frame++;
  var out;
  if (ship) {
    out = gameTick();
  } else if (level) {
    out = attractTick();
  } else {
    state.pass++;
    out = frame();
  }
  postMessage(out);
  if (state.gameOver && state.running) {
    state.running = false;
    clearTimeout(timer);
    timer = 0;
    postMessage({id: 'gameOver', score: state.score});
  }
} // tick

/**
 * The clock of the world — ★ `setTimeout` with an accumulator, never
 * `setInterval` (**R-046**): the browser rounds and coalesces timers. The
 * accumulator spends what really passed in whole frames, at most
 * {@link MAX_CATCHUP} at once.
 */
function schedule() {
  if (!state.running || state.paused || state.headless) {
    return;
  }
  timer = setTimeout(function () {
    if (!state.running || state.paused) {
      return;
    }
    var now = Date.now();
    if (lastTime === false) {
      lastTime = now;
    }
    accumulator += now-lastTime;
    lastTime = now;
    var steps = Math.min(Math.floor(accumulator/FRAME_MS), MAX_CATCHUP);
    accumulator -= steps*FRAME_MS;
    for (var step = 0; step < steps && state.running; step++) {
      tick();
    }
    schedule();
  }, Math.floor(FRAME_MS));
} // schedule

onmessage = function (event) {
  var message = event.data || {};
  switch (message.id) {

    case 'init':
      reset();
      var initData = message.initData || {};
      state.headless = !!initData.headless;
      state.seed = (initData.seed >>> 0) || 1;
      state.hiScore = initData.hiScore || 0;
      if (LEVELS.indexOf(initData.level) >= 0) {
        state.level = initData.level;
      }
      if (SOUNDS.indexOf(initData.sound) >= 0) {
        state.sound = initData.sound;
      }
      seedRand(state.seed);
      var data = initData.data || {};
      if (data.ship && data.levels && data.sprites && data.tiles && data.palettes && data.waves) {
        // ★ the game: the cartridge's data (dump*.py) into the original's code
        startGame(data);
      } else if (data.levels && data.levels.sections) {
        // the attract mode: the scroll alone (M2)
        level = new LevelScroll(data.levels);
        var first = (initData.section === undefined) ? PLAY_ORDER[0] : (initData.section | 0);
        state.orderIndex = Math.max(0, PLAY_ORDER.indexOf(first));
        startSection(first);
      }
      state.running = true;
      // ★ the clock is read here, not in the first timeout: otherwise the
      // first wake-up only notes the time and the world starts a frame late
      lastTime = Date.now();
      var out = frame();
      if (level) {
        out.regs = level.registers();
        out.sectionStart = state.sectionStart;
        state.sectionStart = null;
      }
      postMessage(out);
      schedule();
      break;

    case 'controls':
      // the whole joypad word on every change — a diagonal is two bits, not a conflict
      state.joypad = (message.joypad | 0) & 0xFFF0;
      break;

    case 'pause':
      state.paused = true;
      clearTimeout(timer);
      timer = 0;
      lastTime = false;
      break;

    case 'continue':
      if (state.paused) {
        state.paused = false;
        lastTime = false;
        accumulator = 0;
        schedule();
      }
      break;

    case 'tick':
      if (state.headless && state.running) {
        tick();
      }
      break;

    case 'random':
      postMessage({id: 'random', value: nextRand(message.site || 0)});
      break;

    case 'reset':
      reset();
      break;

  } // switch
}; // onmessage

reset();
