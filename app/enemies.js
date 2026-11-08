// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The enemies of Super R-Type — the objects of bank `$02` the wave lists
 * spawn (`data/waves.json`, `sources/docs/disasm_notes.md` §10), carried
 * over state by state onto the kernel of `app/gameKernel.js`: the POW
 * armour and the items it drops, the patrolling flyers of every level,
 * the turrets, the walkers, the formations and their shots. The objects
 * of bank `$03` (the explosions, the enemies' shots, the level-bound
 * enemies) are `app/enemiesLevel.js`, the bosses of bank `$08`
 * `app/bosses.js`.
 *
 * ★ Every object is a task node with the variables at the original's
 * offsets (+$30-+$3E its own: the parameters of the wave entry in +$30
 * and +$31, the timers, the targets) and every state is the original's
 * address. The blocks every object repeats inline — the registration in
 * the enemy list, the animation frame into a sprite group, the phase
 * that wraps or ends, the hit test with its flash, the aimed shot, the
 * explosion — are the kernel's idioms (`GameKernel` from `anim` on), the
 * comments give the original's labels. The tables are bank `$04`
 * (`data/ship.json`), read by address; the object scripts are bank `$06`.
 * The states no coverage scenario ran (`sources/asm/coverage.txt`) were
 * read statically (`tools/sdis65816.py`) and are marked `?` here.
 *
 * Measured by `tools/matchenemies.mjs` against the RAM of the running
 * original (`tools/traceenemies.py`), frame by frame.
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installEnemyCode(K) {
  var C = K.code;
  /** `JML task_kill` */
  var kill = function (x) { K.kill(x); };
  /** the shot that the ship's hits do not stop (one hit point taken, the flash) — the common block */
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };

  // ============================================================ the POW armour ($02:8000) and its items
  // L_028000: the carrier of a power-up — +$30 says which (0-4 a laser, 5 speed, 6 a bit, 7-8 missiles)
  C[0x028000] = function (x) {
    if (K.r16(x+0x31) & 1) {
      if (!(K.r16(0x84) & 1)) {
        K.setState(x, 0x8016);   // not on this difficulty
        return;
      }
      K.w16(x+0x30, K.r16(x+0x30) & 0xF);
    }
    if (K.r16(0x84) & 1) {
      // ? $02:802A: on the hard difficulty the speed item comes only while the ship is slow
      if (K.r16(x+0x30) == 5 && (K.r16(0x16E3) & 0x7F) >= 2) {
        K.setState(x, 0x8044);
        return;
      }
    }
    // L_028048
    K.slotsOf(x, 5);
    K.body(x, 1);
    K.pal(x, K.r16(x+0x30) < 5 ? 0x83 : 0x84);
    // L_02808A
    K.scriptStart(x, 0x140, 0xA650);
    K.w16(x+0x14, 0xCEFF);
    K.setState(x, 0x80A3);
  };
  C[0x028016] = kill;
  C[0x028044] = kill;
  // L_0280A3: on the script, probing the ground below, the ceiling above and the wall behind
  C[0x0280A3] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    if (K.offRight(x, 0x11, 0x122)) { L_0285A1(x); return; }
    K.addSprite(x, K.r16(x+0x14), 2, true);
    if (K.hit(x, 0xCF49)) { L_02852A(x); return; }
    if (probe(x, 0, 0xA)) { L_028165(x); return; }
    if (!probe(x, 0, 0xFFE9) && !probe(x, 0xFFEF, 0)) { return; }
    // L_02810C: falls
    K.w16(x+0x12, 0x100);
    K.setState(x, 0x811B);
  };
  C[0x02811B] = function (x) {
    K.listAdd(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    if (K.offBottom(x, 0, 0xE0)) { L_0285A1(x); return; }
    K.addSprite(x, K.r16(x+0x14), 2, true);
    if (K.hit(x, 0xCF49)) { L_02852A(x); return; }
    if (probe(x, 0, 0xA)) { L_028165(x); }
  };
  // L_028165: landed — the turn
  var L_028165 = function (x) {
    K.w16(x+0x14, 0xCF21);
    K.w16(x+0x16, 0);
    K.setState(x, 0x8177);
  };
  C[0x028177] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    K.drawAnim(x, 2, true);
    if (K.hit(x, 0xCF49)) { L_02852A(x); return; }
    if (!K.phaseEnd(x, 0x40, 0x400)) { return; }
    // L_0281C8: walks left
    K.w16(x+0x14, 0xCF29);
    K.w16(x+0x16, 0);
    K.w16(x+0xD, 0xFF00);
    K.setState(x, 0x81E0);
  };
  C[0x0281E0] = function (x) {
    K.listAdd(x);
    K.moveXSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    if (K.offRight(x, 0x11, 0x122)) { L_0285A1(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x20, 0x400);
    if (K.hit(x, 0xCF49)) { L_02852A(x); return; }
    if (!probe(x, 0xFFEF, 0xA)) { L_0284BF(x); return; }
    if (probe(x, 0xFFEF, 0)) { L_02826B(x); return; }
    if (probe(x, 0xFFEF, 9)) { L_02826B(x); }
  };
  // L_02826B: stands up to jump
  var L_02826B = function (x) {
    K.w16(x+0x14, 0xCF31);
    K.w16(x+0x16, 0);
    K.setState(x, 0x827D);
  };
  C[0x02827D] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x40, 0x400)) {
      // L_0282CE: the jump on a script
      K.w16(x+0x10, K.r16(x+0x10)-8);
      K.scriptStart(x, 0x140, 0xA66C);
      K.w16(x+0x14, 0xCF0C);
      K.setState(x, 0x82F1);
      return;
    }
    if (K.hit(x, 0xCF49)) { L_02852A(x); }
  };
  // ? L_0282F1: in the air, the same probes as L_0280A3
  C[0x0282F1] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    if (K.offRight(x, 0x11, 0x122)) { L_0285A1(x); return; }
    K.addSprite(x, K.r16(x+0x14), 2, true);
    if (K.hit(x, 0xCF49)) { L_02852A(x); return; }
    if (probe(x, 0, 0xA)) { L_0283B3(x); return; }
    if (!probe(x, 0, 0xFFE9) && !probe(x, 0x10, 0)) { return; }
    K.w16(x+0x12, 0x100);
    K.setState(x, 0x8369);
  };
  C[0x028369] = function (x) {
    K.listAdd(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    if (K.offBottom(x, 0, 0xE0)) { L_0285A1(x); return; }
    K.addSprite(x, K.r16(x+0x14), 2, true);
    if (K.hit(x, 0xCF49)) { L_02852A(x); return; }
    if (probe(x, 0, 0xA)) { L_0283B3(x); }
  };
  var L_0283B3 = function (x) {
    K.w16(x+0x14, 0xCF39);
    K.w16(x+0x16, 0);
    K.setState(x, 0x83C5);
  };
  C[0x0283C5] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    K.drawAnim(x, 2, true);
    if (K.hit(x, 0xCF49)) { L_02852A(x); return; }
    if (!K.phaseEnd(x, 0x40, 0x400)) { return; }
    // L_028416: walks right
    K.w16(x+0x14, 0xCF41);
    K.w16(x+0x16, 0);
    K.w16(x+0xD, 0x100);
    K.setState(x, 0x842E);
  };
  C[0x02842E] = function (x) {
    K.listAdd(x);
    K.moveXSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    if (K.offRight(x, 0x11, 0x122)) { L_0285A1(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x20, 0x400);
    if (K.hit(x, 0xCF49)) { L_02852A(x); return; }
    if (!probe(x, 0x10, 0xA)) { L_02826B(x); return; }
    if (probe(x, 0x10, 0)) { L_0284BF(x); return; }
    if (probe(x, 0x10, 9)) { L_0284BF(x); }
  };
  // L_0284BF: turns to the left
  var L_0284BF = function (x) {
    K.w16(x+0x14, 0xCF19);
    K.w16(x+0x16, 0);
    K.setState(x, 0x84D1);
  };
  C[0x0284D1] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCF49, true);
    K.drawAnim(x, 2, true);
    if (!K.phaseEnd(x, 0x40, 0x400)) { return; }
    // L_028513: the jump back, then the first state's script
    K.w16(x+0x10, K.r16(x+0x10)-8);
    K.scriptStart(x, 0x140, 0xA65C);
    K.w16(x+0x14, 0xCEFF);
    K.setState(x, 0x80A3);
  };
  // L_02852A: shot — the item of +$30 (a child of the spawner), the explosion
  var L_02852A = function (x) {
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.scoreAdd(2);
    var kind = K.r8(x+0x30);
    var code;
    if (kind < 5) { code = 0x0285D8; }
    else if (kind == 5) { code = 0x0285C2; }
    else if (kind == 6) { code = 0x0285AC; }
    else { code = 0x0285FC; }
    var y = K.spawn(0x17FB, code, 8);
    if (y >= 0) {
      K.w16(y+0x30, K.r16(x+0x30));
      K.w16(y+0x1E, K.r16(x+0x1E));
      K.w16(y+0xB, K.r16(x+0xB));
      K.w16(y+0x10, K.r16(x+0x10)-8);
    }
    // L_02858C
    K.w16(x+0x1C, K.r16(x+0x1C)-8);
    K.explode(x, EXPLODE, true);
    K.sound(0x13);
    L_0285A1(x);
  };
  var L_0285A1 = function (x) { K.setState(x, 0x85A8); };
  C[0x0285A8] = kill;
  // the items: a handler (+$34) the touch runs, a metasprite (+$32)
  var item = function (x, handler, meta) {
    K.w16(x+0x34, handler);
    K.w16(x+0x32, meta);
    K.w16(x+0x20, 0);
    K.setState(x, 0x8631);
  };
  C[0x0285AC] = function (x) { K.pal(x, 0x81); item(x, 0x86CD, 0xCF5E); };   // ? the bit
  C[0x0285C2] = function (x) { K.pal(x, 0x82); item(x, 0x865D, 0xCF4F); };   // the speed
  C[0x0285D8] = function (x) { K.setState(x, 0x85E1); };
  C[0x0285E1] = function (x) { K.pal(x, K.d16(0xCF69+2*K.r16(x+0x30))); item(x, 0x869C, 0xCF54); };   // a laser
  C[0x0285FC] = function (x) { K.setState(x, 0x8605); };
  C[0x028605] = function (x) { K.pal(x, K.d16(0xCF69+2*K.r16(x+0x30))); item(x, 0x86BA, 0xCF59); };   // the missiles
  C[0x028631] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x11, 0x122)) { L_0286E0(x); return; }
    K.addSprite(x, K.r16(x+0x32), 2, true);
    if (!K.touchesShip(x, 0xCF63, false)) { return; }
    switch (K.r16(x+0x34)) {
      case 0x865D:   // the speed up: a spark on the ship, $16E3 one step up (bit 7 cleared — the ship rereads the table)
        K.sound(0xE);
        K.sound(0xD);
        var s = K.spawn(SHIP, 0x01B863, 16);
        if (s >= 0) {
          K.w16(s+0xB, 0xFFF6);
          K.w16(s+0x10, 0);
        }
        var sp = K.r16(0x16E3) & 0x7F;
        if (sp < 6) {
          K.w16(0x16E3, sp+1);
        }
        break;
      case 0x869C:   // a laser: its kind, the Force one stage up
        K.sound(0xD);
        K.w16(0x1745, K.r16(x+0x30));
        var st = K.r16(0x1743) & 0x7F;
        if (st < 3) {
          K.w16(0x1743, st+1);
        }
        break;
      case 0x86BA:   // ? the missiles: 7 → one, 8 → two
        K.sound(0xD);
        K.w16(0x1689, K.r16(x+0x30)-6);
        break;
      case 0x86CD:   // ? the bit: one more, two at most
        K.sound(0xD);
        if (K.r16(0x17CD) != 2) {
          K.w16(0x17CD, K.r16(0x17CD)+1);
        }
        break;
    }
    L_0286E0(x);
  };
  var L_0286E0 = function (x) { K.setState(x, 0x86E7); };
  C[0x0286E7] = kill;

  // ============================================================ the flyer on a script ($02:86EB)
  // L_0286EB: the most common enemy — one of four scripts by +$30, the shot timers of the difficulty
  C[0x0286EB] = function (x) {
    K.w16(x+0x14, 0xCFB7);
    K.w16(x+0x16, 0);
    K.slotsOf(x, 2);
    K.body(x, 1);
    K.pal(x, 0x85);
    K.scriptStart(x, 0x100, K.d16(0xCFCF+2*(K.r16(x+0x30) & 3)));
    var p = K.diffParams(x);
    K.w16(x+0x32, p[0]);
    K.w16(x+0x34, p[1]);
    K.setState(x, 0x8764);
  };
  C[0x028764] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xCFC9, true);
    if (K.offRight(x, 0x11, 0x122)) { L_028823(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x40, 0x600);
    if (K.hit(x, 0xCFC3)) {
      // L_028811
      K.scoreAdd(2);
      K.explode(x, EXPLODE, true);
      K.sound(0x12);
      L_028823(x);
      return;
    }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    if (K.aimedShot(x) >= 0) {
      K.w16(x+0x32, K.r16(x+0x34));
    }
  };
  var L_028823 = function (x) { K.endAt(x, 0x8833); };
  C[0x028833] = kill;

  // ============================================================ the hunter ($02:8F30)
  // L_028F30: flies in, then follows the ship within the screen, shoots when it has it in line
  C[0x028F30] = function (x) {
    K.w16(x+0x14, 0xD4DD);
    K.w16(x+0x16, 0);
    K.slotsOf(x, 6);
    K.body(x, 1);
    K.pal(x, 0x8E);
    K.w16(x+0xD, 0x80);
    K.w16(x+0x12, 0x80);
    K.w16(x+6, K.r16(x+6) | 0x4000);
    K.w16(x+0x38, K.d16(0xD4F3+2*(K.r16(x+0x30) & 3)));
    var p = K.diffParams(x);
    K.w16(x+0x34, p[0]);
    K.w16(x+0x36, p[1]);
    K.setState(x, 0x8FB9);
  };
  C[0x028FB9] = function (x) {
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xD4ED, true);
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x10, 0x400);
    if (K.hit(x, 0xD4ED)) { L_02926E(x); return; }
    if (K.r16(x+0x1A) >= 0xE0) { return; }
    L_02900A(x);
  };
  var L_02900A = function (x) { K.setState(x, 0x9013); };
  C[0x029013] = function (x) {
    K.listAdd(x);
    var a = (K.r16(x+0x1A)-8) & 0xFFFF;
    if (a >= shipX()) {
      // L_029046: the ship is behind
      K.moveXBack(x);
      K.w16(x+6, K.r16(x+6) | 0x4000);
      K.w16(x+0x14, 0xD4DD);
    } else if (((a+0x10) & 0xFFFF) < shipX()) {
      // ? $02:9034: the ship is ahead
      K.moveX(x);
      K.w16(x+6, K.r16(x+6) & 0xBFFF);
      K.w16(x+0x14, 0xD4E5);
    }
    // L_029059
    a = (K.r16(x+0x1C)-8) & 0xFFFF;
    if (a >= shipY()) {
      K.moveYBack(x);
    } else if (((a+0x10) & 0xFFFF) < shipY()) {
      K.moveY(x);   // ? $02:906E
    }
    // L_029078
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xD4ED, true);
    if (K.offRight(x, 0x10, 0x120)) { L_029280(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x10, 0x400);
    K.w16(x+0x38, K.r16(x+0x38)-1);
    if (K.r16(x+0x38) == 0) { L_0291D6(x); return; }
    if (K.hit(x, 0xD4ED)) { L_02926E(x); return; }
    var dx = (K.r16(x+6) & 0x4000) ? 0xFFF0 : 0x10;
    if (probe(x, dx, 0)) { L_029159(x); return; }
    if (probe(x, dx, 0)) { L_029159(x); return; }
    if (probe(x, dx, 0x10)) { L_029159(x); return; }
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) != 0) { return; }
    // ? $02:9112: the aimed shot
    if (K.aimedShot(x) >= 0) {
      K.w16(x+0x34, K.r16(x+0x36));
    }
  };
  // ? L_029159: a wall ahead — stands a while
  var L_029159 = function (x) {
    K.w16(x+0x32, 0x3C);
    K.setState(x, 0x9168);
  };
  C[0x029168] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xD4ED, true);
    if (K.offRight(x, 0x10, 0x120)) { L_029280(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x10, 0x400);
    K.w16(x+0x38, K.r16(x+0x38)-1);
    if (K.r16(x+0x38) == 0) { L_0291D6(x); return; }
    if (K.hit(x, 0xD4ED)) { L_02926E(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) { L_02900A(x); }
  };
  // L_0291D6: the time is up — leaves to the left
  var L_0291D6 = function (x) {
    K.w16(x+0x14, 0xD4DD);
    K.w16(x+0x16, 0);
    K.setState(x, 0x91E8);
  };
  C[0x0291E8] = function (x) {
    K.listAdd(x);
    K.moveXBack(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xD4ED, true);
    if (K.offRight(x, 0x10, 0x120)) { L_029280(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x10, 0x400);
    if (K.hit(x, 0xD4ED)) { L_02926E(x); return; }
    if (!probe(x, 0xFFF3, 0xFFF9)) { return; }
    if (!probe(x, 0xFFF3, 8)) { return; }
    K.w16(x+0xD, 0);
  };
  var L_02926E = function (x) {
    K.explode(x, EXPLODE, true);
    K.scoreAdd(2);
    K.sound(0x12);
    L_029280(x);
  };
  var L_029280 = function (x) { K.endAt(x, 0x9290); };
  C[0x029290] = kill;

  // ============================================================ ? the battery ($02:9294)
  // ? L_029294: a gun post that plays its scripts in turn (+$36), spawns a sentry (L_029754) and
  // ? satellites (L_02953A), fires at the ship, and dies with a small explosion
  C[0x029294] = function (x) {
    K.pal(x, K.d16(0xD5E5+2*K.r16(x+0x30)));
    K.pal2(x, 0x80);
    K.slotsOf(x, 0xD);
    K.w16(x+0x36, 0);
    K.w16(x+0x16, 0);
    K.w16(x+0x22, K.d16(0xD5DB+K.r16(0x88)));
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    L_0292D9(x);
  };
  var L_0292D9 = function (x) {
    var tbl = K.d16(0xD5D5+2*K.r16(x+0x30));
    K.scriptStart(x, 0x100, K.d16(tbl+K.r16(x+0x36)));
    K.w16(x+0x32, 1);
    K.w16(x+0x38, 0x28);
    K.w16(x+0x3E, 3);
    var y = K.spawn(x, 0x029754, 16);
    if (y >= 0) {
      K.w16(y+0x1E, K.r16(x+0x1E));
      K.w16(y+0x36, K.r16(x+0x30));
    }
    K.setState(x, 0x9329);
  };
  /** the frame of the two-column table $D5BD (+$34 picks the column: the ship behind or ahead) */
  var batteryFrame = function (x) {
    var tbl = K.d16(0xD5BD+K.r16(x+0x34));
    return K.d16(tbl+(K.r8(x+0x17) << 1));
  };
  C[0x029329] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreen(x);
    K.touchesShip(x, 0xD5AF, true);
    if (K.offRight(x, 0x20, 0x140)) { L_029940(x); return; }
    if (K.offBottom(x, 0x20, 0x110)) { L_029940(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) {
      K.w16(x+0x34, K.r16(x+0x1A) >= shipX() ? 0 : 2);
      K.w16(x+0x32, 4);
    }
    K.addSprite(x, batteryFrame(x), 2, true);
    K.phaseWrap(x, 0x80, 0x200);
    if (K.hitBlink(x, 0x0700, 0xD5AF)) { L_02992E(x); return; }
    K.w16(x+0x38, K.r16(x+0x38)-1);
    if (K.r16(x+0x38) == 0) {
      var y = K.spawn(x, 0x029886, 16);
      if (y >= 0) {
        K.w16(y+0x34, K.r16(x+0x34));
        K.w16(y+0xB, K.r16(x+0xB));
        K.w16(y+0x36, K.r16(x+0x30));
        K.w16(x+0x38, 0x32);
        K.w16(x+0x3E, K.r16(x+0x3E)-1);
        if (K.r16(x+0x3E) == 0) {
          K.w16(x+0x38, 0xFFF);
        }
      }
    }
    if (K.r16(x+0x2E) != 0) { return; }
    // the script stopped: four satellites
    for (var i = 0; i < 4; i++) {
      var s = K.spawn(x, 0x02953A, 16);
      if (s < 0) { break; }
      K.w16(s+0x30, 2*i);
      K.w16(s+0x34, K.r16(x+0x34));
      K.w16(s+0xB, 0);
      K.w16(s+0x10, 0);
      K.w16(s+0x36, K.r16(x+0x30));
    }
    // L_0294C0
    K.w16(x+0x32, 0x12C);
    K.setState(x, 0x94CF);
  };
  C[0x0294CF] = function (x) {
    K.touchesShip(x, 0xD5AF, true);
    K.addSprite(x, batteryFrame(x), 2, true);
    K.phaseWrap(x, 0x80, 0x200);
    if (K.hitBlink(x, 0x0700, 0xD5AF)) { L_02992E(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    K.w16(x+0x36, K.r16(x+0x36)+2);
    L_0292D9(x);
  };
  // ? L_02953A: a satellite on a script, then aimed at the ship
  C[0x02953A] = function (x) {
    K.slotsOf(x, 0xD);
    K.body(x, 1);
    var tbl = K.d16(0xD6F5+K.r16(x+0x34));
    K.scriptStart(x, 0x100, K.d16(tbl+K.r16(x+0x30)));
    K.pal(x, K.d16(0xD5E5+2*K.r16(x+0x36)));
    K.setState(x, 0x9587);
  };
  C[0x029587] = function (x) {
    K.scriptStep(x);
    K.objectScreenParent(x);
    K.touchesShip(x, 0xD705, true);
    K.addSprite(x, K.d16(0xD68B+2*K.r8(x+0x2D)), 2, false);
    if (K.r16(x+0x2E) != 0) { return; }
    K.w16(x+0x32, K.d16(0xD6FD+K.r16(x+0x30)));
    K.setState(x, 0x95BE);
  };
  C[0x0295BE] = function (x) {
    K.objectScreenParent(x);
    K.touchesShip(x, 0xD705, true);
    var dir = K.directionTo(x, SHIP);
    K.w16(x+0x38, dir);
    K.addSprite(x, K.d16(0xD68B+2*dir), 2, true);
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    var y = K.spawn(0x17FB, 0x029695, 16);
    if (y >= 0) {
      K.w16(y+0x30, K.r16(x+0x38));
      K.w16(y+0x1E, K.r16(x+0x1E));
      K.w16(y+0x1A, K.r16(x+0x1A));
      K.w16(y+0x1C, K.r16(x+0x1C));
      K.w16(x+0x32, 0x1E);
      K.w16(y+0x36, K.r16(x+0x36));
    }
    K.setState(x, 0x9627);
  };
  C[0x029627] = function (x) {
    K.objectScreenParent(x);
    K.touchesShip(x, 0xD705, true);
    var dir = K.directionTo(x, SHIP);
    K.w16(x+0x38, dir);
    K.addSprite(x, K.d16(0xD68B+2*dir), 2, true);
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    var tbl = K.d16(0xD6F9+K.r16(x+0x34));
    K.scriptStart(x, 0x100, K.d16(tbl+K.r16(x+0x30)));
    K.setState(x, 0x966D);
  };
  C[0x02966D] = function (x) {
    K.scriptStep(x);
    K.objectScreenParent(x);
    K.touchesShip(x, 0xD705, true);
    K.addSprite(x, K.d16(0xD68B+2*K.r8(x+0x2D)), 2, false);
    if (K.r16(x+0x2E) == 0) { L_029940(x); }
  };
  // ? L_029695: the satellite's shot in one of 16 directions
  C[0x029695] = function (x) {
    K.slotsOf(x, 0xD);
    K.body(x, 1);
    var tbl = K.d16(0xD6CB+K.r16(0x88));
    K.w16(x+0x14, K.d16(0xD6AB+2*K.r16(x+0x30)));
    var i = 4*K.r16(x+0x30);
    K.w16(x+0xD, K.d16(tbl+i));
    K.w16(x+0x12, K.d16(tbl+2+i));
    K.objectFromScreen(x);
    K.pal(x, K.d16(0xD5E5+2*K.r16(x+0x36)));
    K.sound(0x3B);
    K.setState(x, 0x96FB);
  };
  C[0x0296FB] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (K.offRight(x, 0x10, 0x120)) { L_029940(x); return; }
    if (K.offBottom(x, 0x10, 0xF0)) { L_029940(x); return; }
    if (probe(x, 0, 0)) {
      // L_029741
      K.objectBindLayer(x);
      K.explode(x, EXPLODE, true);
      K.setState(x, 0x9750);
      return;
    }
    K.addSprite(x, K.r16(x+0x14), 2, true);
    K.touchesShip(x, 0xD70B, true);
  };
  C[0x029750] = kill;
  // ? L_029754: the sentry riding on the battery — spawns the bombs (L_0297E8) and dies with the parent
  C[0x029754] = function (x) {
    K.w16(x+0x3A, 0x28);
    K.w16(x+0x3C, 0x20);
    K.w16(x+0x3E, 0);
    K.setState(x, 0x976F);
  };
  C[0x02976F] = function (x) {
    var p = K.r16(x+8);
    K.w16(x+0x1A, K.r16(p+0x1A));
    K.w16(x+0x1C, K.r16(p+0x1C));
    K.w16(x+0x16, K.r16(p+0x16));
    K.w16(x+0x3A, K.r16(x+0x3A)-1);
    if (K.r16(x+0x3A) == 0) {
      K.w16(x+0x34, K.r16(p+0x34));
      var y = K.spawn(x, 0x0297E8, 16);
      if (y >= 0) {
        K.w16(y+0x30, K.r16(x+0x3E));
        K.w16(y+0x34, K.r16(x+0x34));
        K.w16(y+0xB, 0);
        K.w16(y+0x10, 0xFFFF);
        K.w16(y+0x36, K.r16(x+0x36));
        K.sound(0x1B);
        K.w16(x+0x3E, 4);
        K.w16(x+0x3A, 4);
        K.w16(x+0x3C, K.r16(x+0x3C)-1);
        if (K.r16(x+0x3C) == 0) { L_0297DD(x); return; }
      }
    }
    // L_0297D4
    if (K.r16(p+0x2E) == 0) { L_0297DD(x); }
  };
  var L_0297DD = function (x) { K.setState(x, 0x97E4); };
  C[0x0297E4] = kill;
  // ? L_0297E8: a bomb of the sentry, drawn by the parent's phase
  C[0x0297E8] = function (x) {
    K.slotsOf(x, 0xD);
    K.body(x, 1);
    K.w16(x+0x14, K.d16(0xD747+K.r16(x+0x34)+K.r16(x+0x30)));
    K.w16(x+0xD, K.d16(0xD755+K.r16(x+0x34)));
    K.pal(x, K.d16(0xD5E5+2*K.r16(x+0x36)));
    K.setState(x, 0x9835);
  };
  C[0x029835] = function (x) {
    K.moveXSigned(x);
    K.objectScreenParent(x);
    if (K.offRight(x, 0x10, 0x120)) { L_029940(x); return; }
    var p = K.r16(x+8);
    K.addSprite(x, K.d16(K.r16(x+0x14)+(K.r8(p+0x17) << 1)), 2, false);
    if (probe(x, 0, 0)) {
      K.objectBindLayer(x);
      K.explode(x, EXPLODE, true);
      K.setState(x, 0x9882);
      return;
    }
    K.touchesShip(x, 0xD74F, true);
  };
  C[0x029882] = kill;
  // ? L_029886: a shell dropped from the battery, flying along the ground
  C[0x029886] = function (x) {
    K.slotsOf(x, 0xD);
    K.body(x, 1);
    K.w16(x+0x14, K.d16(0xD7A3+K.r16(x+0x34)));
    K.w16(x+0x16, 0);
    K.w16(x+0xD, K.d16(0xD7AD+K.r16(x+0x34)));
    K.pal(x, K.d16(0xD5E5+2*K.r16(x+0x36)));
    K.setState(x, 0x98D3);
  };
  C[0x0298D3] = function (x) {
    K.moveXSigned(x);
    var p = K.r16(x+8);
    K.w16(x+0x10, K.r16(p+0x10)-1);
    K.objectScreen(x);
    if (K.offRight(x, 8, 0x110)) { L_029940(x); return; }
    if (probe(x, 0, 0)) { L_029940(x); return; }
    K.drawAnim(x, 2, false);
    var v = (K.r16(x+0x16)+0x10) & 0xFFFF;
    K.w16(x+0x16, v >= 0x300 ? 0x200 : v);
    K.touchesShip(x, 0xD7A7, true);
  };
  var L_02992E = function (x) {
    K.scoreAdd(6);
    K.explode(x, EXPLODE_SMALL, false);
    K.sound(0x15);
    L_029940(x);
  };
  var L_029940 = function (x) { K.endAt(x, 0x9950); };
  C[0x029950] = kill;

  // ============================================================ the wall gun ($02:D1DD)
  // L_02D1DD: an emplacement in the terrain that opens (the map rewritten), lets the flyers of
  // L_02D514 out, closes, and leaves a hole when shot
  C[0x02D1DD] = function (x) {
    K.pal(x, 0x80);
    K.pal2(x, 0x80);
    K.w16(x+0x22, K.d16(0xE4E6+K.r16(0x88)));
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    var kind = K.r16(x+0x30) & 0xFF;
    K.w16(x+0x38, K.d16(0xE16A+2*kind));
    K.w16(x+0x3C, K.d16(0xE402+2*kind));
    K.w16(x+0x32, K.d16(0xE4F0+2*(K.r16(x+0x31) & 3)));
    K.w16(x+0x36, K.d16(0xE4F8+((K.r16(x+0x31) >> 1) & 0x1E)));
    K.setState(x, 0xD246);
  };
  C[0x02D246] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    if (K.hitBlink(x, 0x0700, K.r16(x+0x38))) { L_02D4DC(x); return; }
    if (K.r16(x+0x1A) >= K.r16(x+0x36)) { return; }
    K.w16(x+0x16, 0);
    K.w16(x+0x3E, 1);
    K.setState(x, 0xD298);
  };
  /** the door's frames: the map record of +$3C at the step +$16, every $1E passes */
  var door = function (x, after) {
    K.w16(x+0x3E, K.r16(x+0x3E)-1);
    if (K.r16(x+0x3E) != 0) { return false; }
    K.w16(x+0x3E, 0x1E);
    K.mapEnqueueRecord(K.d16(K.r16(x+0x3C)+K.r16(x+0x16)), 0x1832, false);
    if (K.r16(x+0x16) >= 4) { return true; }
    K.w16(x+0x16, K.r16(x+0x16)+2);
    return false;
  };
  C[0x02D298] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    if (K.hitBlink(x, 0x0700, K.r16(x+0x38))) { L_02D4DC(x); return; }
    if (!door(x)) { return; }
    // L_02D2F9: open
    K.w16(x+0x34, 0x1E);
    K.w16(x+0x3A, 0);
    K.setState(x, 0xD30B);
  };
  C[0x02D30B] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x21, 0x142)) { L_02D500(x); return; }
    if (K.hitBlink(x, 0x0700, K.r16(x+0x38))) { L_02D4DC(x); return; }
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) != 0) { return; }
    var y = K.spawn(0x17FB, 0x02D514, 16);
    if (y < 0) { return; }
    K.w16(y+0x30, K.r16(x+0x30));
    K.w16(y+0x31, K.d16(0xE182+2*(K.r16(x+0x3A) & 7)));
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
    K.w16(x+0x3A, K.r16(x+0x3A)+1);
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) {
      // L_02D3A1
      K.w16(x+0x34, 0x1E);
      K.setState(x, 0xD3B0);
      return;
    }
    K.w16(x+0x34, 0x14);
  };
  C[0x02D3B0] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x21, 0x142)) { L_02D500(x); return; }
    if (K.hitBlink(x, 0x0700, K.r16(x+0x38))) { L_02D4DC(x); return; }
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) != 0) { return; }
    // L_02D3FC: closes
    K.w16(x+0x3C, K.d16(0xE41A+2*(K.r16(x+0x30) & 0xFF)));
    K.w16(x+0x16, 0);
    K.w16(x+0x3E, 1);
    K.setState(x, 0xD41C);
  };
  C[0x02D41C] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x21, 0x142)) { L_02D500(x); return; }
    if (K.hitBlink(x, 0x0700, K.r16(x+0x38))) { L_02D4DC(x); return; }
    if (!door(x)) { return; }
    K.setState(x, 0xD495);
  };
  C[0x02D495] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x21, 0x142)) { L_02D500(x); return; }
    if (K.hitBlink(x, 0x0700, K.r16(x+0x38))) { L_02D4DC(x); }
  };
  var L_02D4DC = function (x) {
    K.explode(x, EXPLODE_BIG, true);
    K.scoreAdd(6);
    K.sound(0x17);
    K.mapEnqueueRecord(K.d16(0xE4CE+2*(K.r16(x+0x30) & 0xFF)), 0x1832, false);
    L_02D500(x);
  };
  var L_02D500 = function (x) { K.endAt(x, 0xD510); };
  C[0x02D510] = kill;
  // L_02D514: the flyer out of the wall gun — a script of $E5E8 by +$30, the shot timers of +$31
  C[0x02D514] = function (x) {
    K.slotsOf(x, 3);
    K.body(x, 1);
    K.pal(x, 0x86);
    K.scriptStart(x, 0x180, K.d16(0xE5E8+2*(K.r16(x+0x30) & 0xFF)));
    var p = K.diffParams(x);
    K.w16(x+0x32, p[0]);
    K.w16(x+0x34, p[1]);
    K.setState(x, 0xD584);
  };
  C[0x02D584] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xE604, true);
    if (K.offRight(x, 0x40, 0x180)) { L_02D63A(x); return; }
    if (K.offBottom(x, 0x10, 0xF0)) { L_02D63A(x); return; }
    K.addSprite(x, K.d16(0xE5C8+2*K.r8(x+0x2D)), 2, false);
    if (K.hit(x, 0xE604)) {
      K.explode(x, EXPLODE, true);
      K.scoreAdd(2);
      K.sound(0x12);
      L_02D63A(x);
      return;
    }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    if (K.aimedShot(x) >= 0) {
      K.w16(x+0x32, K.r16(x+0x34));
    }
  };
  var L_02D63A = function (x) { K.endAt(x, 0xD64A); };
  C[0x02D64A] = kill;

  if (typeof installEnemyCode2 === 'function') {
    installEnemyCode2(K);
  }
} // installEnemyCode

if (typeof globalThis !== 'undefined') { globalThis.installEnemyCode = installEnemyCode; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installEnemyCode; }
