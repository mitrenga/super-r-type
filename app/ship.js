// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The game of Super R-Type — the tasks of bank `$01` (and the small ones
 * of banks `$04` and `$08`) carried over state by state on the kernel of
 * `app/gameKernel.js` (`sources/asm/main.asm`, `sources/docs/disasm_notes.md`
 * §9): the **level manager** (root `$1580`: the section's load — tiles,
 * palettes, record, scene, the two fills — its pass, the pause, the death
 * and the restart), the **ship** (root `$1589`: the entry into the level,
 * the joypad, the tilt, the trail, the fire, the beam's charge and its
 * four kinds and the spiral gun, the explosion), the **shots**, the
 * **sparks**, the fades and the mosaic (bank `$04`), the sprite set
 * loader of the wave list, and the **wave spawner** (root `$17FB`, bank
 * `$08`). The Force, the lasers, the bits and the missiles follow in the
 * same file (part 2 of M3), the launch from the mother ship after them.
 *
 * ★ Every variable is at its address in `ram` (`GameKernel`); the tables
 * are bank `$04` (`data/ship.json`). A task is `this.code[address] =
 * function (x)` with X = its node, as the main loop dispatches it. The
 * states' names are the original's addresses.
 *
 * Measured by `tools/matchship.mjs` against the RAM of the running
 * original, frame by frame (`tools/traceship.py`).
 */
class Ship extends GameKernel {

  constructor(data) {
    super(data);
    /** what the section load does to the chip, for the model: [{kind, …}] */
    this.events = [];
    this.installGameCode();
    // the Force, the lasers, the bits and the missiles (part 2 of M3), when their scripts are loaded
    if (typeof installForceCode === 'function') {
      installForceCode(this);
    }
    if (typeof installWeaponsCode === 'function') {
      installWeaponsCode(this);
    }
    if (typeof installLaserCode === 'function') {
      installLaserCode(this);
    }
    // the enemies, the level-bound objects and the bosses (M4), when their scripts are loaded
    if (typeof installEnemyCode === 'function') {
      installEnemyCode(this);
    }
    if (typeof installLevelEnemyCode === 'function') {
      installLevelEnemyCode(this);
    }
    if (typeof installBossCode === 'function') {
      installBossCode(this);
    }
  } // constructor

  // ------------------------------------------------------------- the game

  /**
   * `L_018175` (a new game from the title) + `L_0181BA`: the game's
   * variables, the section, then the section's load. The remake's menu
   * stands for the title; the launch from the mother ship (sections 14-15)
   * is the launch tasks' (part 2).
   * @param {number} difficulty - 0-3 (`$16D7`, the title's choice).
   * @param {number} section - The section to start (0 for a game).
   */
  newGame(difficulty, section) {
    this.reset();
    // L_018000 (the title's first state): the game's constants
    this.w16(0x16D7, difficulty & 0xFF);
    this.w16(0x15DD, 0xF7);
    this.w16(0x20, 0);
    this.w16(0x16CD, 3);
    this.w16(0x15D5, 0);
    this.w16(0x15D7, 0);
    this.w16(0x15DB, 0x1000);
    // L_018105: the power-ups cleared
    this.w16(0x1689, 0); this.w16(0x1743, 0); this.w16(0x1745, 0); this.w16(0x17CD, 0);
    this.w16(0x16E3, 0); this.w16(0x16D9, 0); this.w16(0x9A, 0);
    this.w16(0x1580+6, 0);
    // L_018175
    this.w16(0x1CA8, 0);
    this.w16(0x16E5, section & 0xFF);
    this.w16(0x16D5, this.r16(0x16D7));
    this.w16(0x16E1, this.r16(0x16CD));
    this.scoreReset();
    this.levelStart(0x1580);
  } // newGame

  /**
   * `L_0181BA`: the section's boss bit cleared, the loader task spawned,
   * the manager waits for it (`$81D7`).
   * @param {number} x - The manager's node (`$1580`).
   */
  levelStart(x) {
    this.w16(0x16E5, this.r16(0x16E5) & 0xFFFE);
    this.spawn(x, 0x0182A2, 0);
    this.setState(x, 0x81D7);
  } // levelStart

  /** `S_018958` / `S_018967`: forced blank on / off (`$80` bit 7, INIDISP) */
  blankOn() {
    this.w8(0x80, this.r8(0x80) | 0x80);
    this.events.push({kind: 'inidisp', value: this.r8(0x80)});
  } // blankOn

  blankOff() {
    this.w8(0x80, this.r8(0x80) & 0x7F);
    this.events.push({kind: 'inidisp', value: this.r8(0x80)});
  } // blankOff

  /** `S_018976`: START held goes into `$20` bit 12; returns whether it is held now */
  startHeld() {
    var v = this.r16(0x15C9) & 0x1000;
    this.w16(0x20, this.r16(0x20) | v);
    return v != 0;
  } // startHeld

  /**
   * `S_018855`: the panel of a pass — the engine flame tiles by `$17F3`
   * / `$17F7` (one of twelve every $20), the beam gauge `$58` as the
   * tiles of `$18DE`-`$18F0` (eight cells, red from $80, flashing past $100).
   */
  panelStep() {
    var v = (this.r16(0x17F3)+0x20) & 0xFFFF;
    if (v >= 0xC00) {
      v &= 0xFF;
    }
    this.w16(0x17F3, v);
    var y = (v >> 8) << 1;
    var tile = this.d16(0x8AEB+y);
    if (this.r16(0x17F5) != tile) {
      this.w16(0, 2);
      this.shipTileCopy(tile, true);
    }
    this.w16(0x17F5, tile);
    v = (this.r16(0x17F7)+0x20) & 0xFFFF;
    if (v >= 0x400) {
      v &= 0xFF;
    }
    this.w16(0x17F7, v);
    y = (v >> 8) << 1;
    tile = this.d16(0x8B03+y);
    if (this.r16(0x17F9) != tile) {
      this.w16(0, 0x1A);
      this.shipTileCopy(tile, false);
    }
    this.w16(0x17F9, tile);
    // the beam gauge
    var charge = this.r16(0x58);
    var pal, base;
    if (charge < 0x80) {
      pal = 0x0400; base = 0x2007;
    } else if (charge < 0x100) {
      pal = 0x0C00; base = 0x2017;
    } else if (this.r16(0x50) & 2) {
      pal = 0x0C00; base = 0x2017;
    } else {
      pal = 0x0400; base = 0x2017;
    }
    this.w16(0x18DE, (base-1) | pal);
    this.w16(0x18F0, ((base-1) | pal) | 0x4000);
    var a = charge >= 0x100 ? 0xFF : charge;
    a = (a & 0x7F) >> 1;
    var full = a >> 3;
    var cell = 0x18E0;
    var i;
    for (i = 0; i < full; i++) {
      this.w16(cell, (base+8) | pal);
      cell += 2;
    }
    var part = a & 7;
    if (part) {
      this.w16(cell, (base+part) | pal);
      cell += 2;
      full++;
    }
    for (i = full; i < 8; i++) {
      this.w16(cell, base | pal);
      cell += 2;
    }
  } // panelStep

  /**
   * `S_0187D4`: the end of the section's play (death, or the section
   * done): autofire off, sound $FF, the queue and the slots reset, the
   * DMA bits off, the screen blanked, the panel DMA off, the mosaic off.
   */
  sectionStop() {
    this.w16(0x15CD, 0);
    this.sound(0xFF);
    this.mapQueueReset();
    this.spriteSlotsReset();
    this.w16(0x4C, this.r16(0x4C) & ~0x9000);
    this.blankOn();
    this.w16(0x4C, this.r16(0x4C) & ~0x4000);
    this.w8(0x80, this.r8(0x80) | 0x0F);
    this.events.push({kind: 'inidisp', value: this.r8(0x80)});
    this.events.push({kind: 'mosaic', value: 0});
  } // sectionStop

  /** the five panel words of the difficulty (`$04:8AA5`) or of the pause (`$04:8AE1`) into `$18CE` */
  panelText(src) {
    for (var i = 0; i < 10; i += 2) {
      this.w16(0x18CE+i, this.d16(src+i));
    }
  } // panelText

