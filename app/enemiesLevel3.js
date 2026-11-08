// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The level-bound objects of Super R-Type, third part — bank `$03` of levels 6 and 7 (`$C6D9`, `$9D7D`).
 * Carried over state by state onto the kernel of `app/gameKernel.js` with
 * the conventions, the marks and the measure of `app/enemies.js`
 * (`tools/matchenemies.mjs`).
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installLevelEnemyCode3(K) {
  var C = K.code;
  /** `JML task_kill` */
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };


  // ============================================================ the pod carrier of level 6 ($03:C6D9)
  // L_03C6D9: a spawner that lets out a pod ($C743) every 90 passes while it is on the screen — the
  // pod's parameter is the entry of $F52B by the count (+$36) or-ed with the spawner's own.
  C[0x03C6D9] = function (x) {
    K.w16(x+0x32, 1);
    K.w16(x+0x36, 0);
    K.setState(x, 0xC6EB);
  };
  C[0x03C6EB] = function (x) {
    K.objectScreenLayer(x);
    if ((K.r16(x+0x1A)+0x10) & 0x8000) { L_03CBB9(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    var y = K.spawn(0x17FB, 0x03C743, 16);
    if (y < 0) { return; }
    K.w16(y+0x30, K.d16(0xF52B+2*(K.r16(x+0x36) & 7)) | K.r16(x+0x30));
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
    K.w16(x+0x32, 0x5A);
    K.w16(x+0x36, K.r16(x+0x36)+1);
  };
  /** `DEC $32,X; BNE +; … aimed shot …; LDA $34,X; STA $32,X`: the pod's shot timer (reloaded only when the shot was spawned) */
  var podShot = function (x) {
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    if (K.aimedShot(x) < 0) { return; }
    K.w16(x+0x32, K.r16(x+0x34));
  };
  // L_03C743: the pod — drifts left (speed 0.75), shooting; a pod whose parameter's low byte is set
  // draws from the sequence $841F: 1 in 4 keeps the parameter ($FF) and will chase the ship once it is
  // past x $3A0 and left of the ship, the others never do.
  C[0x03C743] = function (x) {
    K.slotsOf(x, 0x26);
    K.body(x, 1);
    K.pal(x, 0x9F);
    K.w16(x+0xD, 0xC0);
    var p = K.diffParams(x);
    K.w16(x+0x32, p[0]);
    K.w16(x+0x34, p[1]);
    if (K.r16(x+0x30) & 0xFF) {
      K.w16(x+0x30, (K.sequenceNext() & 3) ? 0 : 0xFF);
    }
    K.setState(x, 0xC7C2);
  };
  C[0x03C7C2] = function (x) {
    K.listAdd(x);
    K.moveXBack(x);
    K.objectScreenLayer(x);
    var v = K.r16(x+0x1A)+0x10;
    if (v & 0x8000) { L_03CBB9(x); return; }
    // ★ `LDA $1A,X; ADC #$10` without CLC: the carry of the test before
    if (((K.r16(x+0x1A)+0x10+(v >> 16)) & 0xFFFF) >= 0x120) { return; }
    K.touchesShip(x, 0xF525, true);
    K.addSprite(x, 0xF4D3, 2, true);
    if (K.hit(x, 0xF525)) { L_03CBA7(x); return; }
    podShot(x);
    // L_03C85B: the chase begins
    if (K.r16(x+0x30) == 0 || K.r16(x+0xB) >= 0x3A0 || K.r16(x+0x1A) >= shipX()) { return; }
    // L_03C871
    K.w16(x+0x14, 0xF515);
    K.w16(x+0x16, 0);
    K.w16(x+0xD, 0x80);
    K.w16(x+0x12, 0x80);
    K.w16(x+6, K.r16(x+6) | 0x4000);
    K.w16(x+0x38, 0x1E0);
    K.w16(x+0x3A, 0xB4);
    L_03C89B(x);
  };
  var L_03C89B = function (x) { K.setState(x, 0xC8A4); };
  // L_03C8A4: the chase — towards the ship at half speed on both axes (within 8 px of it on an axis
  // it holds), facing by the direction (+6 bit 14 and the frame table), stopped by the terrain ahead
  // ($C9F2 for 60 passes); after 480 passes it leaves to the left ($CA6F), after 180 it dives ($CB07).
  C[0x03C8A4] = function (x) {
    K.listAdd(x);
    var a = (K.r16(x+0x1A)-8) & 0xFFFF;
    if (a >= shipX()) {
      K.moveXBack(x);
      K.w16(x+6, K.r16(x+6) | 0x4000);
      K.w16(x+0x14, 0xF515);
    } else if (((a+0x10) & 0xFFFF) < shipX()) {
      K.moveX(x);
      K.w16(x+6, K.r16(x+6) & 0xBFFF);
      K.w16(x+0x14, 0xF51D);
    }
    a = (K.r16(x+0x1C)-8) & 0xFFFF;
    if (a >= shipY()) {
      K.moveYBack(x);
    } else if (((a+0x10) & 0xFFFF) < shipY()) {
      K.moveY(x);
    }
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF525, true);
    if (K.offRight(x, 0x20, 0x140)) { L_03CBB9(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x10, 0x400);
    if (K.hit(x, 0xF525)) { L_03CBA7(x); return; }   // ? $03:C95A `JMP $CBA7`
    var dx = (K.r16(x+6) & 0x4000) ? -0xD : 0xC;
    if (probe(x, dx, -0xC) || probe(x, dx, 0) || probe(x, dx, 0xD)) { L_03C9F2(x); return; }
    podShot(x);
    K.w16(x+0x38, K.r16(x+0x38)-1);
    if (K.r16(x+0x38) == 0) { L_03CA6F(x); return; }
    K.w16(x+0x3A, K.r16(x+0x3A)-1);
    if (K.r16(x+0x3A) == 0) { L_03CB07(x); }
  };
  var L_03C9F2 = function (x) { K.w16(x+0x36, 0x3C); K.setState(x, 0xCA01); };
  C[0x03CA01] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF525, true);
    if (K.offRight(x, 0x20, 0x140)) { L_03CBB9(x); return; }   // ? $03:CA24 `JMP $CBB9`
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x10, 0x400);
    if (K.hit(x, 0xF525)) { L_03CBA7(x); return; }   // ? $03:CA5E `JMP $CBA7`
    K.w16(x+0x36, K.r16(x+0x36)-1);
    if (K.r16(x+0x36) == 0) { L_03C89B(x); return; }
    K.w16(x+0x38, K.r16(x+0x38)-1);
    if (K.r16(x+0x38) == 0) { L_03CA6F(x); }
  };
  var L_03CA6F = function (x) { K.w16(x+0x14, 0xF515); K.w16(x+0x16, 0); K.setState(x, 0xCA81); };
  C[0x03CA81] = function (x) {
    K.listAdd(x);
    K.moveXBack(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF525, true);
    if (K.offRight(x, 0x10, 0x120)) { L_03CBB9(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x10, 0x400);
    if (K.hit(x, 0xF525)) { L_03CBA7(x); return; }   // ? $03:CAE2 `JMP $CBA7`
    // ? $03:CAF7-$03:CB05: a wall on the left stops it
    if (probe(x, -0xD, -7) && probe(x, -0xD, 8)) { K.w16(x+0xD, 0); }
  };
  var L_03CB07 = function (x) { K.w16(x+0x36, 0x3C); K.setState(x, 0xCB16); };
  C[0x03CB16] = function (x) {
    K.listAdd(x);
    K.moveY(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF525, true);
    if (K.offRight(x, 0x10, 0x120)) { L_03CBB9(x); return; }   // ? $03:CB3D `JMP $CBB9`
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x60, 0x400);
    if (K.hit(x, 0xF525)) { L_03CBA7(x); return; }
    if (probe(x, -8, 0xA) || probe(x, 7, 0xA)) { L_03CBA7(x); return; }
    K.w16(x+0x36, K.r16(x+0x36)-1);
    if (K.r16(x+0x36) != 0) { return; }
    K.w16(x+0x3A, 0x78);
    L_03C89B(x);
  };
  var L_03CBA7 = function (x) {
    K.explode(x, EXPLODE, true);
    K.scoreAdd(2);
    K.sound(0x12);
    L_03CBB9(x);
  };
  var L_03CBB9 = function (x) { K.endAt(x, 0xCBC9); };
  C[0x03CBC9] = kill;


  // ============================================================ the snake of level 7 ($03:9D7D)
  // L_039D7D: the head of a snake — 11 HP (6 on hard), sprite set $27; it spawns its segments as its
  // children: the first ($A141) with a start delay of $40 ($50 when the parameter's high byte is set),
  // then 7 (9) more ($9F38) with the delays of $D23D. All follow the script picked by the parameter
  // ($D20B) from the same place, so the delays string them out along the path.
  C[0x039D7D] = function (x) {
    K.body(x, (K.r16(0x84) & 1) ? 6 : 0xB);   // ? $03:9D98 (hard) read statically
    K.slotsOf(x, 0x27);
    var n;
    var y = K.spawn(x, 0x03A141, 16);
    if (y >= 0) {
      K.w16(y+0x30, K.r16(x+0x30) & 0xFF);
      K.w16(y+0x1E, K.r16(x+0x1E));
      K.w16(y+0xB, K.r16(x+0xB));
      K.w16(y+0x10, K.r16(x+0x10));
      if (K.r16(x+0x30) & 0xFF00) {   // ? $03:9DF1 read statically
        K.w16(y+0x34, 0x50);
        n = 9;
      } else {
        K.w16(y+0x34, 0x40);
        n = 7;
      }
    } else {
      // ? the pool was short: `STA $00` keeps what `task_spawn_16` left in A — the free count `$22`
      n = K.r16(0x22);
    }
    // L_039DFC: the segments, from the last delay of $D23D down
    while (true) {
      y = K.spawn(x, 0x039F38, 16);
      if (y < 0) { break; }
      K.w16(y+0x30, K.r16(x+0x30) & 0xFF);
      K.w16(y+0x1E, K.r16(x+0x1E));
      K.w16(y+0xB, K.r16(x+0xB));
      K.w16(y+0x10, K.r16(x+0x10));
      K.w16(y+0x34, K.d16(0xD23D+2*((n-1) & 0xFFFF)));
      n = (n-1) & 0xFFFF;
      if (n == 0) { break; }
    }
    // L_039E38
    K.scriptStart(x, 0x200, K.d16(0xD20B+2*(K.r16(x+0x30) & 0xFF)));
    K.w16(x+0x36, 0);
    K.w16(x+0x3C, 0);
    K.pal(x, 0xBB);
    K.pal2(x, 0x80);
    K.setState(x, 0x9E76);
  };
  /** `LDA $2D,X; AND #$F; ASL; CLC; ADC #tbl; TAY; LDA $0,Y`: the frame the script's prefix names in `tbl` */
  var snakeFrame = function (x, tbl) { return K.d16(tbl+2*(K.r16(x+0x2D) & 0xF)); };
  /** `JSL script_step; JSL object_screen; INC $3C,X; off the screen → gone`: the scripted pass of the snake; false when gone */
  var snakeStep = function (x, gone, count) {
    K.scriptStep(x);
    K.objectScreen(x);
    if (count) { K.w16(x+0x3C, K.r16(x+0x3C)+1); }
    if (K.offRight(x, 0x20, 0x140) || K.offBottom(x, 0x20, 0x110)) { gone(x); return false; }
    return true;
  };
  // L_039E76: the head follows its script, counting its passes in +$3C; killed: a small explosion, 5 points,
  // +$36 = $FF tells the segments.
  C[0x039E76] = function (x) {
    K.listAdd(x);
    if (!snakeStep(x, L_039F0E, true)) { return; }   // ? $03:9E99 `JMP $9F0E`
    K.touchesShip(x, 0xD1FF, true);
    K.addSprite(x, snakeFrame(x, 0xD19F), 2, true);
    if (!K.hitBlink(x, 0x700, 0xD1FF)) { return; }
    // ? $03:9EED-$03:9F0D read statically (the head killed)
    K.explode(x, EXPLODE_SMALL, false);
    K.sound(0x32);
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.scoreAdd(5);
    K.w16(x+0x36, 0xFF);
    L_039F0E(x);
  };
  var L_039F0E = function (x) { K.setState(x, 0x9F17); };
  // L_039F17: waits for its segments (the children) to go, then dies (`$F3` holds the depth compared)
  C[0x039F17] = function (x) {
    K.w8(0xF3, K.r8(x+2));
    if (!K.childrenDone(x)) { return; }
    K.setState(x, 0x9F34);
  };
  C[0x039F34] = kill;
  /** L_039F38 / L_03A141: a segment — 1000 HP (the shots bounce off while the head lives), the head's script, waits +$34 passes */
  var segmentInit = function (x, state) {
    K.slotsOf(x, 0x27);
    K.body(x, 0x3E8);
    K.w16(x+0x3C, 0);
    K.scriptStart(x, 0x200, K.d16(0xD20B+2*(K.r16(x+0x30) & 0xFF)));
    K.pal(x, 0xBB);
    K.pal2(x, 0x80);
    K.setState(x, state);
  };
  C[0x039F38] = function (x) { segmentInit(x, 0x9F8F); };
  C[0x03A141] = function (x) { segmentInit(x, 0xA198); };
  /** L_039F8F / L_03A198: the start delay */
  var segmentWait = function (next) {
    return function (x) {
      K.w16(x+0x34, K.r16(x+0x34)-1);
      if (K.r16(x+0x34) == 0) { K.setState(x, next); }
    };
  };
  C[0x039F8F] = segmentWait(0x9F9E);
  C[0x03A198] = segmentWait(0xA1A7);
  /**
   * L_039F9E / L_03A1A7: the segment behind the living head — the script, the frame of `tbl`, the
   * shots bounce (`$0704`: the shot's side only), and when the head is gone (+$36 of the parent) the
   * segment becomes a body of 6 HP (1 on hard) in state `loose`.
   */
  var segmentFollow = function (tbl, loose) {
    return function (x) {
      if (!snakeStep(x, L_03A365, true)) { return; }   // ? $03:9FB5 / $03:A1BE `JMP $A365`
      K.touchesShip(x, 0xD205, true);
      K.addSprite(x, snakeFrame(x, tbl), 2, false);
      K.hitTest(x, 0x704, 0xD205);
      if (K.r16(K.r16(x+8)+0x36) == 0) { return; }
      // ? $03:9FF4 / $03:A1FD read statically
      K.body(x, (K.r16(0x84) & 1) ? 1 : 6);
      K.setState(x, loose);
    };
  };
  C[0x039F9E] = segmentFollow(0xD1BF, 0xA02A);
  C[0x03A1A7] = segmentFollow(0xD1DF, 0xA233);
  /**
   * ? L_03A02A / L_03A233 (read statically, $03:A02A-$03:A140 and $03:A233-$03:A364): a loose segment —
   * follows its script and can be hit; when its pass count catches the parent's (+$3C) it takes the
   * second script of the parent's prefix ($D21D) and goes on in `next` until that script's speed is 0.
   */
  var segmentLoose = function (tbl, next) {
    return function (x) {
      K.listAdd(x);
      if (!snakeStep(x, L_03A365, true)) { return; }
      K.touchesShip(x, 0xD205, true);
      K.addSprite(x, snakeFrame(x, tbl), 2, false);
      if (K.hitBlink(x, 0x700, 0xD205)) { L_03A34A(x); return; }
      var p = K.r16(x+8);
      if (K.r16(p+0x3C) != K.r16(x+0x3C)) { return; }
      // ★ `LDA $2D,Y` reads the parent's prefix byte and the low byte of its script speed +$2E as one word
      K.scriptStart(x, 0x200, K.d16(0xD21D+2*K.r16(p+0x2D)));
      K.setState(x, next);
    };
  };
  C[0x03A02A] = segmentLoose(0xD1BF, 0xA0C5);
  C[0x03A233] = segmentLoose(0xD1DF, 0xA2CE);
  /** ? L_03A0C5 / L_03A2CE: the loose segment on the second script — gone when the script's speed +$2E is 0 */
  var segmentLeave = function (tbl) {
    return function (x) {
      K.listAdd(x);
      if (!snakeStep(x, L_03A365, false)) { return; }
      if (K.r16(x+0x2E) == 0) { L_03A365(x); return; }
      K.touchesShip(x, 0xD205, true);
      K.addSprite(x, snakeFrame(x, tbl), 2, false);
      if (K.hitBlink(x, 0x700, 0xD205)) { L_03A34A(x); }
    };
  };
  C[0x03A0C5] = segmentLeave(0xD1BF);
  C[0x03A2CE] = segmentLeave(0xD1DF);
  // ? L_03A34A: a segment killed — 3 points, a small explosion
  var L_03A34A = function (x) {
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.scoreAdd(3);
    K.explode(x, EXPLODE_AT, false);
    K.sound(0x16);
    L_03A365(x);
  };
  var L_03A365 = function (x) { K.setState(x, 0xA36C); };
  C[0x03A36C] = kill;

  if (typeof installLevelEnemyCode4 === 'function') {
    installLevelEnemyCode4(K);
  }
}

if (typeof globalThis !== 'undefined') { globalThis.installLevelEnemyCode3 = installLevelEnemyCode3; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installLevelEnemyCode3; }
