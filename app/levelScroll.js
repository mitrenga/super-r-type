// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The scroll of a section of Super R-Type and the map it draws into VRAM,
 * as the original does it — its routines carried over one by one
 * (`sources/asm/main.asm`, names in `sources/docs/disasm_notes.md` §1 and
 * §8; the data in `data/levels.json` from `tools/dumplevels.py`).
 *
 * The original keeps one **layer object** per background (`$1832` BG1,
 * `$1862` BG2; the field offsets below are the object's) and a **global
 * scroll** `$1830` that the spawn list and the layer scripts measure
 * against. Every pass of the main loop advances the scroll (`S_008D6F`)
 * and steps both layers (`S_008D9C`): the layer's *kind* (+$12) picks a
 * movement handler (`$04:81B3`) and a drawing handler (`$04:81D3`). Kind 4
 * scrolls at a speed, kind 6/8 runs a script of speeds and triggers, kind
 * 2 stands still, $A-$10 are states the boss code switches a layer into.
 * The drawing handler (`L_00909E`) writes the scroll registers' shadows
 * (+4, +6) and, when the scroll crosses into a new 32 px column, queues
 * the stream column `(scroll >> 5) + 9` — the one 288 px right of the
 * screen's left edge, into VRAM column `(c & 15)` of the 64×64 map
 * (`map_enqueue_a`, `S_00924E`: a column is `blocks` metatile references,
 * each 4×4 tiles plus 16 collision nibbles that go to `$7E:3160`). The
 * first ten columns are drawn by a task, one a pass (`L_008C70`,
 * `L_008D1C`; BG2's fill starts when BG1's has ended, `L_0183EF`). The NMI of every regular frame drains at most **13** queued
 * blocks into VRAM (`nmi_draw_metatile`); the queue holds 64 and
 * `map_enqueue_a` drops what does not fit.
 *
 * Positions are 24-bit fixed point (+$1A fraction, +$1B/+$1C integer),
 * 512 more than the scroll register. Everything is integer arithmetic in
 * the widths of the original.
 *
 * Measured by `tools/matchlevels.mjs` against VRAM, CGRAM and the layer
 * objects of the running original at many scroll positions of every
 * section. `tools/runworker.mjs` drives it through the worker.
 */
class LevelScroll {

  /**
   * @param {Object} levels - Parsed `data/levels.json`.
   */
  constructor(levels) {
    this.levels = levels;
    this.sections = levels.sections;
    /** the 64×64 maps of BG1 (words $0000-$0FFF) and BG2 ($1000-$1FFF) as the PPU holds them */
    this.vram = new Uint16Array(0x2000);
    /** the collision bytes of `$7E:3160`, one a tile, the same layout */
    this.collision = new Uint8Array(0x2000);
    /** a hand on WRAM `$7E:0000-$1FFF` for a metatile word that names the bank's mirror (`metatile`); the kernel sets it */
    this.readMirror = null;
    /** the VRAM addresses of the blocks drawn from such words (the tools count them apart) */
    this.mirrorBlocks = [];
    /** the queue of `$7E:5160`: {vaddr, words} */
    this.queue = [];
    this.section = null;
    this.layers = [];
    this.scroll = 0;
    this.scrollFrac = 0;
    this.scrollEnd = 0;
    this.scrollSpeed = 0;
    this.passes = 0;
    /** VRAM words the last vertical blank wrote: [{vaddr, words}] for the model */
    this.written = [];
    /** the initial fill tasks of `L_008C70`: {layer, vaddr, columns} */
    this.fillTasks = [];
  } // constructor

  /** ★ at most this many queued blocks the NMI draws a frame (`nmi_frame`: `$00` = 13) */
  static get QUEUE_PER_FRAME() { return 13; }
  /** ★ the queue holds 64 blocks (`map_enqueue_a`: `CMP #$0040`) */
  static get QUEUE_LIMIT() { return 64; }
  /** ★ columns drawn when a layer starts (`L_008C70`: `$0032,Y` = 10) */
  static get FIRST_COLUMNS() { return 10; }
  /** ★ the column queued when the scroll crosses a 32 px line: `(scroll >> 5) + 9` (`L_00909E`) */
  static get LOOKAHEAD() { return 9; }
  /** a metatile record: 16 tile words and 8 bytes of collision nibbles */
  static get METATILE_SIZE() { return 40; }

  // --------------------------------------------------------------- the data

  /**
   * The section record by its index (0-17).
   * @param {number} index - The section.
   * @returns {Object} The record of `levels.json`.
   */
  sectionData(index) {
    return this.sections[index];
  } // sectionData

  /**
   * A metatile record of the current section by its reference word.
   * @param {number} word - The map stream word (address | flips).
   * @returns {Object} {tiles, collision}.
   */
  metatile(word) {
    var addr = word & 0xFFF8;
    var m = this.section.metatiles[String((this.section.bank << 16) | addr)];
    if (m) {
      return m;
    }
    // ★ a boss section's scroll reads columns past its stream (`dumplevels.py`), and a garbage word below
    // $2000 names the bank's WRAM mirror ($7E:0000-$1FFF — the direct page and the task pool): the original's
    // metatile is then whatever those 40 bytes hold at the moment. `readMirror` is the kernel's hand on WRAM.
    if (addr < 0x2000 && this.readMirror) {
      var b = this.readMirror(addr, LevelScroll.METATILE_SIZE);
      var tiles = [], coll = [];
      for (var i = 0; i < 16; i++) {
        tiles.push(b[2*i] | (b[2*i+1] << 8));
      }
      for (i = 0; i < 8; i++) {
        coll.push(b[32+i] & 0xF, b[32+i] >> 4);
      }
      return {tiles: tiles, collision: coll, mirror: true};
    }
    throw new Error('LevelScroll: metatile $'+addr.toString(16)+' of bank $'+this.section.bank.toString(16)+' is not in the dump');
  } // metatile

  // ---------------------------------------------------------- the layers

  /**
   * A layer object as `S_008B4D` builds it from the level record, before
   * the scene gives it a kind and a position.
   * @param {number} index - 0 = BG1, 1 = BG2.
   * @returns {Object} The layer.
   */
  newLayer(index) {
    var rec = this.section.layers[index];
    return {
      index: index,
      /** +0 the map's VRAM base (BG1 0, BG2 $1000) and +$22 the collision offset — the same number */
      mapBase: index*0x1000,
      /** +4 / +6 the scroll register shadows the NMI writes */
      hscroll: 0, vscroll: 0,
      /** +8..+$11 from the level record */
      stream: rec.stream, blocks: rec.blocksPerColumn, stride: rec.bytesPerColumn, maxPosition: rec.maxPosition,
      columns: rec.columns,
      /** +$12 */
      kind: 0,
      /** +$14 speed x (16 bit, 8.8), +$24 speed y */
      speedX: 0, speedY: 0,
      /** +$16 / +$18 the last column / row drawn */
      lastColumn: 0, lastRow: 0,
      /** +$1A..+$1C x as 24-bit fixed point, +$1D..+$1F y */
      x: 0, y: 0,
      /** +$20 the next stream column (as a column index into `columns`) */
      streamNext: 0,
      /** +$26 / +$28 the script: record index and the running step */
      script: null, scriptIndex: 0, scriptStep: null,
      /** +$2A the trigger, +$2C the sign of speed x (scripts) or the wrap count (kind $E), +$2D the sign of speed y */
      trigger: 0, signX: 0, signY: 0, wraps: 0,
      /** +$2E the stop set by `S_00908C` */
      stop: 0
    };
  } // newLayer

  /**
   * Starts a section: the level record, scene 0 and the layers' kinds
   * (`S_008B4D`, `S_008BC3`, `S_008C35`). The maps are cleared as the
   * original's reset of the queue and the fresh VRAM upload leave them.
   * @param {number} index - The section (0-17).
   */
  start(index) {
    this.loadRecord(index);
    var scene = this.section.scenes[0];
    this.startScene(scene);
    for (var i = 0; i < 2; i++) {
      this.initLayer(this.layers[i]);
    }
  } // start

  /**
   * `S_008B4D` (`load_level_record`): the section's record — the end and
   * speed of the scroll, the two layers from their ten record bytes. The
   * maps are cleared as the original's reset of the queue and the fresh
   * VRAM upload leave them. (The kernel of M3, `app/gameKernel.js`,
   * mirrors the record into the RAM and starts the scene and the layers
   * through its tasks, as the original's level manager does.)
   * @param {number} index - The section (0-17).
   */
  loadRecord(index) {
    this.section = this.sectionData(index);
    this.vram.fill(0);
    this.collision.fill(0);
    this.queue = [];
    this.fillTasks = [];
    this.written = [];
    this.scroll = 0;
    this.scrollFrac = 0;
    this.scrollEnd = this.section.scrollEnd;
    this.scrollSpeed = this.section.scrollSpeed;
    if (this.layers.length == 2) {
      // ★ the record rewrites only +8..+$11 of a layer: the rest (the shadows, the last column…)
      // stays from the section before until the layer's init (S_008C35) — a pass later for BG2
      for (var i = 0; i < 2; i++) {
        var fresh = this.newLayer(i), l = this.layers[i];
        l.stream = fresh.stream;
        l.blocks = fresh.blocks;
        l.stride = fresh.stride;
        l.maxPosition = fresh.maxPosition;
        l.columns = fresh.columns;
      }
    } else {
      this.layers = [this.newLayer(0), this.newLayer(1)];
    }
  } // loadRecord

  /**
   * The scene whose table entry lies at the 16-bit address `addr` in the
   * section's bank (`$182D` of the original): entries are 18 B from the
   * table's start.
   * @param {number} addr - The entry address.
   * @returns {Object} The scene.
   */
  sceneAt(addr) {
    var i = Math.round((((addr-this.section.sceneTable) & 0xFFFF))/18);
    return this.section.scenes[Math.min(Math.max(i, 0), this.section.scenes.length-1)];
  } // sceneAt

  /**
   * `S_008BC3` (`scene_start`): a scene gives each layer its kind,
   * position and speed (or script) and the global scroll its start; the
   * kinds' init handlers (`S_008C35`, {@link LevelScroll#initLayer}) run
   * after it — at once from {@link LevelScroll#start}, or from the level
   * manager's tasks (BG2 only once BG1's fill is done).
   * @param {Object} scene - An entry of the scene table.
   */
  startScene(scene) {
    this.scroll = scene.scroll;
    this.scrollFrac = 0;
    for (var i = 0; i < 2; i++) {
      var l = this.layers[i], s = scene.layers[i];
      l.kind = s.kind;
      if (s.kind != 0) {
        l.x = s.x << 8;
        l.y = s.y << 8;
        l.speedX = s.speed;
      }
    }
  } // startScene

  /**
   * `$04:8193` by kind: `L_008C70` (kinds 2, 4, 6, 8, $C, $10) resets the
   * layer, sets the scroll shadows and spawns the fill task; `$00:8C4A`
   * (kinds 0, $A, $E, $12+) parks the layer at 512 with nothing drawn.
   * @param {Object} l - The layer.
   * @param {boolean} [external] - The caller runs the fill task itself (the kernel's task node).
   * @returns {boolean} True when the kind fills the map (a fill task is due).
   */
  initLayer(l, external) {
    var fills = [2, 4, 6, 8, 0xC, 0x10];
    if (fills.indexOf(l.kind & 0x1E) >= 0) {
      l.wraps = 0;
      l.stop = 0;
      l.lastColumn = 0;
      l.lastRow = 0;
      l.streamNext = 0;
      l.hscroll = ((l.x >> 8)-0x200) & 0xFFFF;
      l.vscroll = ((l.y >> 8)-0x200) & 0xFFFF;
      l.x &= 0xFFFF00;
      l.y &= 0xFFFF00;
      // L_008D1C computes the first block's address in the task's first pass, the columns follow one a pass
      if (!external) {
        this.fillTasks.push({layer: l, vaddr: null, columns: LevelScroll.FIRST_COLUMNS});
      }
      return true;
    }
    l.x = 0x200 << 8;
    l.y = 0x200 << 8;
    l.lastColumn = 0;
    l.lastRow = 0;
    l.hscroll = 0;
    l.vscroll = 0;
    return false;
  } // initLayer

  /**
   * `S_008CBA`: a layer from a 16-byte record of bank $04 (the launch and
   * the restart picture use it): +0 the last column, +2 the last row, +4
   * the stream offset in bytes, +6 the columns the fill task draws, +8
   * bytes a column, +$A the field +$E, +$C x, +$E y. The caller spawns
   * the fill task with the columns returned.
   * @param {Object} l - The layer.
   * @param {Array} rec - The 16 bytes.
   * @returns {number} The columns of the fill.
   */
  layerFromRecord(l, rec) {
    var w = function (i) { return rec[i] | (rec[i+1] << 8); };
    l.lastColumn = w(0);
    l.lastRow = w(2);
    l.stride = w(8);
    l.streamNext = l.stride ? Math.round(w(4)/l.stride) : 0;
    l.x = w(0xC) << 8;
    l.y = w(0xE) << 8;
    l.hscroll = (w(0xC)-0x200) & 0xFFFF;
    l.vscroll = (w(0xE)-0x200) & 0xFFFF;
    return w(6);
  } // layerFromRecord

  // ---------------------------------------------------------------- a pass

  /**
   * One pass of the main loop as far as the scroll goes: `S_008D6F`,
   * `S_008D9C` for BG1 and BG2, and the fill tasks (`L_008D38`).
   */
  pass() {
    this.passes++;
    this.advanceScroll();
    this.stepLayers();
    // ★ the scene starts BG1 first and BG2 only once BG1's fill task is gone (`L_0183EF` waits for it),
    // so the two fills never run in the same pass — the queue of 64 would not hold 24 blocks a pass
    if (this.fillTasks.length) {
      this.fillStep(this.fillTasks[0]);
      if (this.fillTasks[0].columns <= 0) {
        this.fillTasks.shift();
      }
    }
  } // pass

  /** `S_008D9C` (`layers_step`): both layers move and draw */
  stepLayers() {
    for (var i = 0; i < 2; i++) {
      var l = this.layers[i];
      this.moveLayer(l);
      this.drawLayer(l);
    }
  } // stepLayers

  /** `S_008D6F`: the global scroll, 8.8, never past `scrollEnd` */
  advanceScroll() {
    var sum = this.scrollFrac+(this.scrollSpeed & 0xFF);
    this.scrollFrac = sum & 0xFF;
    this.scroll = (this.scroll+(this.scrollSpeed >> 8)+(sum >> 8)) & 0xFFFF;
    if (this.scroll > this.scrollEnd) {
      this.scroll = this.scrollEnd;
    }
  } // advanceScroll

  /**
   * A 24-bit fixed-point add of a 16-bit speed with a sign byte for the
   * high byte (`L_008DDF`, `L_008FC8`: `ADC $2C,Y`) — `sign` is 0 or $FF.
   * @param {number} pos - 24-bit position.
   * @param {number} speed - 16-bit speed.
   * @param {number} sign - The byte added to the high byte.
   * @returns {number} The new position.
   */
  static add24(pos, speed, sign) {
    return (pos+(speed & 0xFFFF)+((sign & 0xFF) << 16)) & 0xFFFFFF;
  } // add24

  /**
   * `$04:81B3` by kind: the movement handler.
   * @param {Object} l - The layer.
   */
  moveLayer(l) {
    switch (l.kind & 0x1E) {
      case 4:         // L_008E30: x += speed, never past the largest position
        l.x = LevelScroll.add24(l.x, l.speedX, 0);
        this.clampX(l);
        break;
      case 6:         // L_008E5B: start the script, then run its first record at once
        l.kind += 2;
        l.script = this.section.scripts[String((this.section.bank << 16) | l.speedX)] || [];
        l.scriptIndex = 0;
        this.scriptNext(l);
        break;
      case 8:         // L_008E83: the running step
        this.scriptStep(l);
        break;
      case 0xA:       // L_008DDF: both axes by their speeds with the signs of the speeds
      case 0xC:
        l.x = LevelScroll.add24(l.x, l.speedX, (l.speedX & 0x8000) ? 0xFF : 0);
        l.y = LevelScroll.add24(l.y, l.speedY, (l.speedY & 0x8000) ? 0xFF : 0);
        break;
      case 0xE:       // L_00904B: x += speed; past the trigger wrap by 512 and count; stop clears → kind $10
        l.x = LevelScroll.add24(l.x, l.speedX, 0);
        if (((l.x >> 8) & 0xFFFF) >= l.trigger) {
          l.x = ((((l.x >> 8)-0x200) & 0xFFFF) << 8) | (l.x & 0xFF);
          l.wraps = (l.wraps+1) & 0xFFFF;
          if (l.stop == 0) {
            l.kind = 0x10;
          }
        }
        break;
      case 0x10:      // L_009010: like 4; a stop below the position switches to kind $E
        l.x = LevelScroll.add24(l.x, l.speedX, 0);
        this.clampX(l);
        if (l.stop != 0 && l.stop < ((l.x >> 8) & 0xFFFF)) {
          l.kind = 0xE;
        }
        break;
      default:        // L_008E5A: nothing
        break;
    }
  } // moveLayer

  /** `L_008E30`'s clamp: the integer x never passes +$10 */
  clampX(l) {
    if (((l.x >> 8) & 0xFFFF) > l.maxPosition) {
      l.x = (l.maxPosition << 8) | (l.x & 0xFF);
    }
  } // clampX

  /**
   * `L_008E69`: the next script record — its handler reads the arguments
   * and leaves a step to run every pass; the handlers of `srtlib.py`.
   * @param {Object} l - The layer.
   */
  scriptNext(l) {
    var rec = l.script[l.scriptIndex];
    if (!rec) {
      l.scriptStep = null;
      return;
    }
    l.scriptIndex++;
    switch (rec.op) {
      case 'stop':                                   // $8E8B → step $8E96 (nothing)
        l.scriptStep = null;
        break;
      case 'waitRelative':                           // $8E97 → step $8EAE
        l.trigger = (this.scroll+rec.delta) & 0xFFFF;
        l.scriptStep = 'wait';
        this.scriptStep(l);
        break;
      case 'speedX': case 'speedXRelative':          // $8EC4 / $8EC9 → step $8EF6
        l.trigger = rec.op == 'speedX' ? rec.until : (this.scroll+rec.delta) & 0xFFFF;
        l.speedX = rec.vx & 0xFFFF;
        l.signX = (rec.vx & 0x8000) ? 0xFF : 0;
        l.scriptStep = 'x';
        this.scriptStep(l);
        break;
      case 'speedY': case 'speedYRelative':          // $8F22 / $8F27 → step $8F54
        l.trigger = rec.op == 'speedY' ? rec.until : (this.scroll+rec.delta) & 0xFFFF;
        l.speedY = rec.vy & 0xFFFF;
        l.signY = (rec.vy & 0x8000) ? 0xFF : 0;
        l.scriptStep = 'y';
        this.scriptStep(l);
        break;
      case 'speedXY': case 'speedXYRelative':        // $8F80 / $8F85 → step $8FC8
        l.trigger = rec.op == 'speedXY' ? rec.until : (this.scroll+rec.delta) & 0xFFFF;
        l.speedX = rec.vx & 0xFFFF;
        l.signX = (rec.vx & 0x8000) ? 0xFF : 0;
        l.speedY = rec.vy & 0xFFFF;
        l.signY = (rec.vy & 0x8000) ? 0xFF : 0;
        l.scriptStep = 'xy';
        this.scriptStep(l);
        break;
      default:                                       // a handler the dump did not know: the layer stands
        l.scriptStep = null;
        break;
    }
  } // scriptNext

  /**
   * The running step of a script record: move, and past the trigger take
   * the next record (`$8EAE`, `$8EF6`, `$8F54`, `$8FC8`).
   * @param {Object} l - The layer.
   */
  scriptStep(l) {
    switch (l.scriptStep) {
      case 'wait':
        break;
      case 'x':
        l.x = LevelScroll.add24(l.x, l.speedX, l.signX);
        break;
      case 'y':
        l.y = LevelScroll.add24(l.y, l.speedY, l.signY);
        break;
      case 'xy':
        l.y = LevelScroll.add24(l.y, l.speedY, l.signY);
        l.x = LevelScroll.add24(l.x, l.speedX, l.signX);
        break;
      default:
        return;
    }
    if (this.scroll >= l.trigger) {
      this.scriptNext(l);
    }
  } // scriptStep

  /**
   * `$04:81D3` by kind: the drawing handler — `L_00909E` (kinds 4, 6, 8,
   * $A, $10) writes the scroll shadows and queues a new column;
   * `L_0090E2` (kinds $C, $E) only the shadows; `L_0090E1` nothing.
   * @param {Object} l - The layer.
   */
  drawLayer(l) {
    var k = l.kind & 0x1E;
    if (k == 0xC || k == 0xE) {
      l.vscroll = ((l.y >> 8)-0x200) & 0xFFFF;
      l.hscroll = ((l.x >> 8)-0x200) & 0xFFFF;
      return;
    }
    if (!(k == 4 || k == 6 || k == 8 || k == 0xA || k == 0x10)) {
      return;
    }
    l.vscroll = ((l.y >> 8)-0x200) & 0xFFFF;
    l.hscroll = ((l.x >> 8)-0x200) & 0xFFFF;
    var col = l.hscroll >> 5;
    if (col <= l.lastColumn) {
      return;
    }
    l.lastColumn = col;
    this.enqueueColumn(l, LevelScroll.blockAddress(col+LevelScroll.LOOKAHEAD, 0));
  } // drawLayer

  /**
   * `S_0096BD`: the VRAM word address of the 4×4 block at block column
   * `bx` and block row `by` of a 64×64 map (four 32×32 screens).
   * @param {number} bx - Block column (wraps at 16).
   * @param {number} by - Block row (wraps at 16).
   * @returns {number} The word address of the block's first tile.
   */
  static blockAddress(bx, by) {
    var v = ((by & 8) << 1)+(bx & 8)+(by & 7);
    return ((v << 5)+(bx & 7)) << 2;
  } // blockAddress

  /** `S_0096E9`: the block below, wrapping from the top screens to the bottom ones */
  static blockBelow(addr) {
    var screen = addr & 0x0C00;
    var a = (addr & 0x03FF)+0x80;
    if (a >= 0x400) {
      a &= 0x3FF;
      screen ^= 0x800;
    }
    return a | screen;
  } // blockBelow

  /** `S_009713`: the block to the right, wrapping from the left screens to the right ones */
  static blockRight(addr) {
    var screen = addr & 0x0FE0;
    var a = (addr & 0x1F)+4;
    if (a >= 0x20) {
      a &= 0x1F;
      screen ^= 0x400;
    }
    return a | screen;
  } // blockRight

  /**
   * `L_008D1C` / `L_008D38`: the fill task — one stream column a pass from
   * the layer's next column, at the block of the last column / row.
   * @param {Object} task - {layer, vaddr, columns}.
   */
  fillStep(task) {
    var l = task.layer;
    if (task.vaddr === null) {
      // the task's first pass only computes the address (L_008D1C) and ends
      task.vaddr = LevelScroll.blockAddress(l.lastColumn, l.lastRow);
      return;
    }
    this.enqueueColumn(l, task.vaddr);
    task.columns--;
    if (task.columns > 0) {
      task.vaddr = LevelScroll.blockRight(task.vaddr);
    }
  } // fillStep

  /**
   * `map_enqueue_a`: the next stream column of the layer into the queue,
   * block by block downward from `vaddr`; blocks past the queue's limit
   * are dropped, as the original drops them.
   * @param {Object} l - The layer.
   * @param {number} vaddr - The first block's VRAM address within the map.
   */
  enqueueColumn(l, vaddr) {
    var column = l.columns[l.streamNext];
    l.streamNext++;
    if (!column) {
      return;
    }
    var addr = vaddr;
    for (var b = 0; b < l.blocks; b++) {
      if (this.queue.length >= LevelScroll.QUEUE_LIMIT) {
        return;
      }
      this.enqueueBlock(l, addr, column[b]);
      addr = LevelScroll.blockBelow(addr);
    }
  } // enqueueColumn

  /**
   * `S_00924E`: one metatile reference → a queue entry of 16 tile words
   * (flipped by bits 0-1, `$04:81F3`) and 16 collision nibbles into the
   * collision map (flipped the same way).
   * @param {Object} l - The layer.
   * @param {number} addr - The block's VRAM address within the map.
   * @param {number} word - The stream word.
   */
  enqueueBlock(l, addr, word) {
    var m = this.metatile(word);
    var flip = word & 3;
    var words = new Uint16Array(16);
    var r, c, src;
    for (r = 0; r < 4; r++) {
      for (c = 0; c < 4; c++) {
        src = (flip & 2 ? 3-r : r)*4+(flip & 1 ? 3-c : c);
        words[r*4+c] = m.tiles[src] ^ ((flip & 1) ? 0x4000 : 0) ^ ((flip & 2) ? 0x8000 : 0);
      }
    }
    var vaddr = (addr+l.mapBase) & 0xFFFF;
    this.queue.push({vaddr: vaddr, words: words});
    if (m.mirror) {
      this.mirrorBlocks.push(vaddr);
    }
    // the collision bytes land at once, not through the queue (S_00924E before L_0095C8)
    var base = (addr+l.mapBase) & 0x1FFF;
    for (r = 0; r < 4; r++) {
      for (c = 0; c < 4; c++) {
        src = (flip & 2 ? 3-r : r)*4+(flip & 1 ? 3-c : c);
        this.collision[(base+r*32+c) & 0x1FFF] = m.collision[src];
      }
    }
  } // enqueueBlock

  // --------------------------------------------------------------- the NMI

  /**
   * The vertical blank of a regular frame (`nmi_frame`): the scroll
   * registers get the shadows and at most 13 queued blocks go to VRAM. A
   * lag frame (`nmi_lag_skip`) does neither — the caller skips this.
   * @returns {Array} What was written: [{vaddr, words}].
   */
  vblank() {
    var n = Math.min(LevelScroll.QUEUE_PER_FRAME, this.queue.length);
    var out = this.queue.splice(0, n);
    for (var i = 0; i < out.length; i++) {
      var e = out[i];
      for (var r = 0; r < 4; r++) {
        for (var c = 0; c < 4; c++) {
          this.vram[(e.vaddr+r*32+c) & 0x1FFF] = e.words[r*4+c];
        }
      }
    }
    this.written = out;
    return out;
  } // vblank

  /** drains the whole queue — what the original's VRAM holds once it has caught up */
  drain() {
    var all = [];
    while (this.queue.length) {
      all = all.concat(this.vblank());
    }
    this.written = all;
    return all;
  } // drain

  /**
   * The scroll registers of BG1 and BG2 as the NMI writes them.
   * @returns {Object} {hofs: [bg1, bg2], vofs: [bg1, bg2]}.
   */
  registers() {
    if (this.layers.length < 2) {
      // before the first level record the shadows ($1836…) are the zeroed RAM's
      return {hofs: [0, 0], vofs: [0, 0]};
    }
    return {
      hofs: [this.layers[0].hscroll & 0x3FF, this.layers[1].hscroll & 0x3FF],
      vofs: [this.layers[0].vscroll & 0x3FF, this.layers[1].vscroll & 0x3FF]
    };
  } // registers

} // LevelScroll

if (typeof self !== 'undefined') { self.LevelScroll = LevelScroll; }
if (typeof module !== 'undefined' && module.exports) { module.exports = LevelScroll; }
