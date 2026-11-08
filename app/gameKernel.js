// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The kernel of Super R-Type — the original's bank `$00` carried over
 * routine by routine (`sources/asm/main.asm`, names in
 * `sources/docs/disasm_notes.md` §0-§3 and §9): the task scheduler, the
 * main loop's pass, the NMI with its job queue, the collision with the
 * terrain, the sprite groups, the dynamic sprite sets, the hit boxes, the
 * palette slots and their animation, the sound queue and the score.
 *
 * ★ **The variables live where the original keeps them.** `ram` is the
 * lower 32 KB of the machine's WRAM (`$7E:0000`-`$7FFF`) and every task,
 * every object and every counter sits at its address, so that
 * `tools/matchship.mjs` compares the same bytes against the running
 * original, frame by frame. The data the code reads with the data bank
 * register at `$04` comes from `data/ship.json` (`tools/dumpship.py`): the
 * whole bank, read by address as the original reads it.
 *
 * **Tasks** (`S_00877F` and friends): the game is a list of task nodes,
 * 64 B each, 80 of them in a pool at `$0180`-`$157F` and six fixed roots
 * (`$1580` the level manager, `$1589` the ship, `$16F9` the Force, `$174D`
 * and `$178D` the missiles, `$17FB` the wave spawner; `$1586` ends the
 * list). A node: +0 the next node, +2 the depth, +3 the code (24-bit),
 * +6 flags (bit 7 = hit, bit 5 = blink), +8 the parent, +$A..+$C x
 * (fraction, integer), +$D speed x, +$F..+$11 y, +$12 speed y, +$14 an
 * animation table, +$16 its phase, +$17/+$18 palette slots, +$1A/+$1C
 * screen x/y, +$1E the layer, +$20 the slot table, +$22 hit points, +$30…
 * the task's own. Every pass of the main loop (`main_frame`) walks the
 * list and jumps to each node's code with X = the node; a task changes
 * its own code pointer to move to its next state. A child is linked right
 * after its parent; killing a node frees it and its descendants.
 *
 * **The NMI** (`nmi`) of a regular frame writes the scroll registers,
 * reads `STAT77`, sends the OAM and CGRAM shadows by DMA, the ship's tile
 * buffer (`$4C` bit 15) and the panel (bit 14), reads the joypad, and then
 * either draws up to 13 queued map blocks, uploads sprite groups, or runs
 * the current **NMI job** (`[$1801]`: text printing, map clearing, a
 * task's state change — a ring of 32 × 16 B records at `$2000`). An NMI
 * that finds the pass unfinished (`$4C` bit 7 still set) does nothing —
 * ★ the lag frame (`disasm_notes.md` §2); `app/frameBudget.js` decides.
 *
 * The map, the layers and the scroll are `app/levelScroll.js` (M2); the
 * OAM is `app/objectSprites.js` (M2). Both are the original's routines
 * too and keep their own state; the kernel binds them to the RAM.
 */
class GameKernel {

  /**
   * @param {Object} data - {ship, levels, sprites, tiles, palettes, waves}: the parsed data files.
   */
  constructor(data) {
    this.data = data;
    /** $7E:0000-$7FFF */
    this.ram = new Uint8Array(0x8000);
    /** bank $04 at $8000-$FFFF (data/ship.json) */
    this.bank04 = GameKernel.bytes(data.ship.data);
    this.level = new LevelScroll(data.levels);
    var self = this;
    // ★ a garbage metatile word of a column past the stream reads the bank's WRAM mirror (`LevelScroll.metatile`)
    this.level.readMirror = function (addr, n) {
      return self.ram.subarray(addr, addr+n);
    };
    this.sprites = new ObjectSprites(data.sprites);
    // ★ the OAM shadow and the high table are the RAM's: the bytes a pass does not write stay
    this.sprites.oam = this.ram.subarray(0x2200, 0x2420);
    this.sprites.high = this.ram.subarray(0x2420, 0x24A0);
    // a metasprite the survey of M2 did not see is read from the bank as the original reads it
    var K = this;
    var records = data.sprites.records;
    this.sprites.record = function (address) {
      return records[String(address)] || K.metasprite(address);
    };
    /** the task code by 24-bit address: function (x) */
    this.code = {};
    /** the NMI jobs by 24-bit address: function (job) — job = the record at $1801 */
    this.jobs = {};
    /** the VRAM writes the NMI made this frame for the model: [{vaddr, words}] and the text/clear words */
    this.vramWrites = [];
    /** the CGRAM rows the pass rewrote: a set of row numbers */
    this.cgramDirty = new Set();
    /** the sound commands sent this frame (S_00A510): bytes */
    this.soundSent = [];
    /** ★ the harness patch of M3: the wave spawner spawns nothing ($08:81D9 = BRA) */
    this.noEnemies = false;
    /** the registers the NMI wrote: {hofs, vofs} */
    this.scrollRegs = null;
    /** ★ STAT77 bit 7 of the last frame as the PPU reports it — the model's PPU tells (time over) */
    this.timeOver = false;
    this.rangeOver = false;
    /** the lag model (`app/frameBudget.js`), when the worker runs one; the tools replay the recorded lag */
    this.budget = null;
    /** the sprite limits of the OAM the last NMI sent (`snesSpriteLimits`), when the worker computes them */
    this.spriteLimits = null;
    /** the spawn list entries by address, from waves.json */
    this.spawnEntries = {};
    for (var s = 0; s < data.waves.sections.length; s++) {
      var sec = data.waves.sections[s];
      for (var i = 0; i < sec.entries.length; i++) {
        this.spawnEntries[sec.spawnList+12*i] = sec.entries[i];
      }
    }
    this.installKernelCode();
  } // constructor

  static bytes(text) {
    var raw = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) {
      out[i] = raw.charCodeAt(i) & 0xFF;
    }
    return out;
  } // bytes

  // ------------------------------------------------------------------ memory

  r8(a) { return this.ram[a & 0xFFFF]; }
  r16(a) { return this.ram[a & 0xFFFF] | (this.ram[(a+1) & 0xFFFF] << 8); }
  w8(a, v) { this.ram[a & 0xFFFF] = v & 0xFF; }
  w16(a, v) { this.ram[a & 0xFFFF] = v & 0xFF; this.ram[(a+1) & 0xFFFF] = (v >> 8) & 0xFF; }
  /** a 16-bit add into RAM */
  add16(a, v) { this.w16(a, this.r16(a)+v); }

  /** a byte of bank $04 at a 16-bit address ($8000-$FFFF) */
  d8(a) { return this.bank04[(a-0x8000) & 0x7FFF]; }
  d16(a) { return this.bank04[(a-0x8000) & 0x7FFF] | (this.bank04[(a-0x8000+1) & 0x7FFF] << 8); }
  /** a signed byte / word */
  static s8(v) { return (v & 0x80) ? v-0x100 : v; }
  static s16(v) { return (v & 0x8000) ? v-0x10000 : v; }

  // ---------------------------------------------------------------- the reset

  /**
   * `reset` `$00:8000`-`$00:81B9`: the RAM zeroed, the roots of the task
   * list from `$04:8000`, the pool of 80 nodes, the NMI job ring, the
   * layers, the font, the palette animation table, palette set 0. The PPU
   * registers of the reset are `data/screen.json` (M1); the SPC driver is
   * M6.
   */
  reset() {
    this.ram.fill(0);
    this.w16(0xFE, 0xAA55);
    // L_0080DF: the root tasks
    var y = 0x8000;
    for (;;) {
      var x = this.d16(y);
      this.w16(x+3, this.d16(y+2));
      this.w8(x+5, this.d8(y+4));
      this.w8(x+2, 0);
      var next = this.d16(y+5);
      this.w16(x, next);
      if (next == 0x1586) {
        break;
      }
      y += 5;
    }
    this.w16(0x1586, 0);
    this.w8(0x1588, 0);
    // L_008112: the pool
    this.w16(0x22, 0x50);
    this.w16(0x24, 0x0180);
    for (var n = 0x0180; n < 0x1540; n += 0x40) {
      this.w16(n, n+0x40);
    }
    this.w16(0x26, 0x1540);
    // the NMI job ring
    this.w16(0x1801, 0x8711);
    this.w8(0x1803, 0);
    this.w16(0x2C, 0);
    this.w16(0x28, 0x2000);
    this.w16(0x2A, 0x2000);
    this.mapQueueReset();
    this.w16(0x68, 0);
    // the layers' map bases and sizes
    this.w16(0x1832, 0); this.w16(0x1834, 0x1000); this.w16(0x1836, 0); this.w16(0x1838, 0);
    this.w16(0x1862, 0x1000); this.w16(0x1864, 0x1000); this.w16(0x1866, 0); this.w16(0x1868, 0);
    this.w16(0x1892, 0x5C00); this.w16(0x1894, 0x0400); this.w16(0x1896, 0); this.w16(0x1898, 0);
    this.paletteAnimInit();
    this.loadBgPalettes(0);
    this.w16(0x4C, 0);
    this.w8(0x80, 0);
    this.w8(0x82, 0x81);
    this.frameFlagsFrame = false;
  } // reset

  // --------------------------------------------------------------- the tasks

  /**
   * `S_00875D` / `S_00876E` / `S_00877F` (`task_new`): a child of node `x`
   * running `code` (24-bit). The limits: `S_00875D` needs 16 free nodes,
   * `S_00876E` 8, `S_00877F` one. ★ The child is linked right after its
   * parent, so it runs before the parent's older children and still in
   * the pass it was spawned in.
   * @param {number} x - The parent node.
   * @param {number} code - The 24-bit code address.
   * @param {number} limit - 0, 8 or 16 free nodes required.
   * @returns {number} The new node, or -1 (the carry) when none was free.
   */
  spawn(x, code, limit) {
    var free = this.r16(0x22);
    if (limit ? free < limit : free == 0) {
      return -1;
    }
    var y = this.r16(0x24);
    free--;
    this.w16(0x22, free);
    if (free != 0) {
      this.w16(0x24, this.r16(y));
    }
    this.w16(y+8, x);
    this.w16(y, this.r16(x));
    this.w16(x, y);
    this.w16(y+3, code & 0xFFFF);
    this.w16(y+0x18, 0xFFFF);
    this.w16(y+6, 0);
    this.w8(y+0xA, 0);
    this.w8(y+0xF, 0);
    this.w8(y+5, (code >> 16) & 0xFF);
    var depth = (this.r8(x+2)+1) & 0xFF;
    // (a depth of 0 would be a root's parent — never happens, $00:87CF uncovered)
    this.w8(y+2, depth);
    return y;
  } // spawn

  /**
   * `L_0087DF`: kills the descendants of node `x` (the nodes after it that
   * are deeper), keeping `x`. Frees their palette slots.
   * @param {number} x - The node.
   */
  killChildren(x) {
    var depth = this.r8(x+2);
    var y = this.r16(x);
    if (this.r8(y+2) <= depth) {
      return;
    }
    this.freeChain(x, y, depth);
  } // killChildren

  /**
   * `L_008806`: kills node `x` and its descendants — the usual end of a
   * task. The list continues at the node before it (`$1A`).
   * @param {number} x - The node.
   */
  kill(x) {
    var depth = this.r8(x+2);
    if (depth == 0) {
      return;   // a root (L_008812 uncovered)
    }
    // ★ the chain ends at the first node not deeper than x (its next sibling or an ancestor's)
    this.freeChain(this.r16(0x1A), x, depth);
  } // kill

  /**
   * `L_008827`: the nodes from `first` on, while deeper than `depth`, are
   * unlinked after `before` and appended to the free list.
   */
  freeChain(before, first, depth) {
    var count = 0;
    var x = first;
    var y;
    for (;;) {
      count++;
      this.freePaletteSlot(this.r8(x+0x18));
      this.freePaletteSlot(this.r8(x+0x19));
      this.w16(x+6, 0);
      y = this.r16(x);
      if (this.r8(y+2) <= depth) {
        break;
      }
      x = y;
    }
    this.w16(before, y);
    this.w16(0x18, before);
    var free = this.r16(0x22);
    if (free == 0) {
      // L_00885A uncovered: the free list was empty — the head is the first freed node
      this.w16(0x24, first);
    }
    this.w16(0x22, free+count);
    this.w16(this.r16(0x26), first);
    this.w16(0x26, x);
  } // freeChain

  /**
   * `L_01804A` and its many copies: a task waits until it has no children
   * (the next node is not deeper).
   * @param {number} x - The node.
   * @returns {boolean} True when no child is left.
   */
  childrenDone(x) {
    var y = this.r16(x);
    return this.r8(y+2) <= this.r8(x+2);
  } // childrenDone

  /** sets the state (16-bit code in the node's bank) a task continues with */
  setState(x, code) {
    this.w16(x+3, code);
  } // setState

  // ------------------------------------------------------------ the NMI jobs

  /**
   * `S_008731`: queues the 16-byte job record the caller built at `$1811`
   * (code at +0, arguments after) into the ring at `$2000`.
   */
  queueJob() {
    var n = this.r16(0x2C);
    if (n >= 0x20) {
      // L_008750: the ring is full — the original jumps through [$F5]: never happened
      return;
    }
    this.w16(0x2C, n+1);
    var y = this.r16(0x2A);
    for (var i = 0; i < 16; i++) {
      this.w8(y+i, this.r8(0x1811+i));
    }
    this.w16(0x2A, (y+16) & 0xFDFF);
  } // queueJob

  /** `L_008703`: the running job is done — the next NMI pulls the next one */
  jobDone() {
    this.w16(0x1801, 0x8711);
    this.w8(0x1803, 0);
  } // jobDone

  /** `L_008711`: the NMI's entry when no job runs: pulls the next job and runs it */
  jobNext() {
    var n = this.r16(0x2C);
    if (n == 0) {
      return;
    }
    this.w16(0x2C, n-1);
    var y = this.r16(0x28);
    for (var i = 0; i < 16; i++) {
      this.w8(0x1801+i, this.r8(y+i));
    }
    this.w16(0x28, (y+16) & 0xFDFF);
    this.runJob();
  } // jobNext

  /** `JML [$1801]`: runs the current job */
  runJob() {
    var code = this.r16(0x1801) | (this.r8(0x1803) << 16);
    if (code == 0x008711) {
      this.jobNext();
      return;
    }
    var fn = this.jobs[code];
    if (!fn) {
      throw new Error('GameKernel: NMI job $'+code.toString(16)+' is not carried over');
    }
    fn.call(this, 0x1801);
  } // runJob

  /**
   * `S_008878`: a job that, when its turn in the queue comes, moves task
   * `x` to state `code` — a task waiting for the queued jobs before it.
   * @param {number} x - The node.
   * @param {number} code - The 24-bit code.
   */
  queueStateJob(x, code) {
    this.w16(0x1811, 0x88B0);
    this.w8(0x1813, 0);
    this.w16(0x1815, code & 0xFFFF);
    this.w8(0x1817, (code >> 16) & 0xFF);
    this.w16(0x1819, x);
    this.queueJob();
  } // queueStateJob

  /**
   * `S_008938` / `S_0089B1`: a job printing (or erasing) the text record
   * at the 24-bit address `rec` — in bank $04 for every record of the game.
   * @param {number} rec - The record.
   * @param {boolean} erase - Erase instead of print.
   */
  queueText(rec, erase) {
    this.w16(0x1811, erase ? 0x89D3 : 0x895A);
    this.w8(0x1813, 0);
    this.w16(0x1815, rec & 0xFFFF);
    this.w8(0x1817, (rec >> 16) & 0xFF);
    this.queueJob();
  } // queueText

  /**
   * `S_009647` / `S_00964C` / `S_009651`: a job clearing the map of a layer
   * (BG1 `$1832`, BG2 `$1862`, BG3 `$1892`) in VRAM, 256 words an NMI.
   * @param {number} layer - The layer object.
   */
  queueMapClear(layer) {
    this.w16(0x1811, 0x9675);
    this.w8(0x1813, 0);
    this.w16(0x1815, 0);
    this.w16(0x1817, layer);
    this.queueJob();
  } // queueMapClear

  /** the jobs of bank $00 */
  installKernelCode() {
    var K = this;
    // L_0088B0: the state job
    this.jobs[0x0088B0] = function (job) {
      var y = K.r16(job+8);
      K.w16(y+3, K.r16(job+4));
      K.w8(y+5, K.r8(job+6));
      K.jobDone();
    };
    // L_00895A / L_0089D3: the text print and erase — one record an NMI, a yield at `at` in yield mode
    this.jobs[0x00895A] = function (job) { K.textJob(job, false); };
    this.jobs[0x0089D3] = function (job) { K.textJob(job, true); };
    // L_009675: the map clear
    this.jobs[0x009675] = function (job) {
      var y = K.r16(job+6);
      K.w16(job+6, K.r16(y));         // the VRAM base of the map
      K.w16(job+8, K.r16(y+2));       // its size in words
      K.w16(job, 0x9693);
      K.jobs[0x009693].call(K, job);
    };
    this.jobs[0x009693] = function (job) {
      var vaddr = K.r16(job+6);
      K.w16(job+6, vaddr+0x100);
      K.vramWrites.push({vaddr: vaddr, fill: K.r16(job+4), count: 0x100});
      var left = (K.r16(job+8)-0x100) & 0xFFFF;
      if (left == 0) {
        K.jobDone();
        return;
      }
      K.w16(job+8, left);
    };
    // the fill tasks of a layer (L_008D1C, L_008D38, L_008D6B)
    this.code[0x008D1C] = function (x) { K.fillTaskFirst(x); };
    this.code[0x008D38] = function (x) { K.fillTaskColumn(x); };
    this.code[0x008D6B] = function (x) { K.kill(x); };
  } // installKernelCode

  /**
   * `L_00895A` / `L_0089D3`: the text job. The record's bytes ≥ $10 are
   * tiles written to the BG3 map at the running VRAM address with the
   * running attribute `$00`; commands 0-7 (`$04:80D1`). In print mode the
   * attribute starts at $2000 (priority), in erase mode every tile becomes
   * $20 (a space) with the attribute. Command 1 (`at`) in yield mode (6)
   * gives the NMI back and the job continues at the next NMI.
   */
  textJob(job, erase) {
    var first = this.r8(job+0xA) == 0 && this.r16(job+8) == 0;
    if (!this.textRunning) {
      // the first NMI of the job: L_00895A
      this.w16(job+8, 0x2000);
      this.textVaddr = this.r16(0x1892);
      this.w16(job, erase ? 0x89EB : 0x8972);
      this.textRunning = true;
    }
    var p = this.r16(job+4) | (this.r8(job+6) << 16);
    var attr = this.r16(job+8);
    this.w8(job+0xA, 0);
    var words = [];
    var vaddr = this.textVaddr;
    for (;;) {
      var b = this.d8(p & 0xFFFF);
      if (b >= 0x10) {
        words.push({vaddr: vaddr, word: (erase ? 0x20 : b) | attr});
        vaddr++;
        p++;
        continue;
      }
      switch (b & 7) {
        case 0:                           // L_008A28: the end
          this.flushText(words);
          this.textRunning = false;
          this.jobDone();
          return;
        case 1:                           // L_008A3F: at — in yield mode the job stops here until the next NMI
          if (this.r8(job+0xA) & 1) {
            this.w16(job+4, p & 0xFFFF);
            this.w8(job+6, (p >> 16) & 0xFF);
            this.w16(job+8, attr);
            this.flushText(words);
            this.textVaddr = vaddr;
            return;
          }
          p++;
          vaddr = this.d16(p & 0xFFFF);
          p += 2;
          continue;
        case 2:                           // L_008A53: palette
          p++;
          attr = (attr & 0xE3FF) | (this.d16(p & 0xFFFF) & 0x1C00);
          p += 2;
          continue;
        case 3:                           // L_008A68: tile bits 7-9
          p++;
          attr = (attr & 0xFC7F) | ((this.d16(p & 0xFFFF) & 0x0700) >> 1);
          p += 2;
          continue;
        case 4: p++; attr |= 0x2000; continue;          // ? priority on ($04:80D1 handlers 4/5 — $00:8A7E uncovered)
        case 5: p++; attr &= ~0x2000; continue;
        case 6: p++; this.w8(job+0xA, 1); continue;     // yield mode
        default:                                        // 7: count + raw tiles (uncovered)
          p++;
          var n = this.d8(p & 0xFFFF);
          p++;
          for (var i = 0; i < n; i++) {
            words.push({vaddr: vaddr++, word: this.d8((p++) & 0xFFFF) | attr});
          }
          continue;
      }
    }
  } // textJob

  flushText(words) {
    if (words.length) {
      this.vramWrites.push({text: words});
    }
  } // flushText

  // ------------------------------------------------------- the level glue

  /**
   * `S_008B4D` (`load_level_record`): the record of section `index` into
   * `$1821`-`$182E` and the layer objects — `app/levelScroll.js` keeps the
   * layers; the RAM gets what the tasks and the spawner read.
   * @param {number} index - The section.
   */
  loadLevelRecord(index) {
    var sec = this.level.sectionData(index);
    this.level.loadRecord(index);
    this.w16(0x1821, sec.flags);
    this.w16(0x1823, sec.spawnList & 0xFFFF);
    this.w16(0x1825, sec.scrollEnd);
    this.w16(0x1827, sec.scrollSpeed);
    this.w16(0x1829, sec.sceneTable & 0xFFFF);
    this.w16(0x1854, 0);
    this.w16(0x1884, 0x1000);
    this.w16(0x182D, sec.sceneTable & 0xFFFF);
    this.w16(0x46, (sec.flags & 4) ? 0x1862 : 0x1832);
    this.w8(0x94, sec.bank);
  } // loadLevelRecord

  /**
   * `S_008BC3` (`scene_start`): the scene at `$182D`, the scroll and the
   * spawn pointer.
   */
  sceneStart() {
    var scene = this.level.sceneAt(this.r16(0x182D));
    this.level.startScene(scene);
    this.w8(0x182F, 0);
    this.w16(0x1830, scene.scroll);
    // L_008C14: the spawn pointer stays at the list's start unless the scene starts past the first entry
    var p = this.r16(0x1823);
    var e = this.spawnEntries[(this.r8(0x94) << 16) | p];
    if (!e || scene.scroll <= e.scroll) {
      this.w16(0x182B, p);
    } else {
      // $00:8C26 uncovered: a later scene start — the pointer would be advanced
      this.w16(0x182B, p);
    }
  } // sceneStart

  /**
   * `S_008C35` (`layer_init_dispatch`): the layer's kind picks its init;
   * the fill kinds spawn the fill task (`L_008C70`, a child of the caller).
   * @param {number} x - The calling task (the fill task's parent).
   * @param {number} layerBase - `$1832` or `$1862`.
   */
  layerInit(x, layerBase) {
    var l = this.level.layers[layerBase == 0x1862 ? 1 : 0];
    if (this.level.initLayer(l, true)) {
      var y = this.spawn(x, 0x008D1C, 0);
      if (y >= 0) {
        this.w16(y+0x30, layerBase);
        this.w16(y+0x32, LevelScroll.FIRST_COLUMNS);
      }
    }
  } // layerInit

  /**
   * `S_008CBA`: the layer at `layerBase` from the 16-byte record at `rec`
   * (bank $04) and a fill task of the record's columns, a child of `x`.
   */
  layerFromRecord(x, layerBase, rec) {
    var l = this.level.layers[layerBase == 0x1862 ? 1 : 0];
    var bytes = [];
    for (var i = 0; i < 16; i++) {
      bytes.push(this.d8(rec+i));
    }
    var columns = this.level.layerFromRecord(l, bytes);
    var y = this.spawn(x, 0x008D1C, 0);
    if (y >= 0) {
      this.w16(y+0x30, layerBase);
      this.w16(y+0x32, columns);
    }
  } // layerFromRecord

  /** `L_008D1C`: the fill task's first pass computes the first block's address */
  fillTaskFirst(x) {
    var l = this.level.layers[this.r16(x+0x30) == 0x1862 ? 1 : 0];
    this.w16(x+0x34, LevelScroll.blockAddress(l.lastColumn, l.lastRow));
    this.setState(x, 0x8D38);
  } // fillTaskFirst

  /** `L_008D38`: one stream column a pass */
  fillTaskColumn(x) {
    var l = this.level.layers[this.r16(x+0x30) == 0x1862 ? 1 : 0];
    var before = this.level.queue.length;
    this.level.enqueueColumn(l, this.r16(x+0x34));
    this.mapQueueMirror(this.level.queue.length-before, 0);
    if (this.budget) {
      this.budget.blocks(l.blocks);
    }
    var left = (this.r16(x+0x32)-1) & 0xFFFF;
    this.w16(x+0x32, left);
    if (left == 0) {
      this.setState(x, 0x8D6B);
      return;
    }
    this.w16(x+0x34, LevelScroll.blockRight(this.r16(x+0x34)));
  } // fillTaskColumn

  /** `S_008D6F` + `S_008D9C`: the scroll and the layers of a pass; the RAM mirrors $182F-$1831 */
  scrollStep() {
    var before = this.level.queue.length;
    this.level.advanceScroll();
    this.level.stepLayers();
    this.mapQueueMirror(this.level.queue.length-before, 0);
    this.w8(0x182F, this.level.scrollFrac);
    this.w16(0x1830, this.level.scroll);
  } // scrollStep

  /** `map_queue_reset` `$00:9161`: the ring's count and both pointers */
  mapQueueReset() {
    this.level.queue = [];
    this.w16(0x2E, 0);
    this.w16(0x30, 0x5160);
    this.w16(0x32, 0x5160);
  } // mapQueueReset

  /**
   * The ring's pointers `$30` (read) / `$32` (write) after `n` entries
   * were queued (`map_enqueue_a`: +$22, wrapping at `$59E0`) and `m`
   * drawn (`nmi_draw_metatile`).
   */
  mapQueueMirror(queued, drawn) {
    var w = this.r16(0x32), r = this.r16(0x30);
    for (var i = 0; i < queued; i++) {
      w += 0x22;
      if (w >= 0x59E0) {
        w = 0x5160;
      }
    }
    for (var j = 0; j < drawn; j++) {
      r += 0x22;
      if (r >= 0x59E0) {
        r = 0x5160;
      }
    }
    this.w16(0x32, w);
    this.w16(0x30, r);
    this.w16(0x2E, this.level.queue.length);
  } // mapQueueMirror

  // ---------------------------------------------------------- the collision

  /**
   * `S_0095D8`: does the object `x`, offset by (`$42`, `$44`), touch the
   * terrain? The collision nibble of BG1 (when the level says BG1 has
   * collision) and of BG2, at the object's screen position plus the
   * layer's position.
   * @param {number} x - The node.
   * @returns {boolean} The carry: hit.
   */
  terrainHit(x) {
    var flags = this.r16(0x1821);
    if (flags & 1) {
      if (this.level.collision[(this.collisionAddress(x, 0)+0x0000) & 0x1FFF]) {
        this.hitLayer = 0x1832;
        return true;
      }
    }
    if (flags & 2) {
      if (this.level.collision[(this.collisionAddress(x, 1)+0x1000) & 0x1FFF]) {
        this.hitLayer = 0x1862;
        return true;
      }
    }
    // (Y is left at the last layer tested: BG2 when the level has its collision, else BG1)
    this.hitLayer = (flags & 2) ? 0x1862 : 0x1832;
    return false;
  } // terrainHit

  /**
   * `S_00973D` (`collision_address`): the collision map index of the
   * object's point (+$1A, +$1C) + (`$42`, `$44`) in the layer's map.
   * @param {number} x - The node.
   * @param {number} layer - 0 or 1.
   * @returns {number} The index (0-$FFF within the layer's map).
   */
  collisionAddress(x, layer) {
    var l = this.level.layers[layer];
    // ★ the carries chain: screen x + the layer's x, then + the offset with the carry
    var v = this.r16(x+0x1A)+((l.x >> 8) & 0xFFFF);
    var c = v >> 16;
    v = (v & 0xFFFF)+this.r16(0x42)+c;
    var px = (v-0x200) & 0xFFFF;
    var col = ((px & 0xFF) >> 3)+((px & 0x100) << 2);
    c = col >> 16;
    v = this.r16(x+0x1C)+((l.y >> 8) & 0xFFFF)+c;
    c = v >> 16;
    v = (v & 0xFFFF)+this.r16(0x44)+c;
    var py = (v-0x200) & 0xFFFF;
    var row = ((py & 0xF8) << 2)+((py & 0x100) << 3);
    return (row+col) & 0xFFFF;
  } // collisionAddress

  // ------------------------------------------------------------- the sprites

  /**
   * `S_009822` / `S_00984B`: an entry of sprite group 1 for object `x`
   * with metasprite `meta` — at the front (`$6E` moves back) or at the
   * back (`$70` moves on). `S_009874` / `S_00989C` the same for group 2.
   * @param {number} x - The node.
   * @param {number} meta - The metasprite address in bank $04.
   * @param {number} group - 1 or 2.
   * @param {boolean} back - At the back of the group.
   */
  addSprite(x, meta, group, back) {
    var y;
    if (group == 1) {
      if (this.r16(0x6C) == 0x30) {
        return;   // the group is full ($00:982B uncovered)
      }
      if (back) {
        y = this.r16(0x70);
        var next = y+12;
        if (next >= 0x2AE0) {
          next = 0x28A0;   // ($00:986A uncovered)
        }
        this.w16(0x70, next);
      } else {
        y = this.r16(0x6E)-12;
        if (y < 0x28A0) {
          y = 0x2AD4;
        }
        this.w16(0x6E, y);
      }
      this.w16(0x6C, this.r16(0x6C)+1);
    } else {
      if (this.r16(0x72) == 0x60) {
        return;
      }
      if (back) {
        y = this.r16(0x76);
        var n2 = y+12;
        if (n2 >= 0x2F60) {
          n2 = 0x2AE0;
        }
        this.w16(0x76, n2);
      } else {
        y = this.r16(0x74)-12;
        if (y < 0x2AE0) {
          y = 0x2F54;
        }
        this.w16(0x74, y);
      }
      this.w16(0x72, this.r16(0x72)+1);
    }
    // L_0098C2
    this.w16(y+4, meta);
    this.w16(y, this.r16(x+0x1A));
    this.w16(y+2, this.r16(x+0x1C));
    this.w16(y+0xA, this.r16(x+0x20));
    // ★ a 16-bit load at +$17 (or +$18 with bit 5 of +6): the palette slot of +$18 (+$19) lands in the
    // high byte, so the attribute's palette bits are the slot shifted left once
    var word = (this.r16(x+6) & 0x20) ? this.r16(x+0x18) : this.r16(x+0x17);
    this.w16(y+8, (word << 1) & 0x0E00);
  } // addSprite

  /** the objects of a group as `ObjectSprites.drawPass` takes them, in list order from `first` */
  groupObjects(first, count, lo, hi) {
    var out = [];
    var y = first;
    for (var i = 0; i < count; i++) {
      var slots = this.r16(y+0xA);
      out.push({x: this.r16(y), y: this.r16(y+2), metasprite: 0x040000 | this.r16(y+4), attr: this.r16(y+8),
                // ★ the view runs past the table's 32 bytes: boss 6's spike shot (metasprite $C425, tile $20) indexes
                // the 33rd entry and the original reads the first byte of the next table — kept
                slots: slots ? this.ram.subarray(slots, slots+256) : null});
      y += 12;
      if (y >= hi) {
        y = lo;
      }
    }
    return out;
  } // groupObjects

  /**
   * `S_0098F2` (`draw_all_sprites`): the two groups into the OAM shadow
   * `$2200` and the high table, group 2 backwards when the last frame
   * overflowed and the pass is odd (`app/objectSprites.js`).
   */
  drawAllSprites() {
    var g1 = this.groupObjects(this.r16(0x6E), this.r16(0x6C), 0x28A0, 0x2AE0);
    var g2 = this.groupObjects(this.r16(0x74), this.r16(0x72), 0x2AE0, 0x2F60);
    this.drawnEntries = 0;
    if (this.sprites.drawPass(g1, g2, (this.r8(0xF4) & 0x80) != 0, this.r16(0x50))) {
      this.w16(0x7E, this.sprites.index & 0xFFFF);
      this.drawnEntries = Math.max(0, Math.min(128, (0x1FC-this.sprites.index)/4));
    }
    // the loops count the groups down to nothing
    this.w16(0x6C, 0);
    this.w16(0x72, 0);
  } // drawAllSprites

  /**
   * `draw_object_sprites`' record format decoded from bank $04 (as
   * `tools/srtlib.py` `metasprite`): a count and parts of dx, dy and a
   * tile word, or a layout byte ≥ $80 (`$04:81FB`: one, a row of 2-4, a
   * 2×2 square) with one dx, dy and the tile words.
   * @param {number} address - 24-bit address in bank $04.
   * @returns {Object} {parts: [{dx, dy, tile}]}.
   */
  metasprite(address) {
    if (!this.metasprites) {
      this.metasprites = {};
    }
    var cached = this.metasprites[address];
    if (cached) {
      return cached;
    }
    var a = address & 0xFFFF;
    var head = this.d8(a);
    var parts = [];
    var i;
    if (head & 0x80) {
      var lay = head & 0x0E;
      var n = [1, 2, 3, 4, 4, 1, 1, 1][lay >> 1];
      var dx = GameKernel.s8(this.d8(a+1)), dy = GameKernel.s8(this.d8(a+2));
      for (i = 0; i < n; i++) {
        var t = this.d16(a+3+2*i);
        if (lay == 8) {
          parts.push({dx: dx+16*(i & 1), dy: dy+16*(i >> 1), tile: t});
        } else {
          parts.push({dx: dx+16*i, dy: dy, tile: t});
        }
      }
    } else {
      for (i = 0; i < (head & 0x7F); i++) {
        parts.push({dx: GameKernel.s8(this.d8(a+1+4*i)), dy: GameKernel.s8(this.d8(a+2+4*i)), tile: this.d16(a+3+4*i)});
      }
    }
    var rec = {address: address, parts: parts, decoded: true};
    this.metasprites[address] = rec;
    return rec;
  } // metasprite

  // ------------------------------------------------------------ ship tiles

  /**
   * `S_009B66` (`ship_tile_copy`): one 32-byte tile of `$05:B300` (tile
   * `a`) into the ship's buffer `$7E:24A0` at slot `$00`. `S_009B89`
   * copies a 16×16 group: two tiles and the two below them.
   * @param {number} a - The tile number.
   * @param {boolean} big - The 2×2 group.
   */
  shipTileCopy(a, big) {
    var src = (a << 5) & 0xFFFF;
    var dst = ((this.r16(0) << 5)+0x24A0) & 0xFFFF;
    var ship = this.data.tiles.ship;
    if (!this.shipTileData) {
      this.shipTileData = GameKernel.bytes(ship.data);
    }
    var n = big ? 64 : 32;
    for (var i = 0; i < n; i++) {
      this.ram[(dst+i) & 0xFFFF] = this.shipTileData[(src+i) & 0xFFFF];
    }
    if (big) {
      // ★ the second row of the 16×16 group: MVN left X and Y 64 on, +$1C0 more = the next tile row ($200)
      for (var j = 0; j < 64; j++) {
        this.ram[(dst+0x200+j) & 0xFFFF] = this.shipTileData[(src+0x200+j) & 0xFFFF];
      }
    }
  } // shipTileCopy

  // ---------------------------------------------------- dynamic sprite sets

  /** `S_009BBE`: every slot of the eight free ($1CAC = $FFFF) */
  spriteSlotsReset() {
    for (var i = 0; i < 8; i++) {
      this.w16(0x1CAC+2*i, 0xFFFF);
    }
  } // spriteSlotsReset

  /**
   * `S_009BD4`: the slot table of the set `id` (the first slot holding
   * it, or the ninth when none does — $00:9BE8 uncovered).
   * @param {number} id - The set id.
   * @returns {number} The address of the slot table (`$1CBC + 32·slot`).
   */
  spriteSlotTable(id) {
    var slot = 0;
    while (slot < 8 && this.r16(0x1CAC+2*slot) != id) {
      slot++;
    }
    return 0x1CBC+32*slot;
  } // spriteSlotTable

  /**
   * `S_009BF5` (`sprite_set_load`): the record at `rec` (bank $04: id,
   * 3-byte source, slot numbers to $FF) into slot `slot`: the slot table
   * gets the slot numbers, the groups of 128 B go into the upload buffer
   * `$59E0` for the NMI (`$68` groups, 4 an NMI).
   * @param {number} slot - 0-7.
   * @param {number} rec - The record address (16-bit, bank $04).
   */
  spriteSetLoad(slot, rec) {
    var id = this.d16(rec);
    if (this.r16(0x1CAC+2*slot) == id) {
      return;
    }
    this.w16(0x1CAC+2*slot, id);
    var table = 0x1CBC+32*slot;
    var src = this.d16(rec+2) | (this.d8(rec+4) << 16);
    var n = 0;
    var p = rec+5;
    while (this.d8(p) != 0xFF) {
      this.w8(table+n, this.d8(p));
      n++;
      p++;
    }
    // L_009C3D: the groups into the buffer: VRAM address then 64 words from the source
    var set = this.data.tiles.spriteSets.records[String(src)];
    var bytes = set ? (set.bytes || (set.bytes = GameKernel.bytes(set.data))) : null;
    var out = 0x59E0;
    for (var g = 0; g < n; g++) {
      this.w16(out, 0x7000+(this.w8nib(table+g) << 4));
      out += 2;
      for (var w = 0; w < 64; w++) {
        var o = 128*g+2*w;
        this.w16(out, bytes ? (bytes[o] | (bytes[o+1] << 8)) : 0);
        out += 2;
      }
    }
    this.w16(0x6A, 0x59E0);
    this.w16(0x68, n);
    if (this.budget) {
      this.budget.groups(n);
    }
  } // spriteSetLoad

  w8nib(a) { return this.ram[a & 0xFFFF]; }

  // ------------------------------------------------------------- hit boxes

  /**
   * `S_009E39`: the box of object `x` with the table `tbl` (x0, y0 signed
   * words, w, h bytes — bank $04) into `$34`-`$3A` (x0, x1, y0, y1).
   */
  hitBox(x, tbl) {
    // ★ one CLC for the whole routine: every ADC after the first takes the carry of the one before
    // (a negative x0 of the table carries into the screen x — the box is one pixel further right)
    var v = this.d16(tbl)+0x200;
    var c = v >> 16;
    v = (v & 0xFFFF)+this.r16(x+0x1A)+c;
    c = v >> 16;
    var x0 = v & 0xFFFF;
    this.w16(0x34, x0);
    v = this.d8(tbl+4)+x0+c;
    c = v >> 16;
    this.w16(0x36, v & 0xFFFF);
    v = this.d16(tbl+2)+0x200+c;
    c = v >> 16;
    v = (v & 0xFFFF)+this.r16(x+0x1C)+c;
    c = v >> 16;
    var y0 = v & 0xFFFF;
    this.w16(0x38, y0);
    v = this.d8(tbl+5)+y0+c;
    this.w16(0x3A, v & 0xFFFF);
  } // hitBox

  /** `S_009C7D`: the ship's box into `$16EB`-`$16F1` (x1, x0, y1, y0) */
  shipBox(x, tbl) {
    this.hitBox(x, tbl);
    this.w16(0x16EB, this.r16(0x36));
    this.w16(0x16ED, this.r16(0x34));
    this.w16(0x16EF, this.r16(0x38));
    this.w16(0x16F1, this.r16(0x3A));
  } // shipBox

  /**
   * `S_009C95`: a player's shot registers its box in the list at `$1992`
   * (12 B entries, `$3E` the end, at most 64) with its kind `kind` and node.
   */
  shotBox(x, kind, tbl) {
    var y = this.r16(0x3E);
    if (y == 0x300) {
      return;
    }
    this.hitBox(x, tbl);
    this.w16(0x199A+y, kind);
    this.w16(0x199C+y, x);
    this.w16(0x1992+y, this.r16(0x34));
    this.w16(0x1994+y, this.r16(0x36));
    this.w16(0x1996+y, this.r16(0x38));
    this.w16(0x1998+y, this.r16(0x3A));
    this.w16(0x3E, y+12);
  } // shotBox

  /**
   * `S_009CC8`: does the box of object `x` (table `tbl`) overlap the
   * ship's box? `S_009D13` the same, and a hit marks `$158F` bit 7.
   * @returns {boolean} The carry.
   */
  touchesShip(x, tbl, mark) {
    this.hitBox(x, tbl);
    if (this.r16(0x16ED) >= this.r16(0x36) || this.r16(0x16EB) < this.r16(0x34)
        || this.r16(0x16EF) >= this.r16(0x3A) || this.r16(0x16F1) < this.r16(0x38)) {
      return false;
    }
    if (mark) {
      this.w16(0x158F, this.r16(0x158F) | 0x80);
    }
    return true;
  } // touchesShip

  // --------------------------------------------------------- object helpers

  /** `S_009E65`: screen x/y of object `x` from its position (− 512) */
  objectScreen(x) {
    this.w16(x+0x1A, this.r16(x+0xB)-0x200);
    this.w16(x+0x1C, this.r16(x+0x10)-0x200);
  } // objectScreen

  /**
   * The words a layer record holds at +$1B (x) and +$1E (y) — the two the
   * original reads off whatever `Y` points at. For `$1832` / `$1862` they
   * come from the scroll model; ★ any other base is a task node used as a
   * layer by a slip of the original (`L_01FF01`), read from WRAM as is.
   * @param {number} base - The layer record (or node).
   * @returns {number[]} `[x, y]` words.
   */
  layerWords(base) {
    if (base == 0x1832 || base == 0x1862) {
      var l = this.level.layers[base == 0x1862 ? 1 : 0];
      return [(l.x >> 8) & 0xFFFF, (l.y >> 8) & 0xFFFF];
    }
    return [this.r16(base+0x1B), this.r16(base+0x1E)];
  } // layerWords

  /** `S_009E7A`: screen x/y relative to the object's layer (+$1E) */
  objectScreenLayer(x) {
    var l = this.layerWords(this.r16(x+0x1E));
    this.w16(x+0x1A, this.r16(x+0xB)-l[0]);
    this.w16(x+0x1C, this.r16(x+0x10)-l[1]);
  } // objectScreenLayer

  /** `S_009E92`: screen x/y = the parent's screen x/y + own position */
  objectScreenParent(x) {
    var y = this.r16(x+8);
    this.w16(x+0x1A, this.r16(y+0x1A)+this.r16(x+0xB));
    this.w16(x+0x1C, this.r16(y+0x1C)+this.r16(x+0x10));
  } // objectScreenParent

  /** `S_009EAA`: position from screen x/y (+ 512) */
  objectFromScreen(x) {
    this.w16(x+0xB, this.r16(x+0x1A)+0x200);
    this.w16(x+0x10, this.r16(x+0x1C)+0x200);
  } // objectFromScreen

  /** `S_009EBF`: the object binds to the default layer `$46` and its position = screen + the layer's */
  objectBindLayer(x) {
    this.w16(x+0x1E, this.r16(0x46));
    this.objectFromLayer(x, this.r16(0x46));
  } // objectBindLayer

  /** `S_009EC5`: position = screen x/y + the layer's position */
  objectFromLayer(x, layerBase) {
    var l = this.layerWords(layerBase);
    this.w16(x+0xB, this.r16(x+0x1A)+l[0]);
    this.w16(x+0x10, this.r16(x+0x1C)+l[1]);
  } // objectFromLayer

  /** `S_009EDA`: x += speed x, 8.8 signed (the sign byte of +$E extends) */
  moveXSigned(x) {
    var sp = this.r16(x+0xD);
    var v = (this.r8(x+0xA) | (this.r16(x+0xB) << 8))+GameKernel.s16(sp);
    this.w8(x+0xA, v);
    this.w16(x+0xB, v >> 8);
  } // moveXSigned

  /** `S_009EFF`: x += speed x, 8.8 unsigned */
  moveX(x) {
    var v = (this.r8(x+0xA) | (this.r16(x+0xB) << 8))+this.r16(x+0xD);
    this.w8(x+0xA, v);
    this.w16(x+0xB, v >> 8);
  } // moveX

  /** `S_009F1E`: x -= speed x */
  moveXBack(x) {
    var v = (this.r8(x+0xA) | (this.r16(x+0xB) << 8))-this.r16(x+0xD);
    this.w8(x+0xA, v);
    this.w16(x+0xB, v >> 8);
  } // moveXBack

  /** `S_009F3D`: y += speed y, signed */
  moveYSigned(x) {
    var sp = this.r16(x+0x12);
    var v = (this.r8(x+0xF) | (this.r16(x+0x10) << 8))+GameKernel.s16(sp);
    this.w8(x+0xF, v);
    this.w16(x+0x10, v >> 8);
  } // moveYSigned

  /** `S_009F62`: y += speed y */
  moveY(x) {
    var v = (this.r8(x+0xF) | (this.r16(x+0x10) << 8))+this.r16(x+0x12);
    this.w8(x+0xF, v);
    this.w16(x+0x10, v >> 8);
  } // moveY

  /** `S_009F81`: y -= speed y */
  moveYBack(x) {
    var v = (this.r8(x+0xF) | (this.r16(x+0x10) << 8))-this.r16(x+0x12);
    this.w8(x+0xF, v);
    this.w16(x+0x10, v >> 8);
  } // moveYBack

  /**
   * `S_00A0D9`: a hit flash — `a` passes of the blink (bit 5 of +6 toggles),
   * at the end the bit clears. Called with A = the count.
   */
  blink(x, a) {
    a = (a-1) & 0xFFFF;
    this.w16(x+0x24, a);
    if (a == 0) {
      this.w16(x+6, this.r16(x+6) & 0xFFDF);
    } else {
      this.w16(x+6, this.r16(x+6) ^ 0x20);
    }
  } // blink

  // -------------------------------------------------------- object scripts

  /**
   * `S_009FA0` (`script_start`): an object script in bank $06 — a list
   * of words: a count of passes (< $7FE0) to repeat the next move record,
   * a move record (bit 15: a list of direction bytes for `$2E,X` passes
   * each…), $7FE0-$7FFF a handler of `$06:8000,Y`, 0 = jump to the word
   * after. The object keeps +$26 the step handler, +$28 the script
   * pointer, +$2A the running count / record, +$2C/+$2D counters, +$2E the
   * speed (A on entry).
   * ? The scripts move the enemies (M4); the beam's spiral parts use them
   * in M3 (`$01:BDB5`), so the step `L_00A06D` is carried over here.
   */
  scriptStart(x, a, y) {
    this.w16(x+0x2E, a);
    this.w16(x+0x2C, 0);
    this.scriptNext(x, y);
  } // scriptStart

  scriptNext(x, y) {
    var v;
    for (;;) {
      v = this.bank06w(y);
      if (v == 0) {
        y = this.bank06w(y+2);   // L_00A006: jump
        continue;
      }
      y += 2;
      this.w16(x+0x2A, v);
      if (v & 0x8000) {
        this.w16(x+0x26, 0xA06D);
        this.w16(x+0x28, y);
        return;
      }
      if (v >= 0x7FE0) {
        // a handler of the table at $06:8000 + (v & $1E)
        var h = this.bank06w(0x8000+(v & 0x1E));
        if (h == 0x9FE5) {                  // L_009FE5: a byte into +$2D
          this.w8(x+0x2D, this.bank06b(y));
          y++;
          continue;
        }
        if (h == 0x9FF2) {                  // L_009FF2: TSB $8C
          this.w16(0x8C, this.r16(0x8C) | this.bank06w(y));
          y += 2;
          continue;
        }
        if (h == 0xA026) {                  // L_00A026: stop
          this.w16(x+0x2E, 0);
          this.w16(x+0x26, 0xA06B);
          this.w16(x+0x28, y);
          return;
        }
        throw new Error('GameKernel: script handler $'+h.toString(16)+' not carried over');
      }
      this.w16(x+0x26, 0xA063);   // L_009FD6: a wait of v passes
      this.w16(x+0x28, y);
      return;
    }
  } // scriptNext

  /** `S_00A03A` (`script_step`): the running step */
  scriptStep(x) {
    switch (this.r16(x+0x26)) {
      case 0xA063:                 // a wait
        var n = (this.r16(x+0x2A)-1) & 0xFFFF;
        this.w16(x+0x2A, n);
        if (n == 0) {
          this.scriptNext(x, this.r16(x+0x28));
        }
        return;
      case 0xA06B:                 // stopped
        return;
      case 0xA06D:                 // the direction list: +$2C accumulates the speed, each whole step moves by a direction byte
        var acc = (this.r8(x+0x2C)+this.r16(x+0x2E)) & 0xFFFF;
        this.w8(x+0x2C, acc);
        var steps = acc >> 8;
        if (steps == 0) {
          return;
        }
        var y = this.r16(x+0x2A);
        for (;;) {
          var d = this.bank06b(y);
          while (!(d & 0x40)) {
            this.w8(x+0x2D, d);     // L_00A091: a prefix byte
            y++;
            d = this.bank06b(y);
          }
          y++;
          this.w16(x+0x2A, y);
          if (d & 1) {
            this.w16(x+0x10, this.r16(x+0x10)+1);
          } else if (d & 2) {
            this.w16(x+0x10, this.r16(x+0x10)-1);
          }
          if (d & 4) {
            this.w16(x+0xB, this.r16(x+0xB)+1);
          } else if (d & 8) {
            this.w16(x+0xB, this.r16(x+0xB)-1);
          }
          if (d & 0x80) {
            this.scriptNext(x, this.r16(x+0x28));
            return;
          }
          steps--;
          if (steps == 0) {
            return;
          }
        }
      default:
        return;
    }
  } // scriptStep

  /** bank $06: the object scripts (data/ship.json carries bank $06 too when M4 needs it; M3 reads the beam's) */
  bank06b(a) {
    if (!this.bank06) {
      this.bank06 = this.data.ship.bank06 ? GameKernel.bytes(this.data.ship.bank06) : new Uint8Array(0x8000);
    }
    return this.bank06[(a-0x8000) & 0x7FFF];
  } // bank06b

  bank06w(a) { return this.bank06b(a) | (this.bank06b(a+1) << 8); }

  // ------------------------------------------------------------- palettes

  /** `S_00A0F3`: the 16 palette animation entries at `$1902` point at the CGRAM shadow rows */
  paletteAnimInit() {
    var p = 0x2F60;
    for (var i = 0; i < 16; i++) {
      this.w16(0x1902+8*i, 0);
      this.w16(0x1908+8*i, p);
      p += 0x20;
    }
  } // paletteAnimInit

  /**
   * `S_00A14A` (`load_bg_palettes`): palette set `set` of `$04:824B` into
   * CGRAM rows 0-7 (the shadow `$2F60` and the chip); `S_00A118`
   * (`load_obj_palettes`) the set of `$04:82D3` into rows 8-15 and the
   * palette slots `$1982` (number, user count 0 or 1).
   */
  loadBgPalettes(set) {
    this.loadPaletteSet(0x824B+8*(set & 0xFF), 0x1902);
  } // loadBgPalettes

  loadObjPalettes(set) {
    var y = 0x82D3+8*(set & 0xFF);
    for (var i = 0; i < 8; i++) {
      var n = this.d8(y+i);
      this.w8(0x1982+2*i, n);
      this.w8(0x1983+2*i, n == 0xFF ? 0 : 1);
    }
    this.loadPaletteSet(y, 0x1942);
  } // loadObjPalettes

  loadPaletteSet(y, entry) {
    for (var i = 0; i < 8; i++) {
      var n = this.d8(y+i);
      if (n != 0xFF) {
        this.w8(entry, 0);
        var row = this.r16(entry+6);
        this.copyPalette(n, row);
        this.cgramRowWrite(row);
      }
      entry += 8;
    }
  } // loadPaletteSet

  /** `MVN $05,$7E`: palette `n` (32 B of `$05:8000 + 32n`) into the shadow at `row` */
  copyPalette(n, row) {
    var pal = this.data.palettes.palettes[String(n)];
    for (var c = 0; c < 16; c++) {
      var v = pal ? pal[c] : 0;
      this.w16(row+2*c, v);
    }
  } // copyPalette

  /** `S_00A19B` (`cgram_write_row`): the shadow row at `row` into the chip — noted for the model */
  cgramRowWrite(row) {
    this.cgramDirty.add((row-0x2F60) >> 5);
  } // cgramRowWrite

  /**
   * `S_00A1C9` (`palette_animate`): every entry of `$1902` with bits 0-1
   * set (a running animation) moves each colour component of its row
   * towards the target palette (+4 the step, +6 the target in bank $05,
   * +8 the row) on the passes its +3 mask allows; +1 counts the steps
   * down and ends the animation at 0.
   */
  paletteAnimate() {
    this.animStepped = 0;
    for (var i = 0; i < 16; i++) {
      var e = 0x1902+8*i;
      var mode = this.r8(e) & 3;
      if (mode == 0) {
        continue;
      }
      if (mode != 3) {
        this.w8(e, 3);
      }
      if (this.r8(e+3) & this.r8(0x50)) {
        continue;
      }
      this.animStepped++;
      var src = this.r16(e+4);
      var dst = this.r16(e+6);
      var step = this.r8(e+2);
      var target = this.targetPalette(src);
      for (var c = 0; c < 16; c++) {
        var want = target[c];
        var have = this.r16(dst);
        var mask = 0x1F;
        var out = have;
        for (var k = 0; k < 3; k++) {
          var w = want & mask, h = have & mask;
          if (w != h) {
            var nv;
            if (h < w) {
              nv = h+(step << (5*k));
              if (nv >= w) {
                nv = w;
              }
            } else {
              nv = h-(step << (5*k));
              if (nv < 0 || nv < w) {
                nv = w;
              }
            }
            out = (out & ~mask) | nv;
            have = out;
          }
          mask <<= 5;
        }
        this.w16(dst, out);
        dst += 2;
      }
      var left = this.r8(e+1)-step;
      if (left < 0) {
        this.w8(e, 0);
      }
      this.w8(e+1, left & 0xFF);
      this.cgramRowWrite(this.r16(e+6));
    }
  } // paletteAnimate

  /** the target palette the animation reads with [$10] in bank $05 (`$1904` = $8000 + 32n) */
  targetPalette(addr) {
    var pal = this.data.palettes.palettes[String((addr-0x8000) >> 5)];
    return pal || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  } // targetPalette

  /**
   * `S_00A29D` (`palette_slot_load`): the animation of object palette slot
   * `slot` (row 8 + slot) towards palette `$00` with the step of kind `$02`
   * (`$04:835B`); `S_00A2A6` the same for a background row.
   */
  paletteAnimStart(row, n, kind) {
    var e = 0x1902+8*row;
    if ((this.r8(e) & 3) == 0) {
      this.w8(e, 1);
    }
    this.w8(e+1, 0x20);
    this.w16(e+2, this.d16(0x835B+2*(kind & 0xF)));
    this.w16(e+4, (0x8000+((n & 0xFF) << 5)) & 0xFFFF);
  } // paletteAnimStart

  /**
   * `S_00A2E3` (`palette_slot_acquire`): a slot for palette `n` — the one
   * holding it (one more user), or a free one that starts loading it.
   * @returns {number} The slot (0-7), or $FF for palette $FF / none free.
   */
  acquirePaletteSlot(n) {
    n &= 0xFF;
    if (n == 0xFF) {
      return 0xFF;
    }
    var i;
    for (i = 0; i < 8; i++) {
      if (this.r8(0x1982+2*i) == n) {
        this.w8(0x1983+2*i, this.r8(0x1983+2*i)+1);
        return i;
      }
    }
    for (i = 0; i < 8; i++) {
      if (this.r8(0x1982+2*i) == 0xFF) {
        this.w8(0x1982+2*i, n);
        this.w8(0x1983+2*i, 1);
        this.paletteAnimStart(8+i, n, 0);
        return i;
      }
    }
    return 0xFF;   // $00:A310 uncovered
  } // acquirePaletteSlot

  /** `S_00A338`: one user less of slot `slot`; the last frees it */
  freePaletteSlot(slot) {
    slot &= 0xFF;
    if (slot == 0xFF) {
      return;
    }
    slot &= 7;
    var users = (this.r8(0x1983+2*slot)-1) & 0xFF;
    this.w8(0x1983+2*slot, users);
    if (users == 0) {
      this.w8(0x1982+2*slot, 0xFF);
    }
  } // freePaletteSlot

  // ---------------------------------------------------------------- sound

  /**
   * `S_00A541`: a sound command into the queue `$1F00` (at most 256).
   * `S_00A510` sends one a pass to the SPC (ports $2140/$2141, M6) unless
   * `$4C` bit 9 holds them.
   */
  sound(a) {
    var n = this.r16(0x5A);
    if (n >= 0x100) {
      return;
    }
    this.w16(0x5A, n+1);
    var y = this.r16(0x5E);
    this.w8(0x1F00+y, a);
    this.w16(0x5E, (y+1) & 0xFF);
  } // sound

  /**
   * `spc_load_song` `$00:A4AE`: the song `a` to the SPC by the IPL protocol
   * (M6: the model of the SPC700 plays it). What it does to the RAM: the
   * sound sends held meanwhile (`$4C` bit 9), three handshakes counted in
   * `$1CA7` (8-bit).
   */
  loadSong(a) {
    // two handshakes count $1CA7 up, the IPL chain (`spc_ipl_send_chain`) zeroes it, the third counts it to 1
    this.w8(0x1CA7, 1);
    this.soundSent.push({song: a & 0xFF});
    if (this.budget) {
      this.budget.song(a & 0xFF);
    }
  } // loadSong

  soundSend() {
    var n = this.r16(0x5A);
    if (n == 0 || (this.r16(0x4C) & 0x200)) {
      return;
    }
    this.w16(0x5A, n-1);
    var y = this.r16(0x5C);
    this.soundSent.push(this.r8(0x1F00+y));
    this.w8(0x1CA7, this.r8(0x1CA7)+1);
    this.w16(0x5C, (y+1) & 0xFF);
  } // soundSend

  // ---------------------------------------------------------------- score

  /** `S_00A578`: the score to zero, the next extra life at the table's first entry */
  scoreReset() {
    this.w16(0x16E9, 0);
    this.w16(0x16E7, 0);
    this.w16(0x16D3, 0x83AB);
  } // scoreReset

  /**
   * `S_00A585`: `a` (BCD) added to the score `$16E7` (low word) / `$16E9`
   * (high, capped under $10), the hi-score `$16CF`/`$16D1` follows, an
   * extra life at the entries of `$04:83AB` (? $00:A5D4 uncovered, M5).
   */
  scoreAdd(a) {
    var low = GameKernel.bcdAdd(this.r16(0x16E7), a);
    this.w16(0x16E7, low & 0xFFFF);
    var high = GameKernel.bcdAdd(this.r16(0x16E9), low >> 16);
    if (high >= 0x10) {
      high = 0x10;   // ? $00:A599 uncovered
    }
    this.w16(0x16E9, high);
    if (this.r16(0x16E9) > this.r16(0x16D1) || (this.r16(0x16E9) == this.r16(0x16D1) && this.r16(0x16E7) > this.r16(0x16CF))) {
      this.w16(0x16CF, this.r16(0x16E7));
      this.w16(0x16D1, this.r16(0x16E9));
    }
  } // scoreAdd

  /** a 16-bit BCD add; the carry comes out in bit 16 */
  static bcdAdd(a, b) {
    var out = 0, carry = 0;
    for (var i = 0; i < 4; i++) {
      var d = ((a >> (4*i)) & 0xF)+((b >> (4*i)) & 0xF)+carry;
      carry = d >= 10 ? 1 : 0;
      if (carry) {
        d -= 10;
      }
      out |= d << (4*i);
    }
    return out | (carry << 16);
  } // bcdAdd

  /** `S_00A5EC`: the score into the panel line `$18F4`-`$18FD` as BG3 tiles */
  scoreToPanel() {
    this.w16(0x18F4, (this.r16(0x16E9) & 0xF) | 0x2030);
    this.w16(0x18F6, ((this.r8(0x16E8) >> 4) & 0xF) | 0x2030);
    this.w16(0x18F8, (this.r8(0x16E8) & 0xF) | 0x2030);
    this.w16(0x18FA, ((this.r8(0x16E7) >> 4) & 0xF) | 0x2030);
    this.w16(0x18FC, (this.r8(0x16E7) & 0xF) | 0x2030);
  } // scoreToPanel

  /** `S_00A631` / `S_00A638`: a life less, the lives digit `$18DA` */
  livesToPanel() {
    var n = this.r16(0x16E1);
    if (n >= 10) {
      n = 9;   // ? $00:A640 uncovered
    }
    this.w16(0x18DA, n | 0x2030);
  } // livesToPanel

  loseLife() {
    this.w16(0x16E1, this.r16(0x16E1)-1);
    this.livesToPanel();
  } // loseLife

  /** `S_0088FC`: the panel line from `$04:80F1`, the lives and the score, the panel DMA on */
  panelInit() {
    for (var i = 0; i < 0x36; i += 2) {
      this.w16(0x18CC+i, this.d16(0x80F1+i));
    }
    this.livesToPanel();
    this.scoreToPanel();
    this.w16(0x4C, this.r16(0x4C) | 0x4000);
  } // panelInit

  // ---------------------------------------------------------------- misc

  /**
   * `S_00A67E`: the direction (0-15) from object `x` towards object `y`
   * (`$04:83DF` by octant and ratio). `S_00A6AA` computes the octant.
   */
  directionTo(x, y) {
    // ★ the sides are the borrows of the 16-bit subtractions, not the signs of the differences: an
    // object off the screen to the left (x ≥ $FF00) lies "right" of one on it (`S_00A6AA`)
    var dx = (this.r16(y+0x1A)-this.r16(x+0x1A)) & 0xFFFF;
    var dy = (this.r16(y+0x1C)-this.r16(x+0x1C)) & 0xFFFF;
    var oct = 0;
    if (this.r16(y+0x1A) < this.r16(x+0x1A)) {
      oct |= 8;
      dx = (-dx) & 0xFFFF;
    }
    if (this.r16(y+0x1C) < this.r16(x+0x1C)) {
      oct |= 0x10;
      dy = (-dy) & 0xFFFF;
    }
    var a = dy, b = dx;
    if (dy >= dx) {
      oct |= 4;
      a = dx;
      b = dy;
    }
    // L_00A6EE: the ratio a/b in quarters
    var r;
    var a2 = (a << 1) & 0xFFFF;
    if (a2 >= b) {
      var a4 = (a2 << 1) & 0xFFFF;
      var b3 = ((b << 1)+b) & 0xFFFF;
      r = (a4 >= b3) ? 3 : 2;
    } else {
      r = ((a2 << 1) & 0xFFFF) >= b ? 1 : 0;
    }
    oct |= r;
    return this.d8(0x83DF+oct) & 0xF;
  } // directionTo

  /** `S_00A71E`: the next byte of `$04:841F` (a sequence the enemies draw from, `$1CA8`) */
  sequenceNext() {
    var i = this.r16(0x1CA8);
    this.w16(0x1CA8, (i+1) & 0xFF);
    return this.d16(0x841F+(i & 0xFF));
  } // sequenceNext

  /** `S_00A72F`: the object's direction +$17 turns one step towards `a` (16 directions) */
  turnTowards(x, a) {
    var d = this.r8(x+0x17);
    var diff = (a-d) & 0xFF;
    if (diff == 0) {
      return;
    }
    if (a < d) {
      diff = (diff+0x10) & 0xFF;
    }
    if (diff >= 8) {
      this.w8(x+0x17, (d-1) & 0xF);
    } else {
      this.w8(x+0x17, (d+1) & 0xF);
    }
  } // turnTowards

  /** `S_00A752`: speeds x/y from a table of 4-byte entries by the direction +$17 */
  speedsByDirection(x, tbl) {
    var y = tbl+4*(this.r8(x+0x17) & 0xF);
    this.w16(x+0xD, this.d16(y));
    this.w16(x+0x12, this.d16(y+2));
  } // speedsByDirection

  // ------------------------------------------------------- the enemies' kernel (M4)

  /**
   * `S_009D3F`: the hits of the player's shots on object `x` — the box of
   * table `tbl` against every entry of the shot list `$1992` whose kind
   * has a bit of the high byte of `a`. A hit sets bit 6 of the object's
   * flags, and the pair of handlers picked by the shot's kind bits 3-4 and
   * `a` bits 1-2 (`$04:820B` the object's side, `$04:822B` the shot's)
   * trades the hit points: `L_009E10` takes the shot's points off the
   * object (bit 7 = dead at zero), `L_009DD9` the object's off the shot
   * (the list entry's kind cleared so it hits once), `L_009DF9` kills the
   * shot outright, `L_009E28` / `L_009DF8` do nothing. ★ Both handlers
   * read the points saved before either ran (`$90` the shot's, `$92` the
   * object's).
   * @param {number} x - The object.
   * @param {number} a - The kind mask (high byte) and the handler bits 1-2.
   * @param {number} tbl - The box table in bank $04.
   * @returns {boolean} The carry: a shot hit this pass.
   */
  hitTest(x, a, tbl) {
    this.w16(0xE4, a);
    var end = this.r16(0x3E);
    if (end == 0) {
      return false;
    }
    this.hitBox(x, tbl);
    var mask = a & 0xFF00;
    this.w16(0x3C, mask);
    var sel = a & 6;
    this.w16(0xE4, sel);
    this.w16(x+6, this.r16(x+6) & 0xFFBF);
    for (var y = 0; y != end; y += 12) {
      var kind = this.r16(0x199A+y);
      if (!(kind & mask)) {
        continue;
      }
      if (this.r16(0x1992+y) >= this.r16(0x36) || this.r16(0x1994+y) < this.r16(0x34)
          || this.r16(0x1996+y) >= this.r16(0x3A) || this.r16(0x1998+y) < this.r16(0x38)) {
        continue;
      }
      this.w16(x+6, this.r16(x+6) | 0x40);
      this.w16(0x10, y);
      var shot = this.r16(0x199C+y);
      var idx = (kind & 0x18) | sel;
      var objectHandler = this.d16(0x820B+idx);
      var shotHandler = this.d16(0x822B+idx);
      var objectHp = this.r16(x+0x22);
      var shotHp = this.r16(shot+0x22);
      this.w16(0x92, objectHp);
      this.w16(0x90, shotHp);
      // the object's side ($820B: L_009E10 or L_009E28)
      if (objectHandler == 0x9E10) {
        var left = objectHp-shotHp;
        if (left <= 0) {
          this.w16(x+6, this.r16(x+6) | 0x80);
          left = 0;
        }
        this.w16(x+0x22, left);
      }
      // the shot's side ($822B: L_009DD9, L_009DF8, L_009DF9)
      if (shotHandler == 0x9DD9) {
        var rest = shotHp-objectHp;
        if (rest <= 0) {
          this.w16(shot+6, this.r16(shot+6) | 0x80);
          this.w16(0x199A+y, 0);
          rest = 0;
        }
        this.w16(shot+0x22, rest);
      } else if (shotHandler == 0x9DF9) {
        this.w16(shot+6, this.r16(shot+6) | 0x80);
        this.w16(0x199A+y, 0);
        this.w16(shot+0x22, 0);
      }
    }
    return (this.r16(x+6) & 0x40) != 0;
  } // hitTest

  // ----------------------------------------------- the enemies' idioms (M4)
  // (not routines of the original but the blocks of code every object repeats inline — named once here,
  // the comments of `app/enemies.js` give the original's bytes)

  /** the metasprite of an animation: the table +$14 indexed by the phase's high byte +$17 */
  anim(x) {
    return this.d16(this.r16(x+0x14)+(this.r8(x+0x17) << 1));
  } // anim

  /** `LDA $14,X … JSL sprite_group2_back/front`: the animation's frame into group `group` */
  drawAnim(x, group, back) {
    this.addSprite(x, this.anim(x), group, back);
  } // drawAnim

  /** `LDA $16,X; CLC; ADC #step; CMP #limit; BCC +6; AND #$FF; ORA #0; STA $16,X`: the phase runs round */
  phaseWrap(x, step, limit) {
    var v = (this.r16(x+0x16)+step) & 0xFFFF;
    if (v >= limit) {
      v &= 0xFF;
    }
    this.w16(x+0x16, v);
  } // phaseWrap

  /**
   * `… CMP #limit; BCC +3; LDA #limit-$100; BCS end; STA $16,X`: the phase runs once; at the end the
   * store is skipped and the caller moves on.
   * @returns {boolean} True at the end.
   */
  phaseEnd(x, step, limit) {
    var v = (this.r16(x+0x16)+step) & 0xFFFF;
    if (v >= limit) {
      return true;
    }
    this.w16(x+0x16, v);
    return false;
  } // phaseEnd

  /** `LDA $1A,X; CLC; ADC #dx; CMP #limit; BCS gone`: the object has left the screen to the right (or the left) */
  offRight(x, dx, limit) {
    return ((this.r16(x+0x1A)+dx) & 0xFFFF) >= limit;
  } // offRight

  /** the same for y */
  offBottom(x, dy, limit) {
    return ((this.r16(x+0x1C)+dy) & 0xFFFF) >= limit;
  } // offBottom

  /** `LDA #n; JSL palette_slot_acquire; SEP #$20; STA $18,X; REP #$20` */
  pal(x, n) {
    this.w8(x+0x18, this.acquirePaletteSlot(n));
  } // pal

  /** the second slot, +$19 */
  pal2(x, n) {
    this.w8(x+0x19, this.acquirePaletteSlot(n));
  } // pal2

  /** `LDA #hp; STA $22,X; STZ $24,X; LDA $06,X; AND #$FF7F; STA $06,X`: a body that can be hit */
  body(x, hp) {
    this.w16(x+0x22, hp);
    this.w16(x+0x24, 0);
    this.w16(x+6, this.r16(x+6) & 0xFF7F);
  } // body

  /** `LDA #id; JSL S_009BD4; STA $20,X`: the slot table of sprite set `id` */
  slotsOf(x, id) {
    this.w16(x+0x20, this.spriteSlotTable(id));
  } // slotsOf

  /**
   * `LDA $31,X; AND #7; ASL; STA $00; ASL; ASL; CLC; ADC $00; … ADC #$899F … LDY $88; LDA ($02),Y`:
   * the two words of the difficulty tables `$04:899F` / `$04:89EF` (rows of five by the entry's
   * parameter byte +$31 bits 0-2, the column the difficulty `$88`): the shot timers of most enemies.
   * @returns {Array} [the first, the second].
   */
  diffParams(x) {
    var row = (this.r16(x+0x31) & 7)*10;
    var col = this.r16(0x88);
    return [this.d16(0x899F+row+col), this.d16(0x89EF+row+col)];
  } // diffParams

  /**
   * The block every shooting enemy repeats (`$02:87CA`-`$02:880F` and its copies): an aimed shot
   * (`$03:D2BF`, a child of the spawner `$17FB`, 16 free nodes needed) with the direction towards the
   * ship (`S_00A67E`) in +$32, the object's parameter +$30, its layer and its screen position + 512.
   * @param {number} x - The object.
   * @returns {number} The shot's node, or -1.
   */
  aimedShot(x) {
    var y = this.spawn(0x17FB, 0x03D2BF, 16);
    if (y < 0) {
      return -1;
    }
    this.w16(y+0x32, this.directionTo(x, 0x1589));
    this.w16(y+0x30, this.r16(x+0x30));
    this.w16(y+0x1E, this.r16(x+0x1E));
    this.w16(y+0xB, this.r16(x+0x1A)+0x200);
    this.w16(y+0x10, this.r16(x+0x1C)+0x200);
    return y;
  } // aimedShot

  /**
   * The block `LDA $24,X; BNE blink; LDA #a; LDY #tbl; JSL S_009D3F; BCC done; BIT #$80; BEQ flash;
   * JMP dead; flash: LDA #$18; JSL sound_queue; LDA #6; blink: JSL S_00A0D9; done:` — the hit test
   * with the flash of a hit that did not kill, the blink counted down by +$24.
   * @returns {boolean} True when the object died of the hit.
   */
  hitBlink(x, a, tbl) {
    var n = this.r16(x+0x24);
    if (n != 0) {
      this.blink(x, n);
      return false;
    }
    if (!this.hitTest(x, a, tbl)) {
      return false;
    }
    if (this.r16(x+6) & 0x80) {
      return true;
    }
    this.sound(0x18);
    this.blink(x, 6);
    return false;
  } // hitBlink

  /**
   * `S_03CE3E` (and `S_03CE8A`, `S_03CE1B`, `S_03CE67`): an explosion object as a child of the spawner,
   * at the object's position (and layer).
   * @param {number} x - The object.
   * @param {number} code - The explosion's code (24-bit).
   * @param {boolean} layer - Copy the layer too (`S_03CE3E`, `S_03CE8A`).
   */
  explode(x, code, layer) {
    var y = this.spawn(0x17FB, code, 16);
    if (y < 0) {
      return;
    }
    if (layer) {
      this.w16(y+0x1E, this.r16(x+0x1E));
    }
    this.w16(y+0xB, this.r16(x+0xB));
    this.w16(y+0x10, this.r16(x+0x10));
  } // explode

  /** `LDA $06,X; AND #$FFFE; STA $06,X; LDA #next; STA $03,X`: the end of an enemy — the missile's mark off, the state that dies */
  endAt(x, state) {
    this.w16(x+6, this.r16(x+6) & 0xFFFE);
    this.setState(x, state);
  } // endAt

  /**
   * `LDA #$0700; LDY #tbl; JSL S_009D3F; BCS dead` — the plain hit test of the objects that die of the
   * first hit (one hit point).
   */
  hit(x, tbl) {
    return this.hitTest(x, 0x0700, tbl);
  } // hit

  /** `S_00A55D`: object `x` into the list the homing missiles aim at (`$168D`, 32 at most, `$168B` the end) */
  enemyListAdd(x) {
    var y = this.r16(0x168B);
    if (y >= 0x40) {
      return;
    }
    this.w16(0x168D+y, x);
    this.w16(0x168B, y+2);
  } // enemyListAdd

  /** the usual first step of an enemy's pass: into the list unless a missile already took it (bit 0) */
  listAdd(x) {
    if (!(this.r16(x+6) & 1)) {
      this.enemyListAdd(x);
    }
  } // listAdd

  /**
   * `map_enqueue_b` `$00:91A2` / `map_enqueue_c` `$00:91F2`: the record at
   * `rec` in bank $04 (a count, then entries) rewrites blocks of the map
   * of the layer at `layerBase` — the enemies that open walls, the bosses
   * that leave remains. An entry of `b` is the block's column, row and
   * metatile word; an entry of `c` an offset into the layer's own stream
   * (the word there is the metatile) and the column and row. The blocks
   * go through the queue as a fill does (`S_00924E`), the collision map
   * changes at once; what does not fit the queue is dropped.
   * @param {number} rec - The record (16-bit, bank $04).
   * @param {number} layerBase - `$1832` or `$1862`.
   * @param {boolean} fromStream - The `c` kind.
   */
  mapEnqueueRecord(rec, layerBase, fromStream) {
    var l = this.level.layers[layerBase == 0x1862 ? 1 : 0];
    var n = this.d8(rec);
    var p = rec+1;
    var before = this.level.queue.length;
    for (var i = 0; i < n; i++) {
      if (this.level.queue.length >= LevelScroll.QUEUE_LIMIT) {
        break;
      }
      var word;
      if (fromStream) {
        var off = this.d16(p);
        p += 2;
        word = this.streamWord(l, off);
      }
      var bx = this.d16(p), by = this.d16(p+2);
      p += 4;
      if (!fromStream) {
        word = this.d16(p);
        p += 2;
      }
      this.level.enqueueBlock(l, LevelScroll.blockAddress(bx, by), word);
    }
    this.mapQueueMirror(this.level.queue.length-before, 0);
  } // mapEnqueueRecord

  /** the word at byte offset `off` of the layer's stream in the level bank (`[$14]` of `map_enqueue_c`) */
  streamWord(l, off) {
    var col = Math.floor(off/l.stride);
    var column = l.columns[col];
    var w = column ? column[(off % l.stride) >> 1] : undefined;
    if (w === undefined) {
      throw new Error('GameKernel: stream word at offset $'+off.toString(16)+' of layer '+l.index+' is not in the dump');
    }
    return w;
  } // streamWord

  // ------------------------------------------------------------- the pass

  /**
   * `main_frame` `$00:81C0`-`$00:8283`: one pass of the main loop — the
   * joypad (`$64` from `$60`, or the demo), the autofire masks, the edges
   * into `$15CB`, the sprite groups emptied, the sound sent, every task of
   * the list, then the sprites into the OAM shadow and the palette
   * animation. A task that sets `$4C` bit 10 ends the pass early.
   * @param {number} joypad - The joypad word `$60` of the last regular NMI.
   */
  pass() {
    this.w16(0x50, this.r16(0x50)+1);
    var joy;
    if (this.r16(0x15D5)) {
      // the demo's recorded input ($96/$98 pointer, $15D9 index, $15DB end)
      var i = this.r16(0x15D9);
      if (i == this.r16(0x15DB)) {
        this.w16(0x4A, this.r16(0x4A) | 0x80);
        this.w16(0x60, 0);
        joy = 0;
      } else {
        joy = this.demoWord(i) | (this.r16(0x60) & 0x1000);
        this.w16(0x15D9, i+2);
      }
    } else {
      joy = this.r16(0x60);
    }
    this.w16(0x64, joy);
    // the autofire: on the passes the mask $15CF leaves, the buttons of $15CD count as the buttons of $15D1
    if ((joy & this.r16(0x15CD)) && (this.r16(0x50) & this.r16(0x15CF)) == 0) {
      joy |= this.r16(0x15D1);
      this.w16(0x64, joy);
    }
    var held = this.r16(0x15C9);
    this.w16(0x15C9, joy);
    this.w16(0x15CB, (held ^ joy) & joy);
    this.w16(0x6C, 0);
    this.w16(0x6E, 0x28A0);
    this.w16(0x70, 0x28A0);
    this.w16(0x72, 0);
    this.w16(0x74, 0x2AE0);
    this.w16(0x76, 0x2AE0);
    this.w16(0x3E, 0);
    this.soundSend();
    // the task list
    var x = 0x1580;
    var stopped = false;
    for (;;) {
      this.w16(0x18, x);
      var code = this.r16(x+3) | (this.r8(x+5) << 16);
      this.w16(0x4C, this.r16(0x4C) & ~0x400);
      var fn = this.code[code];
      if (!fn) {
        throw new Error('GameKernel: task code $'+code.toString(16).padStart(6, '0')+' at node $'+x.toString(16)+' is not carried over');
      }
      fn.call(this, x);
      if (this.budget) {
        this.budget.task(code);
      }
      if (this.r16(0x4C) & 0x400) {
        stopped = true;
        break;
      }
      x = this.r16(0x18);
      this.w16(0x1A, x);
      x = this.r16(x);
      if (this.r16(x) == 0) {
        break;
      }
    }
    var drawn = 0, anim = 0;
    if (!stopped) {
      this.drawAllSprites();
      drawn = this.drawnEntries;
      this.paletteAnimate();
      anim = this.animStepped;
      if (this.r16(0x4C) & 0x4000) {
        this.scoreToPanel();
      }
    }
    if (this.budget) {
      this.budget.passEnded(drawn, 128-drawn, anim);
    }
    // main_frame_end: the pass is done — the next NMI is a regular one
    this.w16(0x4C, this.r16(0x4C) & ~0x80);
  } // pass

  /** the demo's recorded joypad word at index `i` — ? M5 (the demo records of `$04:8A7F`) */
  demoWord(i) {
    var p = this.r16(0x96)+i;
    return this.d16(p & 0xFFFF);
  } // demoWord

  // -------------------------------------------------------------- the NMI

  /**
   * `nmi` `$00:8286` of a **regular** frame (`nmi_frame`): the scroll
   * registers from the layers' shadows, `STAT77` into `$F4`, the OAM and
   * CGRAM DMA (the shadows are the RAM; the model reads them), the ship's
   * tile buffer and the panel by the `$4C` bits, the joypad into `$60`,
   * then the map queue (13 blocks), or the sprite group upload, or the NMI
   * job. The lag frame's NMI (`nmi_lag_skip`) only counts `$4E` — the
   * caller skips this.
   * @param {number} joypad - The joypad word the automatic read gives.
   * @returns {Object} What the model draws: {writes, regs, oam, cgram, shipTiles, panel, groups}.
   */
  nmi(joypad) {
    this.w16(0x4E, this.r16(0x4E)+1);
    this.w16(0x4C, this.r16(0x4C) | 0x80);
    var regs = this.level.registers();
    this.scrollRegs = regs;
    // STAT77: bits 0-3 the PPU1 version (1), bit 6 range over, bit 7 time over
    this.w8(0xF4, 0x01 | (this.rangeOver ? 0x40 : 0) | (this.timeOver ? 0x80 : 0));
    var out = {regs: regs, writes: [], groups: null, shipTiles: false, panel: false};
    var flags = this.r16(0x4C);
    if ((flags & 0x8000) && !(flags & 0x800)) {
      out.shipTiles = true;
    }
    if ((flags & 0x4000) && !(flags & 0x800)) {
      out.panel = true;
    }
    this.w16(0x60, joypad);
    this.vramWrites = [];
    var blocksDrawn = 0, groupsSent = 0, jobRan = false;
    if (this.level.queue.length) {
      // nmi_draw_metatile: 13 blocks
      var blocks = this.level.vblank();
      for (var i = 0; i < blocks.length; i++) {
        this.vramWrites.push({vaddr: blocks[i].vaddr, words: blocks[i].words});
      }
      this.mapQueueMirror(0, blocks.length);
      blocksDrawn = blocks.length;
    } else if (this.r16(0x68)) {
      var before = this.r16(0x68);
      out.groups = this.uploadGroups(4);
      groupsSent = before-this.r16(0x68);
    } else {
      jobRan = this.r16(0x1801) != 0x8711 || this.r16(0x2C) != 0;
      this.runJob();
    }
    if (this.budget) {
      this.budget.nmi(blocksDrawn, groupsSent, jobRan);
    }
    out.writes = this.vramWrites;
    out.oam = this.ram.subarray(0x2200, 0x2420);
    return out;
  } // nmi

  /**
   * `S_008505` (`nmi_upload_sprite_groups`): up to `n` groups of the
   * buffer `$59E0` into VRAM — 32 words at the group's address and 32 at
   * +$100 (the two rows of a 16×16 group).
   * @returns {Array} [{vaddr, words[64]}] for the model.
   */
  uploadGroups(n) {
    if (this.r16(0x4C) & 0x800) {
      return null;
    }
    var out = [];
    var x = this.r16(0x6A);
    var left = this.r16(0x68);
    while (left > 0 && n > 0) {
      var vaddr = this.r16(x);
      var words = new Uint16Array(64);
      for (var w = 0; w < 64; w++) {
        words[w] = this.r16(x+2+2*w);
      }
      out.push({vaddr: vaddr, words: words});
      x += 0x82;
      left--;
      n--;
    }
    this.w16(0x68, left);
    this.w16(0x6A, x);
    return out;
  } // uploadGroups

} // GameKernel

if (typeof globalThis !== 'undefined') { globalThis.GameKernel = GameKernel; }
if (typeof module !== 'undefined' && module.exports) { module.exports = GameKernel; }
