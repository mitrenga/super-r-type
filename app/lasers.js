// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The lasers of Super R-Type — the five weapons the Force fires when it
 * is docked and B is pressed (`$1745` = the laser crystal's kind 0-4, the
 * manual's red / blue / yellow… lasers), as the original's code in bank
 * `$01` runs them: the **spawn handlers** of the table `$04:B487` (the
 * Force in front) / `$B49B` (the Force at the back), two rows a kind —
 * the Force's stage 2 and 3 (`$1743` − 2) — and the **objects** they
 * spawn, the task scheduler's nodes (`app/gameKernel.js`) with the
 * original's own fields:
 *
 * - **kind 0**, the plain laser: stage 2 fires the bits' shots (`$CED2`…,
 *   the bit objects `$CECA`… of the bits of `app/weapons.js` are here
 *   too — one code, `$CEF6` / `$CF50`) and stage 3 the growing bolt
 *   (`$CC6E` / `$CD9C`: an opening animation, then a shot that flies on,
 *   `$CD23` / `$CE51`), with `$17EF` / `$17F1` telling the bits to fire;
 * - **kind 1**, the reflecting laser: three chains of 1 or 3 **segments**
 *   (`$C55B`-`$C601`), each segment a diagonal or straight beam
 *   (`$C605`-`$CB64`) that keeps the ring of its last three positions
 *   (`S_01CC1F`) for its **trail** child (`$CB68`) and **reflects** off
 *   the terrain by the three probes around it (`$C6A1`…: which of the
 *   sides touched picks the new direction and the sprite by `$04:A063`);
 * - **kind 2**, the ground-hugging laser: two heads (`$D022`-`$D8A7`)
 *   that climb the terrain, turning by the state tables `$04:A67B`…
 *   when the wall ends or a wall is met, their trail in the rings at
 *   `$15F1` / `$1633` read by the children `$D8AB`;
 * - **kind 3**, the spread shot: 4 or 8 projectiles (`$D912`-`$DADA`)
 *   with the speeds of `$04:A6A9`…, which after $10 passes fall into a
 *   straight line;
 * - **kind 4**, the burst: a shell (`$DADE`-`$DCA3`) that flies to a
 *   distance and bursts into the sparks of `$04:A6F9` / `$A72B`
 *   (`$DCA7`-`$DD78`, drawn on odd passes, their box kind $108).
 *
 * Every counter the original keeps (`$15E7`-`$15EF` the segments per
 * chain, `$1677`-`$1685` the shots in flight) is kept at its address;
 * the sounds (`S_00A541`) go into the queue. The handlers are reached
 * through `GameKernel.laserHandler` (`app/force.js`), the objects are
 * states of the kernel's task loop. Measured by `tools/matchship.mjs`
 * (the recording `l1b`: kind 1 at the back) — the other kinds are
 * carried over from the listing (`sources/asm/main.asm` and the static
 * disassembly of what no run covered) and wait for their recordings.
 *
 * @param {GameKernel} K - The kernel to install into.
 */