  // ---------------------------------------------------------- the tasks

  installGameCode() {
    var K = this;
    var C = this.code;

    // ================================================== the level manager
    // L_018161 / L_0181A4 / L_0181D7: waiting for the children, then the flags of $4A
    var managerWait = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      var flags = K.r16(0x4A);
      if (flags & 0x8000) {
        // L_018036: game over — back to the title (M5)
        K.events.push({kind: 'gameOver'});
        K.setState(x, 0x8036);
        return;
      }
      if (flags & 0x4000) {
        // L_018190: the restart after a death — the transition task of bank $03, then the section again
        K.spawn(x, 0x038000, 0);
        K.setState(x, 0x81A4);
        return;
      }
      // $01:81FC uncovered: the boss transition (M5)
      K.events.push({kind: 'unported', what: 'manager flags $'+flags.toString(16)});
    };
    C[0x018161] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      // L_018175: a new game (the title's path) — newGame() does it
      K.w16(0x1CA8, 0);
      K.w16(0x16E5, 0);
      K.w16(0x16D5, K.r16(0x16D7));
      K.w16(0x16E1, K.r16(0x16CD));
      K.scoreReset();
      K.levelStart(x);
    };
    C[0x0181A4] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      K.levelStart(x);
    };
    C[0x0181D7] = managerWait;
    C[0x018036] = function (x) { /* the title (M5): nothing */ };

    // L_0182A2: the loader — the pass counter, the blank, the common sprite tiles, the ship's tiles
    C[0x0182A2] = function (x) {
      K.w16(0x50, 0);
      K.blankOn();
      K.events.push({kind: 'commonTiles'});
      var copies = [[0x0B, 0x52], [0x1B, 0x43], [0x0C, 0x53], [0x1C, 0x62], [0x0D, 0x72], [0x1D, 0x63],
                    [0x0E, 0x73], [0x0F, 0x164], [0x1F, 0x165], [0x1F, 0x165]];
      for (var i = 0; i < copies.length; i++) {
        K.w16(0, copies[i][0]);
        K.shipTileCopy(copies[i][1], false);
      }
      K.setState(x, 0x832D);
    };
    // L_01832D: the flame tiles' first frames (A = $0400 on entry: the main loop's TRB value)
    C[0x01832D] = function (x) {
      K.w16(0x17F3, 0x0400);
      var tile = K.d16(0x8AEB+((0x0400 >> 8) << 1));
      if (tile != 0xFFFF) {
        K.w16(0, 2);
        K.shipTileCopy(tile, true);
      }
      K.w16(0x17F5, tile);
      K.w16(0x17F7, 0);
      tile = K.d16(0x8B03);
      if (tile != 0xFFFF) {
        K.w16(0, 0x1A);
        K.shipTileCopy(tile, false);
      }
      K.w16(0x17F9, tile);
      K.setState(x, 0x837F);
    };
    // L_01837F: the three maps cleared by NMI jobs, then the state job wakes the task
    C[0x01837F] = function (x) {
      K.queueMapClear(0x1892);
      K.queueMapClear(0x1832);
      K.queueMapClear(0x1862);
      K.queueStateJob(x, 0x0183A1);
      K.setState(x, 0x83A0);
    };
    C[0x0183A0] = function (x) { /* waiting for the job */ };
    C[0x0183A1] = function (x) {
      K.events.push({kind: 'bgTiles', section: K.r16(0x16E5) & 0xF});
      K.setState(x, 0x83B4);
    };
    C[0x0183B4] = function (x) {
      var sec = K.r16(0x16E5) & 0xF;
      K.loadBgPalettes(sec);
      K.loadObjPalettes(sec);
      K.setState(x, 0x83D1);
    };
    C[0x0183D1] = function (x) {
      K.loadLevelRecord(K.r16(0x16E5) & 0xF);
      K.sceneStart();
      K.layerInit(x, 0x1832);
      K.setState(x, 0x83EF);
    };
    C[0x0183EF] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      K.layerInit(x, 0x1862);
      K.setState(x, 0x8415);
    };
    C[0x018415] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      K.spriteSlotsReset();
      K.w16(0x4A, 0x0600);
      K.w16(0x58, 0);
      K.w16(0x4C, K.r16(0x4C) | 0x9000);
      K.loseLife();
      K.panelInit();
      K.setState(x, 0x844D);
    };
    // stage_music_select L_01844D: the song, the brightness, the difficulty's constants
    C[0x01844D] = function (x) {
      var sec = K.r16(0x16E5) & 0x1F;
      K.loadSong(K.d8(0x8A3F+sec));
      K.sound(0x40);
      K.w8(0x80, K.r8(0x80) & 0xF0);
      K.events.push({kind: 'inidisp', value: K.r8(0x80)});
      K.blankOff();
      var a = 0;
      if (K.r16(0x16E5) & 0x10) {
        a = 0;   // $01:847E uncovered: the PRO difficulty (M5)
      }
      a = (a+K.r16(0x16D5)) & 0xFFFF;
      K.w16(0x86, a);
      K.w16(0x88, a << 1);
      K.w16(0x84, K.d16(0x8A5F+(a << 1)));
      K.w16(0x8C, 0);
      K.w16(0x8E, 0);
      K.w16(0x9A, 0);
      K.w16(0x15CF, 7);
      K.w16(0x15D1, 0x8000);
      L_0184A2(x);
    };
    // L_0184A2: the autofire mask (X and Y), the difficulty's panel text
    var L_0184A2 = function (x) {
      K.w16(0x15CD, 0x4040);
      K.panelText(K.d16(0x8AA5+(K.r16(0x86) << 1)));
      K.setState(x, 0x84CF);
    };
    // L_0184CF: the pass of the section
    C[0x0184CF] = function (x) {
      if (K.r16(0x15D5)) {
        // the demo: START ends it (M5)
        if (K.startHeld()) {
          K.w16(0x4A, K.r16(0x4A) | 0x80);
          L_0184F4(x);
          return;
        }
      } else if ((K.r16(0x4C) & 0x1000) && (K.r16(0x15CB) & 0x1000)) {
        L_018565(x);
        return;
      }
      L_0184F4(x);
    };
    var L_0184F4 = function (x) {
      K.panelStep();
      K.scrollStep();
      var flags = K.r16(0x4A);
      if (!(flags & 0x1800)) {
        return;
      }
      K.sectionStop();
      if (K.r16(0x4A) & 0x1000) {
        K.setState(x, 0x8729);   // L_018720
        return;
      }
      // L_018514: the section complete
      if (K.r16(0x16E5) & 1) {
        K.setState(x, 0x8525);   // $01:8525 uncovered: after a boss (M5)
        return;
      }
      K.w16(0x16E1, K.r16(0x16E1)+1);
      if (K.r16(0x4A) & 0x600) {
        return;
      }
      K.setState(x, 0x8561);
    };
    C[0x018525] = function (x) { K.events.push({kind: 'unported', what: 'boss done $01:8525'}); };
    C[0x018561] = function (x) { K.kill(x); };   // ? $01:8561 (4 B, uncovered): JML L_008806
    // L_018565: the pause
    var L_018565 = function (x) {
      K.sound(0xFC);
      K.w16(0x15CD, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      K.spawn(x, 0x018703, 0);
      K.spawn(x, 0x019511, 0);
      K.panelText(0x8AE1);
      K.setState(x, 0x85AB);
    };
    C[0x0185AB] = function (x) {
      if (K.r16(0x15CB) & 0x1000) {
        K.w16(x+6, K.r16(x+6) | 0x80);
        K.setState(x, 0x85DE);
        return;
      }
      if (K.r16(0x16F5)) {
        K.events.push({kind: 'unported', what: 'level select in pause $01:85B8'});
      }
    };
    C[0x0185DE] = function (x) {
      K.sound(0xFB);
      L_0184A2(x);
    };
    // L_018703: the pause's blocker — stops the pass after itself until the parent's bit 7
    C[0x018703] = function (x) {
      var y = K.r16(x+8);
      if (K.r16(y+6) & 0x80) {
        K.setState(x, 0x871C);
        return;
      }
      K.w16(0x4C, K.r16(0x4C) | 0x400);
    };
    C[0x01871C] = function (x) { K.kill(x); };
    // L_018729: after the ship's death — the power-ups lost unless $84 bit 0, the lives
    C[0x018729] = function (x) {
      if (!(K.r16(0x84) & 1)) {
        K.w16(0x1743, 0);
        K.w16(0x17CD, 0);
        K.w16(0x1689, 0);
        K.w16(0x16E3, 0);
      }
      if (K.r16(0x16E1) != 0) {
        L_0187B2(x);
        return;
      }
      // the game over (M5): $16D9 cleared, the continue task $03:80B1
      K.w16(0x16D9, 0);
      K.spawn(x, 0x0380B1, 0);
      K.setState(x, 0x8760);
    };
    var L_0187B2 = function (x) {
      K.w16(0x4A, K.r16(0x4A) | 0x4000);
      K.setState(x, 0x87BF);
    };
    C[0x018760] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      K.w16(0x16DF, 0);
      K.spawn(x, 0x038190, 0);
      K.setState(x, 0x878D);
    };
    C[0x01878D] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      K.scoreReset();
      if (K.r16(0x16DF) == 0) {
        K.w16(0x4A, K.r16(0x4A) | 0x8000);
        K.setState(x, 0x87D0);
        return;
      }
      K.w16(0x16E1, K.r16(0x16CD));
      L_0187B2(x);
    };
    C[0x0187BF] = function (x) { K.kill(x); };
    C[0x0187D0] = function (x) { K.kill(x); };

    // ============================================ the pause's cheat reader
    // L_019511 / L_019521 / L_01952D: the in-game instant power-up ($04:9073), then the laser and the missile
    C[0x019511] = function (x) {
      // ($16D9 ≠ 0: $01:9516 uncovered — the same reader)
      K.w16(x+0x32, 0);
      K.setState(x, 0x952D);
    };
    C[0x01952D] = function (x) {
      var y = K.r16(x+8);
      if (K.r16(y+6) & 0x80) {
        K.setState(x, 0x9623);   // L_01961C
        return;
      }
      var pressed = K.r16(0x15CB);
      if (pressed == 0) {
        return;
      }
      var i = K.r16(x+0x32);
      if (pressed != K.d16(0x9073+i)) {
        K.w16(x+0x32, 0);
        return;
      }
      i += 2;
      if (K.d16(0x9073+i) == 0) {
        K.setState(x, 0x955D);
        return;
      }
      K.w16(x+0x32, i);
    };
    C[0x01955D] = function (x) {
      var y = K.r16(x+8);
      if (K.r16(y+6) & 0x80) {
        K.setState(x, 0x9623);
        return;
      }
      var pressed = K.r16(0x15CB);
      if (pressed == 0) {
        return;
      }
      if (pressed & 0x3F2F) {
        K.w16(x+0x32, 0);
        K.setState(x, 0x952D);
        return;
      }
      var laser;
      if (pressed & 0x80) { laser = 0x8000; }
      else if (pressed & 0x40) { laser = 0x8001; }
      else if (pressed & 0x8000) { laser = 0x8002; }
      else if (pressed & 0x4000) { laser = 0x8003; }
      else if (pressed & 0x10) { laser = 0x8004; }
      else { return; }
      K.w16(x+0x30, laser);
      K.setState(x, 0x95B7);
    };
    C[0x0195B7] = function (x) {
      var y = K.r16(x+8);
      if (K.r16(y+6) & 0x80) {
        K.setState(x, 0x9623);
        return;
      }
      var pressed = K.r16(0x15CB);
      if (pressed == 0) {
        return;
      }
      if (pressed & 0xFF3F) {
        K.w16(x+0x32, 0);
        K.setState(x, 0x952D);
        return;
      }
      var missile;
      if (pressed & 0x80) { missile = 0; }
      else if (pressed & 0x40) { missile = 0x100; }
      else { return; }
      K.w16(0x16D9, missile | K.r16(x+0x30));
      K.w16(0x1689, (K.r8(0x16DA) & 1)+1);
      K.w16(0x1745, K.r16(0x16D9) & 0xF);
      K.w16(0x1743, 3);
      K.w16(0x17CD, 2);
      K.w16(0x16E3, 1);
      K.w16(0x16D9, K.r16(0x16D9) & K.r16(0x16DB));
      K.sound(0x0C);
      K.setState(x, 0x9623);
    };
    C[0x019623] = function (x) { K.kill(x); };

    // =========================================================== the ship
    // L_01A769: waiting for the section ($4A bit 10), then the ship's birth
    C[0x01A769] = function (x) {
      if (!(K.r16(0x4A) & 0x400)) {
        return;
      }
      K.w16(0x4A, K.r16(0x4A) | 7);
      K.w16(x+0x16, 0x200);
      var y = (0x200 >> 8) << 1;
      var tile = K.d16(0x9C5B+y);
      if (tile != 0xFFFF) {
        K.w16(0, 0);
        K.shipTileCopy(tile, true);
      }
      K.w16(0x15DF, tile);
      tile = K.d16(0x9C65+y);
      if (tile != 0xFFFF) {
        K.w16(0, 0xA);
        K.shipTileCopy(tile, false);   // S_009B66: one tile
      }
      K.w16(0x15E1, tile);
      K.w16(x+0x20, 0);
      K.w16(x+0x22, 1);
      K.w16(x+0x24, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      K.w8(x+0x18, K.acquirePaletteSlot(0x80));
      K.w16(0x15E5, 0);
      K.w16(0x15E3, 0);
      K.w16(0x1687, 0);
      K.w16(x+0x3E, 0);
      K.w16(x+0xA, 0);
      K.w16(x+0xF, 0);
      var f = K.spawn(x, 0x04AB5A, 0);
      if (f >= 0) {
        K.w16(f+0x30, 1);
        K.w16(f+0x32, 0x80);
      }
      K.w16(0x8A, 8);
      if (K.r16(0x16E5) & 1) {
        // L_01A812: a boss section — the mosaic, the ship flies in from the left
        var m = K.spawn(x, 0x04ABC9, 0);
        if (m >= 0) {
          K.w16(m+0x30, 8);
          K.w16(m+0x32, 0x80);
        }
        K.w16(x+0xB, 0x1E8);
        K.w16(x+0x10, 0x270);
        K.trailInit(x);
        K.w16(x+0xD, 0x400);
        K.setState(x, 0xA849);
        return;
      }
      // L_01A88E
      K.w16(x+0xB, 0x240);
      K.w16(x+0x10, 0x270);
      K.trailInit(x);
      L_01A8A0(x, 0x78);
    };
    var L_01A8A0 = function (x, a) {
      K.w16(x+0x34, a);
      K.w16(0x16E3, K.r16(0x16E3) & 0xFF7F);
      K.setState(x, 0xA8B5);
    };
    // L_01A849: the flight in at a boss, slowing down
    C[0x01A849] = function (x) {
      if (K.r16(0x4A) & 0xA0) {
        L_01A9F8(x);
        return;
      }
      K.moveX(x);
      K.trailStep(x);
      var sp = (K.r16(x+0xD)-0x10) & 0xFFFF;
      if (sp < 0x100) {
        sp = 0x100;
      }
      K.w16(x+0xD, sp);
      K.trailStep(x);
      K.objectScreen(x);
      K.shipTilesAndSprite(x);
      K.fireStep(x);
      K.shipBox(x, 0x9C3E);
      if (K.r16(x+0xB) >= 0x240) {
        L_01A8A0(x, 0x1E);
      }
    };
    // L_01A8B5: the entry — invincible, blinking, for $34 passes
    C[0x01A8B5] = function (x) {
      if (K.r16(0x4A) & 0xA0) {
        L_01A9F8(x);
        return;
      }
      K.shipMove(x);
      K.objectScreen(x);
      K.shipTilesAndSprite(x);
      K.fireStep(x);
      K.shipBox(x, 0x9C3E);
      var n = (K.r16(x+0x34)-1) & 0xFFFF;
      K.w16(x+0x34, n);
      if (n != 0) {
        return;
      }
      K.w16(x+0x22, 1);
      K.w16(x+0x24, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      K.w16(0x8A, 0);
      K.setState(x, 0xA8F9);
    };
    // L_01A8F9: the play
    C[0x01A8F9] = function (x) {
      if (K.r16(0x4A) & 0xA0) {
        L_01A9F8(x);
        return;
      }
      K.shipMove(x);
      K.objectScreen(x);
      K.shipTiles(x);
      if (K.r16(x+6) & 0x80) {
        L_01A985(x);
        return;
      }
      K.w16(0x42, 0xFFFC);
      K.w16(0x44, 0);
      if (K.terrainHit(x)) {
        // $01:A959: the terrain kills unless $15D3 (? the invincibility of the power-up table, M5)
        if (K.r16(0x15D3) == 0) {
          L_01A985(x);
          return;
        }
        K.w16(x+0x24, 8);
      }
      if (K.r16(x+0x24) != 0) {
        K.w16(x+0x24, K.r16(x+0x24)-1);
        if (K.r16(0x50) & 2) {
          // $01:A97A: no sprite this pass (the blink)
          K.fireStep(x);
          K.shipBox(x, 0x9C3E);
          return;
        }
      }
      K.addSprite(x, 0x9C52, 1, true);
      K.fireStep(x);
      K.shipBox(x, 0x9C3E);
    };
    // L_01A985: the death
    var L_01A985 = function (x) {
      K.w16(0x4C, K.r16(0x4C) & ~0x1000);
      K.w16(x+6, K.r16(x+6) | 0x80);
      K.w16(x+0x14, 0xF9C5);
      K.w16(x+0x16, 0);
      K.sound(0xFF);
      K.sound(0x0B);
      K.setState(x, 0xA9B4);
    };
    C[0x01A9B4] = function (x) {
      K.objectScreen(x);
      K.addSprite(x, K.animFrame(x), 2, true);
      var v = (K.r16(x+0x16)+0x40) & 0xFFFF;
      if (v < 0x600) {
        K.w16(x+0x16, v);
        return;
      }
      // L_01A9DD: the phase keeps its last value (the store is skipped on the way out)
      K.w16(x+0x34, 0x1E);
      K.setState(x, 0xA9F2);
    };
    C[0x01A9F2] = function (x) {
      var n = (K.r16(x+0x34)-1) & 0xFFFF;
      K.w16(x+0x34, n);
      if (n == 0) {
        L_01AA06(x);
      }
    };
    // L_01A9F8: the section's end ($4A bit 7) or the flight out (bit 5)
    var L_01A9F8 = function (x) {
      if (K.r16(0x4A) & 0x80) {
        K.w16(x+6, K.r16(x+6) | 0x80);
        L_01AA06(x);
        return;
      }
      L_01AA70(x);
    };
    var L_01AA06 = function (x) {
      K.w16(0x4A, K.r16(0x4A) | 0x140);
      K.freePaletteSlot(K.r8(x+0x18));
      K.setState(x, 0xAA1C);
    };
    C[0x01AA1C] = function (x) {
      if (K.r16(0x4A) & 7) {
        return;
      }
      var f = K.spawn(x, 0x04AB62, 0);
      if (f >= 0) {
        K.w16(f+0x30, 1);
        K.w16(f+0x32, 0x80);
      }
      K.setState(x, 0xAA46);
    };
    C[0x01AA46] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      K.w16(0x4A, (K.r16(0x4A) | 0x1000) & 0xFBFF);
      K.setState(x, 0xA769);
      K.killChildren(x);
    };
    // L_01AA70: the flight out of a finished section (part 2: $01:AA7E-$01:AE2D)
    var L_01AA70 = function (x) {
      K.events.push({kind: 'unported', what: 'section end flight $01:AA70'});
      K.setState(x, 0xAA70);
    };
    C[0x01AA70] = function (x) { /* part 2 */ };

    // ======================================================= the fire
    // L_01B437: the muzzle flash, one pass
    C[0x01B437] = function (x) {
      var y = K.r16(x+8);
      K.w16(x+0xB, K.r16(y+0xB)+0xC);
      K.w16(x+0x10, K.r16(y+0x10));
      K.w16(x+0x20, 0);
      K.w16(x+0x22, 1);
      K.w16(x+0x24, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      K.w8(x+0x18, K.acquirePaletteSlot(0x80));
      K.setState(x, 0xB476);
    };
    C[0x01B476] = function (x) {
      K.objectScreen(x);
      K.addSprite(x, 0x9CF3, 1, true);
      K.setState(x, 0xB488);
    };
    C[0x01B488] = function (x) { K.kill(x); };
    // L_01B48C: the basic shot
    C[0x01B48C] = function (x) {
      K.w16(x+0xD, 0xA00);
      var y = K.r16(x+8);
      K.w16(x+0xB, K.r16(y+0xB)+0xC);
      K.w16(x+0x10, K.r16(y+0x10));
      K.w16(x+0x20, 0);
      K.w16(x+0x22, 1);
      K.w16(x+0x24, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      K.w8(x+0x18, K.acquirePaletteSlot(0x80));
      K.setState(x, 0xB4D1);
    };
    C[0x01B4D1] = function (x) {
      if (K.r16(x+6) & 0x80) {
        L_01B69B(x);
        return;
      }
      K.moveXSigned(x);
      if (K.r16(x+0xB) >= 0x320) {
        L_01B69B(x);
        return;
      }
      K.objectScreen(x);
      K.addSprite(x, 0x9CF8, 1, false);
      K.w16(0x42, 0);
      K.w16(0x44, 0);
      if (!K.terrainHit(x)) {
        K.shotBox(x, 0x100, 0x9D2B);
        return;
      }
      K.w16(x+0x14, 0x9D16);
      K.w16(x+0x16, 0);
      K.setState(x, 0xB51D);
    };
    C[0x01B51D] = function (x) {
      K.objectScreen(x);
      K.addSprite(x, K.animFrame(x), 1, false);
      var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
      if (v < 0x300) {
        K.w16(x+0x16, v);
        return;
      }
      K.w16(x+0x16, 0x200);
      L_01B69B(x);
    };
    // L_01B69B: the shot is gone — the ship's count of shots down
    var L_01B69B = function (x) {
      var y = K.r16(x+8);
      K.w16(y+0x3E, K.r16(y+0x3E)-1);
      K.setState(x, 0xB6AC);
    };
    C[0x01B6AC] = function (x) { K.kill(x); };
    // L_01B61A / L_01B685: a laser's shot waits for its children before it goes (part 2)
    C[0x01B685] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      L_01B69B(x);
    };
    // L_01B6B0: the shot of a laser (part 2 uses it)
    C[0x01B6B0] = function (x) {
      K.w16(x+0xD, 0xA00);
      var y = K.r16(x+8);
      K.w16(x+0xB, K.r16(y+0xB));
      K.w16(x+0x10, K.r16(y+0x10));
      K.w16(x+0x30, 0x9CFD);
      K.w16(x+0x20, 0);
      K.w16(x+0x22, 1);
      K.w16(x+0x24, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      K.w8(x+0x18, K.acquirePaletteSlot(0x80));
      K.setState(x, 0xB6F7);
    };
    C[0x01B6F7] = function (x) {
      if (K.r16(x+6) & 0x80) {
        K.setState(x, 0xB85F);
        return;
      }
      K.moveXSigned(x);
      if (K.r16(x+0xB) >= 0x320) {
        K.setState(x, 0xB85F);
        return;
      }
      // L_01B7F7
      K.objectScreen(x);
      K.addSprite(x, K.r16(x+0x30), 1, false);
      K.w16(0x42, 0);
      K.w16(0x44, 0);
      if (!K.terrainHit(x)) {
        K.shotBox(x, 0x100, 0x9D2B);
        return;
      }
      K.w16(x+0x14, 0x9D16);
      K.w16(x+0x16, 0);
      K.setState(x, 0xB829);
    };
    C[0x01B829] = function (x) {
      // ? $01:B829 (47 B, uncovered until part 2): the hit animation like L_01B51D, then L_01B858
      K.objectScreen(x);
      K.addSprite(x, K.animFrame(x), 1, false);
      var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
      if (v < 0x300) {
        K.w16(x+0x16, v);
        return;
      }
      K.w16(x+0x16, 0x200);
      K.setState(x, 0xB85F);
    };
    C[0x01B85F] = function (x) { K.kill(x); };
    // L_01B863 / L_01B86E / L_01B879: the sparks of a hit (small, medium, large) — children of what was hit
    var spark = function (x, tbl) {
      K.w16(x+0x14, tbl);
      K.w16(x+0x16, 0);
      K.w16(x+0x20, 0);
      K.w8(x+0x18, K.acquirePaletteSlot(0x80));
      K.setState(x, 0xB89C);
    };
    C[0x01B863] = function (x) { spark(x, 0x9CC3); };
    C[0x01B86E] = function (x) { spark(x, 0x9CD3); };
    C[0x01B879] = function (x) { spark(x, 0x9CE3); };
    C[0x01B89C] = function (x) {
      K.objectScreenParent(x);
      K.addSprite(x, K.animFrame(x), 1, false);
      var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
      if (v < 0x800) {
        K.w16(x+0x16, v);
        return;
      }
      K.setState(x, 0xB8D2);
    };
    C[0x01B8D2] = function (x) { K.kill(x); };

    // L_01B8D6: B held — the charge counts up to 16, then the beam charges
    C[0x01B8D6] = function (x) {
      if (!(K.r16(0x15C9) & 0x8000)) {
        K.w16(0x58, 0);
        K.setState(x, 0xB8F2);
        return;
      }
      var c = K.r16(0x58)+1;
      if (c < 0x10) {
        K.w16(0x58, c);
        return;
      }
      // L_01B8F6
      K.w16(x+0x20, 0);
      K.w16(x+0x14, 0x9D31);
      K.w16(x+0x16, 0);
      K.w8(x+0x18, K.acquirePaletteSlot(0x80));
      K.sound(7);
      K.setState(x, 0xB920);
    };
    C[0x01B8F2] = function (x) { K.kill(x); };
    // L_01B920: the charging beam in front of the ship
    C[0x01B920] = function (x) {
      var y = K.r16(x+8);
      if (K.r16(y+6) & 0x80) {
        L_01B98E(x);
        return;
      }
      if (!(K.r16(0x15C9) & 0x8000)) {
        L_01BA34(x);
        return;
      }
      K.chargeSprite(x, 0x600);
      var c = (K.r16(0x58)+2) & 0xFFFF;
      K.w16(0x58, c);
      if (c >= 0x80) {
        K.sound(7);
        K.setState(x, 0xB9B2);
      }
    };
    var L_01B98E = function (x) {
      K.sound(0x3D);
      K.w16(0x58, 0);
      K.setState(x, 0xB99E);
    };
    C[0x01B99E] = function (x) { K.kill(x); };
    // L_01B9B2: charged — the gauge climbs on to the spiral gun at $100 and cycles from $140
    C[0x01B9B2] = function (x) {
      var y = K.r16(x+8);
      if (K.r16(y+6) & 0x80) {
        L_01B98E(x);
        return;
      }
      if (!(K.r16(0x15C9) & 0x8000)) {
        L_01BA34(x);
        return;
      }
      K.chargeSprite(x, 0x600);
      var c = K.r16(0x58);
      if (c == 0x100) {
        K.sound(8);
      }
      c++;
      if (c >= 0x140) {
        // $01:BA27: the sound again and the gauge back to $80
        K.sound(7);
        c = 0x80;
      }
      K.w16(0x58, c);
    };
    // L_01BA34: B released — the beam by the charge, or the spiral gun past $100
    var L_01BA34 = function (x) {
      K.sound(0x3D);
      var c = K.r16(0x58);
      K.w16(0x58, 0);
      if (c >= 0x100) {
        L_01BC3B(x);
        return;
      }
      K.w16(x+0x30, c);
      K.w16(x+0x14, 0x9E11);
      K.w16(x+0x16, 0);
      K.setState(x, 0xBA5C);
    };
    C[0x01BA5C] = function (x) {
      K.w16(x+0xB, K.r16(0x1594)+0xC+K.r16(0x15E5));
      K.w16(x+0x10, K.r16(0x1599));
      K.objectScreen(x);
      K.addSprite(x, K.animFrame(x), 1, false);
      var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
      if (v < 0x300) {
        K.w16(x+0x16, v);
        return;
      }
      K.w16(x+0x16, 0x200);
      // L_01BA9E: one beam at a time ($15E3)
      if (K.r16(0x15E3)) {
        K.setState(x, 0xBAAA);
        return;
      }
      K.w16(0x15E3, 1);
      var kind = (K.r16(x+0x30) & 0x1E0) >> 4;
      var handler = K.d16(0x9EFE+kind);
      var tbl, hp, box, dx;
      switch (handler) {
        case 0xBAC7: tbl = 0x9E03; hp = 1; box = 0x9EE0; dx = 8; break;
        case 0xBAEB: tbl = 0x9E03; hp = 2; box = 0x9EE6; dx = 8; break;
        case 0xBB0E: tbl = 0x9E21; hp = 5; box = 0x9EEC; dx = 0xC; break;
        case 0xBB31: tbl = 0x9E33; hp = 0xA; box = 0x9EF2; dx = 0x10; break;
        default: tbl = 0x9E49; hp = 0x14; box = 0x9EF2; dx = 0x14; break;   // $BB54
      }
      K.w16(x+0x14, tbl);
      K.w16(x+0x16, 0);
      K.w16(x+0x22, hp);
      K.w16(x+0x24, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      // L_01BB75
      K.w16(x+0xB, K.r16(x+0xB)+dx+K.r16(0x15E5));
      K.w16(x+0x32, box);
      K.w16(x+0xD, 0x800);
      K.sound(1);
      K.setState(x, 0xBB99);
    };
    C[0x01BAAA] = function (x) { K.kill(x); };
    C[0x01BB99] = function (x) {
      if (K.r16(x+6) & 0x80) {
        L_01BD7E(x);
        return;
      }
      K.moveXSigned(x);
      if (K.r16(x+0xB) >= 0x320) {
        L_01BD7E(x);
        return;
      }
      K.objectScreen(x);
      K.addSprite(x, K.animFrame(x), 1, false);
      var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
      if (v >= 0x200) {
        v &= 0xFF;
      }
      K.w16(x+0x16, v);
      K.shotBox(x, 0x100, K.r16(x+0x32));
      K.w16(0x42, 0);
      K.w16(0x44, 0);
      if (K.terrainHit(x)) {
        L_01BBF7(x);
      }
    };
    var L_01BBF7 = function (x) {
      K.w16(x+0x14, 0x9E63);
      K.w16(x+0x16, 0);
      K.setState(x, 0xBC09);
    };
    C[0x01BC09] = function (x) {
      K.objectScreen(x);
      K.addSprite(x, K.animFrame(x), 1, false);
      var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
      if (v < 0x400) {
        K.w16(x+0x16, v);
        return;
      }
      K.w16(x+0x16, 0x300);
      L_01BD7E(x);
    };
    var L_01BD7E = function (x) {
      K.w16(0x15E3, 0);
      K.setState(x, 0xBD88);
    };
    C[0x01BD88] = function (x) { K.kill(x); };
    // L_01BC3B: the spiral gun — a head, then six parts on object scripts
    var L_01BC3B = function (x) {
      K.w16(x+0x14, 0x9EBD);
      K.w16(x+0x16, 0);
      K.w16(x+0x22, 0x28);
      K.w16(x+0x24, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      K.sound(2);
      K.setState(x, 0xBC66);
    };
    C[0x01BC66] = function (x) {
      K.w16(x+0xB, K.r16(0x1594)+0xC+K.r16(0x15E5));
      K.w16(x+0x10, K.r16(0x1599));
      K.objectScreen(x);
      K.addSprite(x, K.animFrame(x), 1, false);
      var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
      if (v < 0x300) {
        K.w16(x+0x16, v);
        K.shotBox(x, 0x100, 0x9EF8);
        return;
      }
      K.w16(x+0x16, 0x200);
      // L_01BCBD: the six parts
      var tbl = 0x9F0E;
      for (var i = 0; i < 6; i++) {
        var script = K.d16(tbl+2*i);
        var y = K.spawn(x, 0x01BD8C, 8);
        if (y < 0) {
          break;
        }
        K.w16(y+0xB, K.r16(x+0xB)+0x20+K.r16(0x15E5));
        K.w16(y+0x10, K.r16(x+0x10));
        K.w16(y+0x30, script);
      }
      // L_01BCFD
      K.w16(0x15E3, 1);
      K.w16(x+0x14, 0x9EC3);
      K.w16(x+0x16, 0);
      K.setState(x, 0xBD15);
    };
    C[0x01BD15] = function (x) {
      K.w16(x+0xB, K.r16(0x1594)+0xC+K.r16(0x15E5));
      K.w16(x+0x10, K.r16(0x1599));
      K.objectScreen(x);
      K.addSprite(x, K.animFrame(x), 1, false);
      var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
      if (v < 0x400) {
        K.w16(x+0x16, v);
        return;
      }
      K.w16(x+0x16, 0x300);
      K.setState(x, 0xBD60);
    };
    C[0x01BD60] = function (x) {
      if (K.r16(x+6) & 0x80) {
        L_01BD7E(x);
        return;
      }
      if (!K.childrenDone(x)) {
        return;
      }
      L_01BD7E(x);
    };
    // L_01BD8C: a part of the spiral: an object script, two passes, then a trailing child
    C[0x01BD8C] = function (x) {
      K.w16(x+0x22, 0xA);
      K.w16(x+0x24, 0);
      K.w16(x+6, K.r16(x+6) & 0xFF7F);
      K.w16(x+0x20, 0);
      K.w8(x+0x18, K.acquirePaletteSlot(0x80));
      K.scriptStart(x, 0x800, K.r16(x+0x30));
      K.w16(x+0x32, 2);
      K.w16(x+0x34, K.r16(x+0xB));
      K.w16(x+0x36, K.r16(x+0x10));
      K.setState(x, 0xBDD4);
    };
    C[0x01BDD4] = function (x) {
      K.scriptStep(x);
      K.objectScreen(x);
      K.addSprite(x, 0x9E17, 1, false);
      K.shotBox(x, 0x100, 0x9EE0);
      K.w16(0x42, 0);
      K.w16(0x44, 0);
      if (K.terrainHit(x)) {
        L_01BBF7(x);
        return;
      }
      var n = (K.r16(x+0x32)-1) & 0xFFFF;
      K.w16(x+0x32, n);
      if (n != 0) {
        return;
      }
      var y = K.spawn(x, 0x01BE6D, 8);
      if (y >= 0) {
        K.w16(y+0xB, K.r16(x+0x34));
        K.w16(y+0x10, K.r16(x+0x36));
        K.w16(y+0x30, K.r16(x+0x30));
      }
      K.setState(x, 0xBE2A);
    };
    C[0x01BE2A] = function (x) {
      K.scriptStep(x);
      K.objectScreen(x);
      // ★ `ADC #$40` without CLC: the carry of S_009E65's last SBC (set while y ≥ 512) adds one
      var c = K.r16(x+0x10) >= 0x200 ? 1 : 0;
      if (((K.r16(x+0x1A)+0x40+c) & 0xFFFF) >= 0x180 || ((K.r16(x+0x1C)+0x40) & 0xFFFF) >= 0x180) {
        K.setState(x, 0xBEA8);
        return;
      }
      K.addSprite(x, 0x9E17, 1, false);
      K.shotBox(x, 0x100, 0x9EE0);
      K.w16(0x42, 0);
      K.w16(0x44, 0);
      if (K.terrainHit(x)) {
        L_01BBF7(x);
      }
    };
    C[0x01BE6D] = function (x) {
      K.w16(x+0x20, 0);
      K.w8(x+0x18, K.acquirePaletteSlot(0x80));
      K.scriptStart(x, 0x800, K.r16(x+0x30));
      K.setState(x, 0xBE91);
    };
    C[0x01BE91] = function (x) {
      K.scriptStep(x);
      K.objectScreen(x);
      K.addSprite(x, 0x9E1C, 1, false);
    };
    C[0x01BEA8] = function (x) { K.kill(x); };

    // ================================================ the Force's root (part 2)
    C[0x01DE0E] = function (x) {
      if (!(K.r16(0x4A) & 4)) {
        return;
      }
      K.setState(x, 0xDE1F);
    };
    C[0x01DE1F] = function (x) {
      if (K.r16(0x4A) & 0x40) {
        L_01ED62(x);
        return;
      }
      if (K.r16(0x1743) == 0) {
        return;
      }
      if (K.forceStart) {
        K.forceStart(x);
        return;
      }
      K.events.push({kind: 'unported', what: 'Force $01:DE2F'});
      K.w16(0x1743, 0);
    };
    // L_01ED62: the Force's root goes back to waiting, its children die, $4A bit 2 off
    var L_01ED62 = function (x) {
      K.w16(0x4A, K.r16(0x4A) & ~4);
      K.setState(x, 0xDE0E);
      K.killChildren(x);
    };
    K.L_01ED62 = L_01ED62;
    // the bits' roots: $174D the upper bit (bit 1 of $4A), $178D the lower (bit 0)
    C[0x01F77C] = function (x) {
      if (K.r16(0x4A) & 2) {
        K.setState(x, 0xF78D);
      }
    };
    C[0x01F78D] = function (x) {
      if (K.r16(0x4A) & 0x40) {
        L_01F943(x);
        return;
      }
      if (K.r16(0x17CD) == 0) {
        return;
      }
      if (K.bitStart) {
        K.bitStart(x, 0xFFE8, 0xFFFF);
        return;
      }
      K.events.push({kind: 'unported', what: 'bits $01:F79D'});
      K.w16(0x17CD, 0);
    };
    C[0x01F7A5] = function (x) {
      if (K.r16(0x4A) & 1) {
        K.setState(x, 0xF7B6);
      }
    };
    C[0x01F7B6] = function (x) {
      if (K.r16(0x4A) & 0x40) {
        L_01F943(x);
        return;
      }
      if (K.r16(0x17CD) != 2) {
        return;
      }
      if (K.bitStart) {
        K.bitStart(x, 0x10, 1);
        return;
      }
      K.events.push({kind: 'unported', what: 'bits $01:F7C9'});
    };
    // L_01F943: a bit's root back to waiting, the flag bit of $4A off, the children dead
    var L_01F943 = function (x) {
      if (x == 0x174D) {
        K.w16(0x4A, K.r16(0x4A) & ~2);
        K.setState(x, 0xF77C);
      } else {
        K.w16(0x4A, K.r16(0x4A) & ~1);
        K.setState(x, 0xF7A5);
      }
      K.killChildren(x);
    };
    K.L_01F943 = L_01F943;

    // ============================================ the sprite set loader (a wave entry)
    C[0x01DD7C] = function (x) {
      var p = K.r16(x+0x30);
      if (p & 1) {
        var mask = K.d16(0xB3AA+(p >> 1));
        for (var i = 0; i < 8; i++) {
          if (mask & (1 << i)) {
            K.w16(0x1CAC+2*i, 0xFFFF);
          }
        }
        K.setState(x, 0xDDA6);
        return;
      }
      K.w16(x+0x30, K.d16(0xB362+p));
      K.w16(x+0x32, 0);
      K.setState(x, 0xDDBD);
    };
    C[0x01DDA6] = function (x) { K.kill(x); };
    C[0x01DDBD] = function (x) {
      if (K.r16(0x68)) {
        return;
      }
      var y = K.r16(x+0x30);
      for (;;) {
        var rec = K.d16(y);
        if (rec == 0) {
          var slot = K.r16(x+0x32)+1;
          if (slot >= 8) {
            K.setState(x, 0xDDE0);
            return;
          }
          K.w16(x+0x32, slot);
          y += 2;
          continue;
        }
        K.w16(x+0x30, y+2);
        K.spriteSetLoad(K.r16(x+0x32), rec);
        var next = K.r16(x+0x32)+1;
        if (next >= 8) {
          K.setState(x, 0xDDE0);
          return;
        }
        K.w16(x+0x32, next);
        return;
      }
    };
    C[0x01DDE0] = function (x) { K.kill(x); };

    // ======================================================= bank $04: fades, mosaic, palette animation
    // L_04AAF2: a palette animation record ($04:AA07 + $30): entries of kind/palette/row, a count, next
    C[0x04AAF2] = function (x) {
      K.w16(x+0x32, K.d16(0xAA07+K.r16(x+0x30)));
      K.w16(x+0x34, 1);
      K.setState(x, 0xAB0A);
    };
    C[0x04AB0A] = function (x) {
      var n = (K.r16(x+0x34)-1) & 0xFFFF;
      K.w16(x+0x34, n);
      if (n != 0) {
        return;
      }
      var y = K.r16(x+0x32);
      K.w16(2, K.d16(y+2) & 7);
      K.w16(0, K.d16(y+1) & 0xFF);
      K.paletteAnimStart(K.d16(y) & 7, K.r16(0), K.r16(2));
      var v = K.d16(y+3);
      if (v == 0) {
        K.setState(x, 0xAB56);
        return;
      }
      if (v & 0x8000) {
        K.w16(x+0x32, v);
        K.w16(x+0x34, K.d16(y+5));
        return;
      }
      K.w16(x+0x34, v);
      K.w16(x+0x32, y+5);
    };
    C[0x04AB56] = function (x) { K.kill(x); };
    // L_04AB5A: a fade in ($34 from 0), L_04AB62: a fade out ($34 from $F00, $32 negated); $30 passes a step
    C[0x04AB5A] = function (x) {
      K.w16(x+0x34, 0);
      L_04AB72(x);
    };
    C[0x04AB62] = function (x) {
      K.w16(x+0x34, 0xF00);
      K.w16(x+0x32, (-K.r16(x+0x32)) & 0xFFFF);
      L_04AB72(x);
    };
    var L_04AB72 = function (x) {
      K.w8(0x80, (K.r8(0x80) & 0xF0) | K.r8(x+0x35));
      K.events.push({kind: 'inidisp', value: K.r8(0x80)});
      K.setState(x, 0xAB89);
    };
    C[0x04AB89] = function (x) {
      var n = (K.r16(x+0x30)-1) & 0xFFFF;
      K.w16(x+0x30, n);
      if (n == 0) {
        K.setState(x, 0xAB98);
      }
    };
    C[0x04AB98] = function (x) {
      var v = (K.r16(x+0x34)+K.r16(x+0x32)) & 0xFFFF;
      if (v >= 0x1000) {
        K.setState(x, 0xABBD);
        return;
      }
      K.w16(x+0x34, v);
      K.w8(0x80, (K.r8(0x80) & 0xF0) | K.r8(x+0x35));
      K.events.push({kind: 'inidisp', value: K.r8(0x80)});
    };
    C[0x04ABBD] = function (x) { K.kill(x); };
    // L_04ABC9: the mosaic from $F down, $30 passes a step
    C[0x04ABC9] = function (x) {
      K.w16(x+0x34, 0xF00);
      K.w16(x+0x32, (-K.r16(x+0x32)) & 0xFFFF);
      K.events.push({kind: 'mosaic', value: ((K.r16(x+0x34) >> 4) | 0xF) & 0xFF});
      K.setState(x, 0xABF0);
    };
    C[0x04ABF0] = function (x) {
      var n = (K.r16(x+0x30)-1) & 0xFFFF;
      K.w16(x+0x30, n);
      if (n == 0) {
        K.setState(x, 0xABFF);
      }
    };
    C[0x04ABFF] = function (x) {
      var v = (K.r16(x+0x34)+K.r16(x+0x32)) & 0xFFFF;
      if (v >= 0x1000) {
        K.setState(x, 0xAC21);
        return;
      }
      K.w16(x+0x34, v);
      K.events.push({kind: 'mosaic', value: ((v >> 4) | 0xF) & 0xFF});
    };
    C[0x04AC21] = function (x) { K.kill(x); };

    // ======================================================= bank $08: the wave spawner
    C[0x0881A2] = function (x) {
      if (K.r16(0x4A) & 0x200) {
        K.setState(x, 0x81B3);
      }
    };
    C[0x0881B3] = function (x) {
      K.w16(0x168B, 0);
      if (K.r16(0x4A) & 0x100) {
        K.w16(0x4A, K.r16(0x4A) & ~0x200);
        K.killChildren(x);
        return;
      }
      var bank = K.r8(0x94);
      var y = K.r16(0x182B);
      var scroll = K.r16(0x1830);
      for (;;) {
        var e = K.spawnEntries[(bank << 16) | y];
        if (!e || scroll < e.scroll) {
          break;
        }
        if ((e.flags & 3) <= K.r16(0x16D5)) {
          var code = e.code;
          if (K.noEnemies && code != 0x01DD7C) {
            code = 0x01DDA6;   // ★ the harness patch: every other entry dies in its first pass
          }
          var n = K.spawn(x, code, 8);
          if (n >= 0) {
            var layer;
            if (!(e.flags & 8)) {
              layer = K.r16(0x46);
            } else {
              layer = (e.flags & 0x10) ? 0x1862 : 0x1832;
            }
            K.w16(n+0x1E, layer);
            K.w16(n+0xB, e.params[0]);
            K.w16(n+0x10, e.params[1]);
            K.w16(n+0x30, e.params[2]);
          }
        }
        y += 12;
      }
      K.w16(0x182B, y);
    };

    // ======================================================= bank $03: the restart after a death
    // L_038000: the blank, the maps cleared, then the picture of section 15 (the mother ship's hold,
    // tiles of 14, palettes and record of 15, BG1 from the record $04:9191) for 60 passes
    C[0x038000] = function (x) {
      K.w8(0x80, K.r8(0x80) | 0x0F);
      K.events.push({kind: 'inidisp', value: K.r8(0x80)});
      K.blankOn();
      K.queueMapClear(0x1892);
      K.queueMapClear(0x1832);
      K.queueMapClear(0x1862);
      K.queueStateJob(x, 0x038033);
      K.setState(x, 0x8032);
    };
    C[0x038032] = function (x) { /* waiting for the job */ };
    C[0x038033] = function (x) {
      K.events.push({kind: 'bgTiles', section: 0xE});
      K.setState(x, 0x8043);
    };
    C[0x038043] = function (x) {
      K.loadBgPalettes(0xF);
      K.setState(x, 0x8053);
    };
    C[0x038053] = function (x) {
      K.loadLevelRecord(0xF);
      K.sceneStart();
      K.level.layers[0].kind = 0;
      K.layerFromRecord(x, 0x1832, 0x9191);
      K.setState(x, 0x8077);
    };
    C[0x038077] = function (x) {
      if (!K.childrenDone(x)) {
        return;
      }
      K.w16(x+0x32, 0x3C);
      K.blankOff();
      K.setState(x, 0x80A0);
    };
    C[0x0380A0] = function (x) {
      var n = (K.r16(x+0x32)-1) & 0xFFFF;
      K.w16(x+0x32, n);
      if (n == 0) {
        K.setState(x, 0x80AD);
      }
    };
    C[0x0380AD] = function (x) { K.kill(x); };
    C[0x0380B1] = function (x) { K.kill(x); };
    C[0x038190] = function (x) { K.kill(x); };
  } // installGameCode

  // ------------------------------------------------------- ship helpers

  /** `S_01B1B0`: the trail ring `$17CF` filled with the ship's position, its index `$78` reset */
  trailInit(x) {
    for (var i = 0; i < 0x20; i += 4) {
      this.w16(0x17CF+i, this.r16(x+0xB));
      this.w16(0x17D1+i, this.r16(x+0x10));
    }
    this.w16(0x78, 0);
  } // trailInit

  /** `S_01B3A2`: the ship's position into the trail ring at `$78` (8 entries) */
  trailStep(x) {
    var y = this.r16(0x78);
    this.w16(0x17CF+y, this.r16(x+0xB));
    this.w16(0x17D1+y, this.r16(x+0x10));
    y += 4;
    if (y >= 0x20) {
      y = 0;
    }
    this.w16(0x78, y);
  } // trailStep

  /**
   * `S_01B1CB`: the ship by the joypad — the speed from `$04:9C44` by
   * `$16E3` (once, bit 7 marks it), right/left with the clamps $208-$2F0
   * and the tilt counters `$7A`, up/down with $207-$2C8, the tilt `$16`
   * (0-$4FF, $280 level) and `$7C`; then the trail.
   */
  shipMove(x) {
    var sp = this.r16(0x16E3);
    if (!(sp & 0x80)) {
      this.w16(0x16E3, sp | 0x80);
      var v = this.d16(0x9C44+((sp & 0x7F) << 1));
      this.w16(x+0xD, v);
      this.w16(x+0x12, v);
    }
    if (this.r16(0x8A) & 3) {
      // ? $01:B1EE (45 B, never run in the surveys): $8A bit 0 lifts the ship a pixel, bit 1 lowers it
      // (within $207-$2C8), both bits clear — then the joypad as usual
      var yy;
      if (this.r16(0x8A) & 1) {
        yy = (this.r16(x+0x10)-1) & 0xFFFF;
        if (yy < 0x207) {
          yy = 0x207;
        }
        this.w16(x+0x10, yy);
      } else {
        yy = (this.r16(x+0x10)+1) & 0xFFFF;
        if (yy >= 0x2C9) {
          yy = 0x2C8;
        }
        this.w16(x+0x10, yy);
      }
      this.w16(0x8A, this.r16(0x8A) & ~3);
    }
    var joy = this.r16(0x15C9);
    var a;
    if (joy & 0x100) {
      this.moveX(x);
      if (this.r16(x+0xB) >= 0x2F1) {
        this.w16(x+0xB, 0x2F0);
      }
      a = (this.r16(0x7A)+7) & 0xFFFF;
      if (a >= 0x11) {
        a = 0;
      }
      this.w16(0x7A, (a-8) & 0xFFFF);
    } else if (joy & 0x200) {
      this.moveXBack(x);
      if (this.r16(x+0xB) < 0x208) {
        this.w16(x+0xB, 0x208);
      }
      a = (this.r16(0x7A)+9) & 0xFFFF;
      if (a >= 0x11) {
        a = 0x10;
      }
      this.w16(0x7A, (a-8) & 0xFFFF);
    } else {
      a = this.r16(0x7A);
      if (a != 0) {
        this.w16(0x7A, (a >= 0x8000) ? a+1 : a-1);
      }
    }
    if (joy & 0x800) {
      this.moveYBack(x);
      if (this.r16(x+0x10) < 0x207) {
        this.w16(x+0x10, 0x207);
      }
      var t = (this.r16(x+0x16)-0x20) & 0xFFFF;
      if (t >= 0x500) {
        t = 0;
      }
      this.w16(x+0x16, t);
      a = (this.r16(0x7C)+9) & 0xFFFF;
      if (a >= 0x11) {
        a = 0x10;
      }
      this.w16(0x7C, (a-8) & 0xFFFF);
      this.trailStep(x);
      return;
    }
    if (joy & 0x400) {
      this.moveY(x);
      if (this.r16(x+0x10) >= 0x2C9) {
        this.w16(x+0x10, 0x2C8);
      }
      var t2 = (this.r16(x+0x16)+0x20) & 0xFFFF;
      if (t2 >= 0x500) {
        t2 = 0x4FF;
      }
      this.w16(x+0x16, t2);
      a = (this.r16(0x7C)+7) & 0xFFFF;
      if (a >= 0x11) {
        a = 0;
      }
      this.w16(0x7C, (a-8) & 0xFFFF);
      this.trailStep(x);
      return;
    }
    a = this.r16(0x7C);
    if (a != 0) {
      this.w16(0x7C, (a >= 0x8000) ? a+1 : a-1);
    }
    var tilt = this.r16(x+0x16);
    this.w16(x+0x16, tilt >= 0x280 ? tilt-0x20 : tilt+0x20);
    this.trailStep(x);
  } // shipMove

  /**
   * `S_01B148`'s first half (also inline in `L_01A8F9`): the ship's tiles
   * by the tilt's high byte — two 16×16 groups into the buffer's slots 0
   * and $A when they change (`$15DF`, `$15E1`).
   */
  shipTiles(x) {
    var y = ((this.r16(x+0x16) >> 8) & 0xFF) << 1;
    var tile = this.d16(0x9C5B+y);
    if (this.r16(0x15DF) != tile) {
      this.w16(0, 0);
      this.shipTileCopy(tile, true);
    }
    this.w16(0x15DF, tile);
    tile = this.d16(0x9C65+y);
    if (this.r16(0x15E1) != tile) {
      this.w16(0, 0xA);
      this.shipTileCopy(tile, false);   // S_009B66: one tile
    }
    this.w16(0x15E1, tile);
  } // shipTiles

  /** `S_01B148`: the tiles, then the sprite unless the entry's blink (`$8A` bit 3 and `$50` bit 1) hides it */
  shipTilesAndSprite(x) {
    this.shipTiles(x);
    // S_01B148: with $8A bit 3 the sprite shows only on the passes with bit 1 of $50 set
    if ((this.r16(0x8A) & 8) && !(this.r16(0x50) & 2)) {
      return;
    }
    this.addSprite(x, 0x9C52, 1, true);
  } // shipTilesAndSprite

  /**
   * `S_01B3C1`: B held starts the charge task (once, `$58` = 0 → 1), the
   * bits come when `$1689` asks and `$1687` allows; a press of B with
   * fewer than three shots fires one (and the muzzle flash).
   */
  fireStep(x) {
    var joy = this.r16(0x15C9);
    if (joy & 0x8000) {
      var ok = true;
      if (this.r16(0x58) == 0) {
        ok = this.spawn(x, 0x01B8D6, 8) >= 0;
        if (ok) {
          this.w16(0x58, this.r16(0x58)+1);
        }
      }
      if (ok && this.r16(0x1687) == 0 && this.r16(0x1689) != 0) {
        // L_01B3E9: one bit ($01:FC4A) or two ($01:F968) — part 2
        var bits = this.r8(0x1689)-1;
        this.spawn(x, bits == 0 ? 0x01FC4A : 0x01F968, 8);
      }
    }
    if (this.r16(x+0x3E) >= 3 || !(this.r16(0x15CB) & 0x8000)) {
      return;
    }
    if (this.spawn(x, 0x01B48C, 8) < 0) {
      return;
    }
    this.w16(x+0x3E, this.r16(x+0x3E)+1);
    this.sound(0);
    this.spawn(x, 0x01B437, 8);
  } // fireStep

  /** the metasprite of an animation: the table +$14 indexed by the phase's high byte +$17 */
  animFrame(x) {
    return this.d16(this.r16(x+0x14)+(this.r8(x+0x17) << 1));
  } // animFrame

  /**
   * `L_01B936` / `L_01B9C5`: the charging beam's sprite — in front of the
   * ship, the animation table's two columns by the pass parity, the phase
   * wrapping at `limit`.
   */
  chargeSprite(x, limit) {
    this.w16(x+0xB, this.r16(0x1594)+8+this.r16(0x15E5));
    this.w16(x+0x10, this.r16(0x1599));
    this.objectScreen(x);
    var col = this.d16(this.r16(x+0x14)+((this.r16(0x50) & 1) << 1));
    this.addSprite(x, this.d16(col+(this.r8(x+0x17) << 1)), 1, false);
    var v = (this.r16(x+0x16)+0x80) & 0xFFFF;
    if (v >= limit) {
      v &= 0xFF;
    }
    this.w16(x+0x16, v);
  } // chargeSprite

} // Ship

if (typeof globalThis !== 'undefined') { globalThis.Ship = Ship; }
if (typeof module !== 'undefined' && module.exports) { module.exports = Ship; }