function installLaserCode(K) {
  var C = K.code;
  if (!K.laserHandlers) {
    K.laserHandlers = {};
  }
  var H = K.laserHandlers;

  /** the metasprite of an animation table at the object's frame byte +$17 (`LDA $0017,X; AND #$FF; ASL; ADC table`) */
  var frameMeta = function (x, table) {
    return K.d16((table+2*K.r8(x+0x17)) & 0xFFFF);
  };
  /** `$42` / `$44` set and the terrain probed */
  var probe = function (x, dx, dy) {
    K.w16(0x42, dx & 0xFFFF);
    K.w16(0x44, dy & 0xFFFF);
    return K.terrainHit(x);
  };
  /** the Force's cell on the 8-pixel grid of the default layer (`$46`): the chain's / head's start */
  var startCell = function (x) {
    var l = K.level.layers[K.r16(0x46) == 0x1862 ? 1 : 0];
    K.w16(x+0x32, (((K.r16(x+0x1C)+((l.y >> 8) & 0xFFFF)) & 0xFFF8) | 0x0003) & 0xFFFF);
    K.w16(x+0x30, (((K.r16(x+0x1A)+((l.x >> 8) & 0xFFFF)) & 0xFFF8) | 0x0004) & 0xFFFF);
  };
  /** the phase +$16 stepped by `step`, wrapping at `limit` to its low byte (`AND #$FF; ORA #high`) */
  var phase = function (x, step, limit, high) {
    var v = (K.r16(x+0x16)+step) & 0xFFFF;
    if (v >= limit) {
      v = (v & 0xFF) | high;
    }
    K.w16(x+0x16, v);
  };
  /** `JML L_008806` through a state: the object dies in its next pass */
  var dieNext = function (x, state) {
    K.setState(x, state);
  };

  // ======================================================= the handlers of $04:B487 / $B49B

  /**
   * Kind 1 (`$F21A` / `$F21F` in front, `$F2E0` / `$F2E5` at the back):
   * `count` segments a chain, the start cell of the chains (the Force's
   * screen position plus the default layer's, on the 8-pixel grid, +4 / +3)
   * in the Force's +$30 / +$32, then the three chains unless one of the
   * kind is still in the air (`$15E7` / `$15E9` / `$15EB`).
   */
  var reflecting = function (x, count, codes) {
    K.w16(x+0x34, count);
    startCell(x);
    var counters = [0x15E7, 0x15E9, 0x15EB];
    for (var i = 0; i < 3; i++) {
      if (K.r16(counters[i]) != 0) { continue; }
      var y = K.spawn(x, codes[i], 8);
      if (y < 0) { continue; }
      K.w16(counters[i], K.r16(counters[i])+1);
      K.w16(y+0x1E, K.r16(0x46));
      K.w16(y+0xB, K.r16(x+0x30));
      K.w16(y+0x10, K.r16(x+0x32));
      K.w16(y+0x30, K.r16(x+0x34));
    }
  };
  var FRONT1 = [0x01C531, 0x01C53F, 0x01C54D], BACK1 = [0x01C55B, 0x01C569, 0x01C577];
  H[0xF21A] = function (x) { reflecting(x, 1, FRONT1); };
  H[0xF21F] = function (x) { reflecting(x, 3, FRONT1); };
  H[0xF2E0] = function (x) { reflecting(x, 1, BACK1); };
  H[0xF2E5] = function (x) { reflecting(x, 3, BACK1); };

  /**
   * Kind 2 (`$F3A6` / `$F3B1` in front, `$F456` / `$F461` at the back):
   * the same start cell, two heads (`$15ED` / `$15EF`) with `hp` hits
   * (+$36 → the child's +$22) and `count` trail entries (+$34 → +$30).
   */
  var hugging = function (x, hp, count, codes) {
    K.w16(x+0x36, hp);
    K.w16(x+0x34, count);
    startCell(x);
    var counters = [0x15ED, 0x15EF];
    for (var i = 0; i < 2; i++) {
      if (K.r16(counters[i]) != 0) { continue; }
      var y = K.spawn(x, codes[i], 8);
      if (y < 0) { continue; }
      K.w16(counters[i], K.r16(counters[i])+1);
      K.w16(y+0x1E, K.r16(0x46));
      K.w16(y+0xB, K.r16(x+0x30));
      K.w16(y+0x10, K.r16(x+0x32));
      K.w16(y+0x30, K.r16(x+0x34));
      K.w16(y+0x22, K.r16(x+0x36));
    }
  };
  H[0xF3A6] = function (x) { hugging(x, 3, 2, [0x01D02D, 0x01D1A8]); };
  H[0xF3B1] = function (x) { hugging(x, 4, 5, [0x01D02D, 0x01D1A8]); };
  H[0xF456] = function (x) { hugging(x, 3, 2, [0x01D022, 0x01D19D]); };
  H[0xF461] = function (x) { hugging(x, 4, 5, [0x01D022, 0x01D19D]); };

  /**
   * Kind 0, stage 2 (`$F506` in front, `$F58B` at the back): a shot above
   * and one below the Force (`$167B` / `$167D`, two of each in the air),
   * and the bits told to fire (`$17EF` / `$17F1`: $8000 forward, $8001
   * backward).
   */
  var pair = function (x, up, down) {
    var y;
    if (K.r16(0x167B) < 2) {
      y = K.spawn(x, up, 8);
      if (y >= 0) {
        K.w16(0x167B, K.r16(0x167B)+1);
        K.w16(y+0xB, K.r16(x+0xB));
        K.w16(y+0x10, K.r16(x+0x10)-8);
      }
    }
    if (K.r16(0x167D) < 2) {
      y = K.spawn(x, down, 8);
      if (y >= 0) {
        K.w16(0x167D, K.r16(0x167D)+1);
        K.w16(y+0xB, K.r16(x+0xB));
        K.w16(y+0x10, K.r16(x+0x10)+8);
      }
    }
  };
  var bitsFire = function (v) {
    K.w16(0x17EF, v);
    K.w16(0x17F1, v);
  };
  H[0xF506] = function (x) { pair(x, 0x01CED2, 0x01CF32); bitsFire(0x8000); };
  H[0xF58B] = function (x) { pair(x, 0x01CEE9, 0x01CF42); bitsFire(0x8001); };
  /** kind 0, stage 3 (`$F564` / `$F5E9`): one bolt at a time (`$1677`, `$1679` set while it opens) */
  var bolt = function (x, code, v) {
    if (K.r16(0x1679) == 0 && K.r16(0x1677) < 2) {
      var y = K.spawn(x, code, 8);
      if (y >= 0) {
        K.w16(0x1677, K.r16(0x1677)+1);
        K.w16(0x1679, 0xFFFF);
      }
    }
    bitsFire(v);
  };
  H[0xF564] = function (x) { bolt(x, 0x01CC6E, 0x8000); };
  H[0xF5E9] = function (x) { bolt(x, 0x01CD9C, 0x8001); };

  /** kinds 3 and 4: the object at the Force's screen position + $200 (the world), one spread (`$1681`) / two shells (`$1683`) in the air */
  var atForce = function (x, code, counter, limit) {
    if (K.r16(counter) >= limit) { return; }
    var y = K.spawn(x, code, 8);
    if (y < 0) { return; }
    K.w16(counter, K.r16(counter)+1);
    K.w16(y+0xB, (K.r16(x+0x1A)+0x200) & 0xFFFF);
    K.w16(y+0x10, (K.r16(x+0x1C)+0x200) & 0xFFFF);
  };
  H[0xF610] = function (x) { atForce(x, 0x01D912, 0x1681, 1); };
  H[0xF63C] = function (x) { atForce(x, 0x01D91A, 0x1681, 1); };
  H[0xF668] = function (x) { atForce(x, 0x01D922, 0x1681, 1); };
  H[0xF694] = function (x) { atForce(x, 0x01D92A, 0x1681, 1); };
  H[0xF6C0] = function (x) { atForce(x, 0x01DADE, 0x1683, 2); };
  H[0xF6EF] = function (x) { atForce(x, 0x01DAF8, 0x1683, 2); };
  H[0xF71E] = function (x) { atForce(x, 0x01DB86, 0x1683, 2); };
  H[0xF74D] = function (x) { atForce(x, 0x01DBA0, 0x1683, 2); };

  // ======================================================= kind 1: the chains ($C531-$C601)

  /** `$C583`: the chain's segment code and bank, one pass to the first segment */
  var chain = function (x, counter, code) {
    K.w16(x+0x38, counter);
    K.w16(x+0x36, code >> 16);
    K.w16(x+0x34, code & 0xFFFF);
    K.w16(x+0x32, 1);
    K.setState(x, 0xC599);
  };
  C[0x01C531] = function (x) { chain(x, 0x15E7, 0x01C605); };
  C[0x01C53F] = function (x) { chain(x, 0x15E9, 0x01CA51); };
  C[0x01C54D] = function (x) { chain(x, 0x15EB, 0x01C718); };
  C[0x01C55B] = function (x) { chain(x, 0x15E7, 0x01C93E); };
  C[0x01C569] = function (x) { chain(x, 0x15E9, 0x01CAD7); };
  C[0x01C577] = function (x) { chain(x, 0x15EB, 0x01C82B); };
  // L_01C599: every fourth pass a segment at the chain's cell, +$30 of them
  C[0x01C599] = function (x) {
    K.objectScreenLayer(x);
    var left = (K.r16(x+0x32)-1) & 0xFFFF;
    K.w16(x+0x32, left);
    if (left != 0) { return; }
    var y = K.spawn(x, (K.r16(x+0x36) << 16) | K.r16(x+0x34), 8);
    if (y >= 0) {
      K.w16(y+0x1E, K.r16(x+0x1E));
      K.w16(y+0xB, K.r16(x+0xB));
      K.w16(y+0x10, K.r16(x+0x10));
    }
    var n = (K.r16(x+0x30)-1) & 0xFFFF;
    K.w16(x+0x30, n);
    if (n != 0) {
      K.w16(x+0x32, 4);
      return;
    }
    K.setState(x, 0xC5DA);
  };
  // L_01C5DA: waits for its segments, then frees the chain's counter
  C[0x01C5DA] = function (x) {
    if (!K.childrenDone(x)) { return; }
    var c = K.r16(x+0x38);
    K.w16(c, (K.r16(c)-1) & 0xFFFF);
    K.setState(x, 0xC601);
  };
  C[0x01C601] = function (x) { K.kill(x); };

  // ======================================================= kind 1: the segments ($C605-$CB64)

  /** `S_01CBB2`: a segment's start — the phase, the animation table, the ring of positions, 180 passes of life, 2 hits, its trail child */
  var segmentInit = function (x, ph, table) {
    K.w16(x+0x16, ph);
    K.w16(x+0x3E, ph);
    K.w16(x+0x26, ph);
    K.w16(x+0x28, ph);
    K.w16(x+0x14, table);
    var px = K.r16(x+0xB), py = K.r16(x+0x10);
    K.w16(x+0x32, px); K.w16(x+0x34, px); K.w16(x+0x36, px);
    K.w16(x+0x38, py); K.w16(x+0x3A, py); K.w16(x+0x3C, py);
    K.w16(x+0x30, 0xB4);
    K.w16(x+0x20, 0);
    K.w16(x+0x22, 2);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w8(x+0x18, K.acquirePaletteSlot(0x80));
    var y = K.spawn(x, 0x01CB68, 8);
    if (y >= 0) {
      K.w16(y+0x1E, K.r16(x+0x1E));
      K.w16(y+0x14, K.r16(x+0x14));
    }
  };
  /** `S_01CC1F`: the ring of the last three positions and phases moves on */
  var ringShift = function (x) {
    K.w16(x+0x32, K.r16(x+0x34)); K.w16(x+0x34, K.r16(x+0x36)); K.w16(x+0x36, K.r16(x+0xB));
    K.w16(x+0x38, K.r16(x+0x3A)); K.w16(x+0x3A, K.r16(x+0x3C)); K.w16(x+0x3C, K.r16(x+0x10));
    K.w16(x+0x3E, K.r16(x+0x26)); K.w16(x+0x26, K.r16(x+0x28)); K.w16(x+0x28, K.r16(x+0x16));
  };
  /** `S_01CC56`: the frame byte +$17 from `$04:A063` by its low two bits and the direction `d` */
  var turn = function (x, d) {
    var i = ((K.r16(x+0x17) & 3) << 2) | d;
    K.w8(x+0x17, K.d8(0xA063+i));
  };
  /** the move of a diagonal segment up to the probes: false when it died (`$CB5D`) */
  var segmentHead = function (x, table, checkY) {
    if (K.r16(x+6) & 0x80) { dieNext(x, 0xCB64); return false; }
    var life = (K.r16(x+0x30)-1) & 0xFFFF;
    K.w16(x+0x30, life);
    if (life == 0) { dieNext(x, 0xCB64); return false; }
    ringShift(x);
    K.objectScreenLayer(x);
    if (((K.r16(x+0x1A)+0x20) & 0xFFFF) >= 0x140) { dieNext(x, 0xCB64); return false; }
    if (checkY && ((K.r16(x+0x1C)+0x20) & 0xFFFF) >= 0x110) { dieNext(x, 0xCB64); return false; }
    K.addSprite(x, frameMeta(x, table), 1, false);
    K.shotBox(x, 0x100, 0xA073);
    return true;
  };
  /** the three probes of a diagonal segment: bits 1, 2, 4 */
  var sides = function (x, p1, p2, p3) {
    var v = 0;
    if (probe(x, p1[0], p1[1])) { v |= 1; }
    if (probe(x, p2[0], p2[1])) { v |= 2; }
    if (probe(x, p3[0], p3[1])) { v |= 4; }
    return v;
  };
  var moveBy = function (x, dx, dy) {
    K.w16(x+0xB, (K.r16(x+0xB)+dx) & 0xFFFF);
    K.w16(x+0x10, (K.r16(x+0x10)+dy) & 0xFFFF);
  };
  /** the reflection: `v` the sides touched; `on` = [the straight case, a == 0 or 5, a == 4, a == 1] */
  var reflect = function (x, v, straight, cases) {
    if (v == 0 || !(v & 2)) { straight(); return; }
    var a = v & 5;
    var c = (a == 0 || a == 5) ? cases[0] : (a == 4 ? cases[1] : cases[2]);
    turn(x, c.d);
    if (c.dx || c.dy) { moveBy(x, c.dx || 0, c.dy || 0); }
    K.sound(9);
    K.setState(x, c.state);
  };
  // L_01C605 / L_01C617: up-right (the front chain of $15E7)
  C[0x01C605] = function (x) { segmentInit(x, 0x300, 0xA03B); K.setState(x, 0xC617); };
  C[0x01C617] = function (x) {
    if (!segmentHead(x, 0xA03B, true)) { return; }
    reflect(x, sides(x, [0, -4], [4, -4], [4, 0]),
            function () { turn(x, 3); moveBy(x, 8, -8); },
            [{d: 1, state: 0xC83D}, {d: 2, dy: -8, state: 0xC950}, {d: 0, dx: 8, state: 0xC72A}]);
  };
  // L_01C718 / L_01C72A: down-right (the front chain of $15EB)
  C[0x01C718] = function (x) { segmentInit(x, 0, 0xA03B); K.setState(x, 0xC72A); };
  C[0x01C72A] = function (x) {
    if (!segmentHead(x, 0xA03B, true)) { return; }
    reflect(x, sides(x, [4, 0], [4, 5], [0, 5]),
            function () { turn(x, 0); moveBy(x, 8, 8); },
            [{d: 2, state: 0xC950}, {d: 3, dx: 8, state: 0xC617}, {d: 1, dy: 8, state: 0xC83D}]);
  };
  // L_01C82B / L_01C83D: down-left (the back chain of $15EB)
  C[0x01C82B] = function (x) { segmentInit(x, 0x100, 0xA03B); K.setState(x, 0xC83D); };
  C[0x01C83D] = function (x) {
    if (!segmentHead(x, 0xA03B, true)) { return; }
    reflect(x, sides(x, [0, 5], [-5, 5], [-5, 0]),
            function () { turn(x, 1); moveBy(x, -8, 8); },
            [{d: 3, state: 0xC617}, {d: 0, dy: 8, state: 0xC72A}, {d: 2, dx: -8, state: 0xC950}]);
  };
  // L_01C93E / L_01C950: up-left (the back chain of $15E7)
  C[0x01C93E] = function (x) { segmentInit(x, 0x200, 0xA03B); K.setState(x, 0xC950); };
  C[0x01C950] = function (x) {
    if (!segmentHead(x, 0xA03B, true)) { return; }
    reflect(x, sides(x, [-5, 0], [-5, -4], [0, -4]),
            function () { turn(x, 2); moveBy(x, -8, -8); },
            [{d: 0, state: 0xC72A}, {d: 1, dx: -8, state: 0xC83D}, {d: 3, dy: -8, state: 0xC617}]);
  };
  // L_01CA51 / L_01CA63: straight to the right (the front chain of $15E9); a wall turns it back
  C[0x01CA51] = function (x) { segmentInit(x, 0, 0xA05B); K.setState(x, 0xCA63); };
  C[0x01CA63] = function (x) {
    if (!segmentHead(x, 0xA05B, false)) { return; }
    if (!probe(x, 4, 0)) {
      K.w16(x+0x16, 0x200);
      moveBy(x, 8, 0);
      return;
    }
    K.w16(x+0x16, 0x100);
    K.sound(9);
    K.setState(x, 0xCAE9);
  };
  // L_01CAD7 / L_01CAE9: straight to the left (the back chain of $15E9)
  C[0x01CAD7] = function (x) { segmentInit(x, 0x100, 0xA05B); K.setState(x, 0xCAE9); };
  C[0x01CAE9] = function (x) {
    if (!segmentHead(x, 0xA05B, false)) { return; }
    if (!probe(x, -5, 0)) {
      K.w16(x+0x16, 0x300);
      moveBy(x, -8, 0);
      return;
    }
    K.w16(x+0x16, 0);
    K.sound(9);
    K.setState(x, 0xCA63);
  };
  C[0x01CB64] = function (x) { K.kill(x); };
  // L_01CB68 / L_01CB82: the trail — the segment's position of three passes ago, its phase of then
  C[0x01CB68] = function (x) {
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x80));
    K.setState(x, 0xCB82);
  };
  C[0x01CB82] = function (x) {
    var y = K.r16(x+8);
    K.w16(x+0xB, K.r16(y+0x32));
    K.w16(x+0x10, K.r16(y+0x38));
    K.w16(x+0x16, K.r16(y+0x3E));
    K.objectScreenLayer(x);
    K.addSprite(x, frameMeta(x, K.r16(x+0x14)), 1, false);
  };

  // ======================================================= kind 0: the bolt ($CC6E-$CEC6)

  /** `$CC6E` / `$CD9C`: the opening at the Force, then the bolt */
  var boltOpen = function (x, table, next) {
    K.w16(x+0x14, table);
    K.w16(x+0x16, 0);
    K.w16(x+0x20, 0);
    K.w16(x+0x22, 8);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w8(x+0x18, K.acquirePaletteSlot(0x80));
    K.sound(0xA);
    K.setState(x, next);
  };
  C[0x01CC6E] = function (x) { boltOpen(x, 0xA5F7, 0xCCAA); };
  C[0x01CD9C] = function (x) { boltOpen(x, 0xA621, 0xCDD8); };
  /** `$CCAA` / `$CDD8`: at the parent's position, 11 frames of the opening; then the bolt starts `dx` away */
  var boltGrow = function (x, dx, table, next) {
    var y = K.r16(x+8);
    K.w16(x+0xB, K.r16(y+0xB));
    K.w16(x+0x10, K.r16(y+0x10));
    K.objectScreen(x);
    K.addSprite(x, frameMeta(x, K.r16(x+0x14)), 1, false);
    var v = (K.r16(x+0x16)+0x100) & 0xFFFF;
    if (v < 0xB00) {
      K.w16(x+0x16, v);
      K.shotBox(x, 0x100, 0xA653);
      return;
    }
    K.w16(x+0xB, (K.r16(x+0xB)+dx) & 0xFFFF);
    K.w16(x+0x14, table);
    K.w16(x+0x16, 0);
    K.w16(x+0x22, 8);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(0x1679, 0);
    K.setState(x, next);
  };
  C[0x01CCAA] = function (x) { boltGrow(x, 0x34, 0xA60D, 0xCD23); };
  C[0x01CDD8] = function (x) { boltGrow(x, -0x34, 0xA637, 0xCE51); };
  /** `$CD23` / `$CE51`: the bolt flies 6 a pass until the edge, the terrain or a hit */
  var boltFly = function (x, dx, px, end) {
    if (!(K.r16(x+6) & 0x80)) {
      K.w16(x+0xB, (K.r16(x+0xB)+dx) & 0xFFFF);
      K.objectScreen(x);
      if (((K.r16(x+0x1A)+0x40) & 0xFFFF) < 0x180) {
        K.addSprite(x, frameMeta(x, K.r16(x+0x14)), 1, false);
        phase(x, 0x100, 0x800, 0);
        if (!probe(x, px, 0)) {
          K.shotBox(x, 0x100, 0xA64D);
          return;
        }
      }
    }
    K.w16(0x1677, (K.r16(0x1677)-1) & 0xFFFF);
    K.setState(x, end);
  };
  C[0x01CD23] = function (x) { boltFly(x, 6, 0xF, 0xCD98); };
  C[0x01CE51] = function (x) { boltFly(x, -6, -0x10, 0xCEC6); };
  C[0x01CD98] = function (x) { K.kill(x); };
  C[0x01CEC6] = function (x) { K.kill(x); };

  // ======================================================= kind 0 / the bits: the shots ($CECA-$D01E)

  /** `$CEF6` / `$CF50`: a shot with speed `speed` (8.8, backward when negative), counted at `counter` */
  var shotInit = function (x, counter, speed, slot) {
    K.w16(x+0x3E, counter);
    K.w16(x+0xD, speed);
    if (!(speed & 0x8000)) {
      K.w16(x+0x32, 7);
      K.w16(x+0x14, 0xA5F3);
    } else {
      K.w16(x+0x32, 0xFFF8);
      K.w16(x+0x14, 0xA61D);
    }
    K.w16(x+0x16, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(slot));
    // L_01CF8A
    K.w16(x+0x20, 0);
    K.w16(x+0x22, 3);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.setState(x, 0xCFA8);
  };
  C[0x01CECA] = function (x) { shotInit(x, 0x1675, 0x0800, 0x80); };
  C[0x01CED2] = function (x) { K.sound(0x3A); shotInit(x, 0x167B, 0x0800, 0x80); };
  C[0x01CEE1] = function (x) { shotInit(x, 0x1675, 0xF800, 0x80); };
  C[0x01CEE9] = function (x) { K.sound(0x3A); shotInit(x, 0x167B, 0xF800, 0x80); };
  C[0x01CF32] = function (x) { shotInit(x, 0x167D, 0x0800, 0x81); };
  C[0x01CF3A] = function (x) { shotInit(x, 0x167F, 0x0800, 0x81); };
  C[0x01CF42] = function (x) { shotInit(x, 0x167D, 0xF800, 0x81); };
  C[0x01CF4A] = function (x) { shotInit(x, 0x167F, 0xF800, 0x81); };
  // L_01CFA8: the flight
  C[0x01CFA8] = function (x) {
    if (!(K.r16(x+6) & 0x80)) {
      K.moveXSigned(x);
      K.objectScreen(x);
      if (((K.r16(x+0x1A)+0x10) & 0xFFFF) < 0x120) {
        K.addSprite(x, frameMeta(x, K.r16(x+0x14)), 1, false);
        phase(x, 0x80, 0x200, 0);
        if (!probe(x, K.r16(x+0x32), 0)) {
          K.shotBox(x, 0x100, 0xA647);
          return;
        }
      }
    }
    // L_01D00D
    var c = K.r16(x+0x3E);
    K.w16(c, (K.r16(c)-1) & 0xFFFF);
    K.setState(x, 0xD01E);
  };
  C[0x01D01E] = function (x) { K.kill(x); };

  // ======================================================= kind 2: the ground-hugging heads ($D022-$D8A7)

  /**
   * `$D022` / `$D02D` (the ring at `$15F1`, the counter `$15ED`) and
   * `$D19D` / `$D1A8` (`$1633`, `$15EF`): the head's state table (+$32),
   * its trail ring filled with its cell and the trail children spawned
   * (3 or 6 by +$30), then the first climb.
   */
  var headInit = function (x, counter, table, ring, first) {
    K.w16(x+0x36, counter);
    K.w16(x+0x32, table);
    K.w16(x+0x34, 0);
    K.w16(x+0x14, 0xA66D);
    K.w16(x+0x16, 0);
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x81));
    K.sound(0xF);
    var yy = (K.r16(x+0x30) == 2) ? 0x18 : 0x3C;
    do {
      K.w16(ring-6+yy, K.r16(x+0xB));
      K.w16(ring+yy, K.r16(x+0xB));
      K.w16(ring-6+yy+2, K.r16(x+0x10));
      K.w16(ring+yy+2, K.r16(x+0x10));
      K.w16(ring-6+yy+4, 0xA659);
      K.w16(ring+yy+4, 0xA659);
      var y = K.spawn(x, 0x01D8AB, 8);
      if (y >= 0) {
        K.w16(y+0x1E, K.r16(x+0x1E));
        K.w16(y+0x38, ring);
        K.w16(y+0x3A, yy);
      }
      yy = (yy-0xC) & 0xFFFF;
      K.w16(x+0x30, (K.r16(x+0x30)-1) & 0xFFFF);
    } while (K.r16(x+0x30) != 0);
    K.w16(x+0x38, ring);
    K.w16(x+0x3A, 0);
    K.w16(x+0x30, 0xB4);
    K.setState(x, first);
  };
  C[0x01D022] = function (x) { headInit(x, 0x15ED, 0xA68B, 0x15F1, 0xD0CE); };
  C[0x01D02D] = function (x) { headInit(x, 0x15ED, 0xA67B, 0x15F1, 0xD0CE); };
  C[0x01D19D] = function (x) { headInit(x, 0x15EF, 0xA693, 0x1633, 0xD249); };
  C[0x01D1A8] = function (x) { headInit(x, 0x15EF, 0xA683, 0x1633, 0xD249); };
  /** the head's common pass: hit or life → the end; the move; off the picture → the end; the ring entry, the sprite, the phase, the box */
  var headStep = function (x, dx, dy, edgeX) {
    if (K.r16(x+6) & 0x80) { headEnd(x); return false; }
    var life = (K.r16(x+0x30)-1) & 0xFFFF;
    K.w16(x+0x30, life);
    if (life == 0) { headEnd(x); return false; }
    moveBy(x, dx, dy);
    K.objectScreenLayer(x);
    if (edgeX) {
      if (((K.r16(x+0x1A)+0x10) & 0xFFFF) >= 0x120) { headEnd(x); return false; }
    } else if (((K.r16(x+0x1C)+0x10) & 0xFFFF) >= 0xF0) { headEnd(x); return false; }
    var y = (K.r16(x+0x38)+K.r16(x+0x3A)) & 0xFFFF;
    K.w16(y, K.r16(x+0xB));
    K.w16(y+2, K.r16(x+0x10));
    K.w16(y+4, frameMeta(x, K.r16(x+0x14)));
    var r = K.r16(x+0x3A);
    K.w16(x+0x3A, r ? (r-6) & 0xFFFF : 0x3C);
    K.addSprite(x, K.r16(y+4), 1, false);
    phase(x, 0x80, 0x400, 0);
    K.shotBox(x, 0x100, 0xA675);
    return true;
  };
  /** `$D16B` (+1) / `$D184` (−1): the next state of the head's table */
  var headTurn = function (x, d) {
    var i = (K.r16(x+0x34)+d) & 3;
    K.w16(x+0x34, i);
    K.setState(x, K.d16((K.r16(x+0x32)+2*i) & 0xFFFF));
  };
  /** `$D869`: the ring closed with an x of 0 (the trail ends there), the children waited for, the counter freed */
  var headEnd = function (x) {
    K.w16((K.r16(x+0x38)+K.r16(x+0x3A)) & 0xFFFF, 0);
    K.setState(x, 0xD880);
  };
  C[0x01D880] = function (x) {
    if (!K.childrenDone(x)) { return; }
    var c = K.r16(x+0x36);
    K.w16(c, (K.r16(c)-1) & 0xFFFF);
    K.setState(x, 0xD8A7);
  };
  C[0x01D8A7] = function (x) { K.kill(x); };
  // the climbs: [dx, dy, edge on x?, the probe that loses the wall (null = none), the probe that meets one]
  var climbs = {
    0xD0CE: [0, -8, false, null, [0, -4]],
    0xD249: [0, 8, false, null, [0, 5]],
    0xD2E9: [0, -8, false, [-5, 0], [0, -4]],
    0xD399: [0, -8, false, [4, 0], [0, -4]],
    0xD449: [0, 8, false, [-5, 0], [0, 5]],
    0xD4F9: [0, 8, false, [4, 0], [0, 5]],
    0xD5A9: [8, 0, true, [0, 5], [4, 0]],
    0xD659: [8, 0, true, [0, -4], [4, 0]],
    0xD709: [-8, 0, true, [0, 5], [-5, 0]],
    0xD7B9: [-8, 0, true, [0, -4], [-5, 0]]
  };
  Object.keys(climbs).forEach(function (key) {
    var c = climbs[key];
    C[0x010000 | (+key)] = function (x) {
      if (!headStep(x, c[0], c[1], c[2])) { return; }
      if (c[3] && !probe(x, c[3][0], c[3][1])) { headTurn(x, -1); return; }
      if (probe(x, c[4][0], c[4][1])) { headTurn(x, 1); }
    };
  });
  // L_01D8AB / L_01D8CE: a trail entry at its ring slot, until the head closed the ring
  C[0x01D8AB] = function (x) {
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x81));
    K.w16(x+0x1E, K.r16(K.r16(x+8)+0x1E));
    K.setState(x, 0xD8CE);
  };
  C[0x01D8CE] = function (x) {
    var y = (K.r16(x+0x38)+K.r16(x+0x3A)) & 0xFFFF;
    if (K.r16(y) == 0) {
      K.setState(x, 0xD8FC);
      return;
    }
    K.w16(x+0xB, K.r16(y));
    K.w16(x+0x10, K.r16(y+2));
    K.w16(x+0x14, K.r16(y+4));
    var r = K.r16(x+0x3A);
    K.w16(x+0x3A, r ? (r-6) & 0xFFFF : 0x3C);
    K.objectScreenLayer(x);
    K.addSprite(x, K.r16(x+0x14), 1, false);
  };
  C[0x01D8FC] = function (x) { K.kill(x); };

  // ======================================================= kind 3: the spread ($D912-$DADA)

  /** `$D930`: `n` projectiles with the speeds of `table` (4 B each), at the spreader's position */
  var spread = function (x, n, table) {
    K.w16(0, n);
    K.w16(2, table);
    K.sound(0x11);
    do {
      var y = K.spawn(x, 0x01D99D, 8);
      if (y < 0) { break; }
      var t = K.r16(2);
      K.w16(y+0xD, K.d16(t));
      K.w16(y+0x12, K.d16(t+2));
      K.w16(2, t+4);
      K.w16(y+0xB, K.r16(x+0xB));
      K.w16(y+0x10, K.r16(x+0x10));
      K.w16(0, K.r16(0)-1);
    } while (K.r16(0) != 0);
    K.setState(x, 0xD979);
  };
  C[0x01D912] = function (x) { spread(x, 4, 0xA6B1); };
  C[0x01D91A] = function (x) { spread(x, 8, 0xA6A9); };
  C[0x01D922] = function (x) { spread(x, 4, 0xA6D1); };
  C[0x01D92A] = function (x) { spread(x, 8, 0xA6C9); };
  C[0x01D979] = function (x) {
    if (!K.childrenDone(x)) { return; }
    K.w16(0x1681, (K.r16(0x1681)-1) & 0xFFFF);
    K.setState(x, 0xD999);
  };
  C[0x01D999] = function (x) { K.kill(x); };
  // L_01D99D: a projectile — $10 passes on its own course, then straight
  C[0x01D99D] = function (x) {
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x81));
    K.w16(x+0x14, 0xA6A5);
    K.w16(x+0x16, 0);
    K.w16(x+0x22, 2);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(x+0x32, 0x10);
    K.setState(x, 0xD9D8);
  };
  /** the projectile's pass: false when it ended (`$DAD3`) */
  var projectile = function (x, diagonal) {
    if (K.r16(x+6) & 0x80) { dieNext(x, 0xDADA); return false; }
    K.moveXSigned(x);
    if (diagonal) { K.moveYSigned(x); }
    K.objectScreen(x);
    if (((K.r16(x+0x1A)+0x10) & 0xFFFF) >= 0x120) { dieNext(x, 0xDADA); return false; }
    if (diagonal && ((K.r16(x+0x1C)+0x10) & 0xFFFF) >= 0xF0) { dieNext(x, 0xDADA); return false; }
    K.addSprite(x, frameMeta(x, K.r16(x+0x14)), 1, false);
    phase(x, 0x80, 0x200, 0);
    if (probe(x, 0, 0)) { dieNext(x, 0xDADA); return false; }
    K.shotBox(x, 0x100, 0xA6E9);
    return true;
  };
  C[0x01D9D8] = function (x) {
    if (!projectile(x, true)) { return; }
    var n = (K.r16(x+0x32)-1) & 0xFFFF;
    K.w16(x+0x32, n);
    if (n != 0) { return; }
    K.w16(x+0xD, (K.r16(x+0xD) & 0x8000) ? 0xFC00 : 0x0400);
    K.setState(x, 0xDA71);
  };
  C[0x01DA71] = function (x) { projectile(x, false); };
  C[0x01DADA] = function (x) { K.kill(x); };

  // ======================================================= kind 4: the shell and its burst ($DADE-$DD78)

  /** `$DADE` / `$DAF8` (forward) and `$DB86` / `$DBA0` (backward): the shell flies `reach` from its start, then bursts by `table` */
  var shellInit = function (x, hp, reach, table, next) {
    K.w16(x+0x22, hp);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(x+0x32, (reach+K.r16(x+0xB)) & 0xFFFF);
    K.w16(x+0x36, table);
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x81));
    K.w16(x+0xD, 0x400);
    K.sound(0x10);
    K.setState(x, next);
  };
  C[0x01DADE] = function (x) { shellInit(x, 3, 0x30, 0xA6F9, 0xDB42); };
  C[0x01DAF8] = function (x) { shellInit(x, 5, 0x50, 0xA72B, 0xDB42); };
  C[0x01DB86] = function (x) { shellInit(x, 3, 0xFFD0, 0xA6F9, 0xDBEA); };
  C[0x01DBA0] = function (x) { shellInit(x, 5, 0xFFB0, 0xA72B, 0xDBEA); };
  /** the shell's flight: hit, the reach or the terrain bursts it; its box every fourth pass */
  var shell = function (x, forward) {
    if (!(K.r16(x+6) & 0x80)) {
      if (forward) { K.moveX(x); } else { K.moveXBack(x); }
      K.objectScreen(x);
      K.addSprite(x, forward ? 0xA6EF : 0xA6F4, 1, false);
      var reached = forward ? K.r16(x+0xB) >= K.r16(x+0x32) : K.r16(x+0xB) < K.r16(x+0x32);
      if (!reached && !probe(x, 0, 0)) {
        if ((K.r16(0x50) & 3) == 0) {
          K.shotBox(x, 0x100, 0xA775);
        }
        return;
      }
    }
    burst(x);
  };
  C[0x01DB42] = function (x) { shell(x, true); };
  C[0x01DBEA] = function (x) { shell(x, false); };
  /** `$DC28`: the sparks of the next pattern of the table (`$1685` cycles 0, 2, 4, 6), at the shell's position plus the pattern's offsets */
  var burst = function (x) {
    var g = (K.r16(0x1685)+2) & 6;
    K.w16(0x1685, g);
    var t = K.d16((g+K.r16(x+0x36)) & 0xFFFF);
    K.w16(0, K.d16(t));
    K.w16(2, t+2);
    do {
      var y = K.spawn(x, 0x01DCA7, 8);
      if (y < 0) { break; }
      var p = K.r16(2);
      K.w16(4, K.d16(p));
      var dy = K.d16(p+2);
      K.w16(2, p+4);
      K.w16(y+0x10, (dy+K.r16(x+0x10)) & 0xFFFF);
      K.w16(y+0xB, (K.r16(4)+K.r16(x+0xB)) & 0xFFFF);
      K.w16(0, K.r16(0)-1);
    } while (K.r16(0) != 0);
    K.setState(x, 0xDC83);
  };
  C[0x01DC83] = function (x) {
    if (!K.childrenDone(x)) { return; }
    K.w16(0x1683, (K.r16(0x1683)-1) & 0xFFFF);
    K.setState(x, 0xDCA3);
  };
  C[0x01DCA3] = function (x) { K.kill(x); };
  // L_01DCA7: a spark — drawn on odd passes at the back of group 2, $10 passes growing, then fading out
  C[0x01DCA7] = function (x) {
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x82));
    K.w16(x+0x14, 0xF9DD);
    K.w16(x+0x16, 0);
    K.w16(x+0x22, 1);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(x+0x34, 0x10);
    K.setState(x, 0xDCE2);
  };
  var sparkDraw = function (x) {
    K.objectScreen(x);
    if (K.r16(0x50) & 1) {
      K.addSprite(x, frameMeta(x, K.r16(x+0x14)), 2, true);
    }
  };
  C[0x01DCE2] = function (x) {
    sparkDraw(x);
    phase(x, 0x80, 0x300, 0x200);
    K.shotBox(x, 0x108, 0xA77B);
    var n = (K.r16(x+0x34)-1) & 0xFFFF;
    K.w16(x+0x34, n);
    if (n == 0) { K.setState(x, 0xDD31); }
  };
  C[0x01DD31] = function (x) {
    sparkDraw(x);
    var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
    if (v >= 0x500) {
      K.setState(x, 0xDD78);
      return;
    }
    K.w16(x+0x16, v);
    K.shotBox(x, 0x108, 0xA77B);
  };
  C[0x01DD78] = function (x) { K.kill(x); };
} // installLaserCode

if (typeof globalThis !== 'undefined') { globalThis.installLaserCode = installLaserCode; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installLaserCode; }
