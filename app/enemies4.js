// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The enemies of Super R-Type, fourth part — the linked walkers of level 5 (bank `$02`, `$B81B` family) and the objects of level 7 (`$DFC1` family).
 * Carried over state by state onto the kernel of `app/gameKernel.js` with
 * the conventions, the marks and the measure of `app/enemies.js`
 * (`tools/matchenemies.mjs`).
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installEnemyCode4(K) {
  var C = K.code;
  /** `JML task_kill` */
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };


  /** `TYA; STA $1E,X; JSL S_009EC5`: the object binds to the layer the last terrain probe reported (Y) */
  var bind = function (x) { var l = K.hitLayer; K.w16(x+0x1E, l); K.objectFromLayer(x, l); };
  /** `DEC $3A,X; BNE +; JSR S_02CA28`: the shot timer of a walker */
  var shotTick = function (x) { K.w16(x+0x3A, K.r16(x+0x3A)-1); if (K.r16(x+0x3A) == 0) { S_02CA28(x); } };
  /** `LDY $08,X; CPY #$17FB; BEQ +; LDA $32,Y; BEQ +`: a segment whose parent segment has taken off (+$32) */
  var parentFlying = function (x) { var p = K.r16(x+8); return p != 0x17FB && K.r16(p+0x32) != 0; };
  /**
   * What `terrain_probe` leaves in A on a miss: 0 when the last layer tested had a collision map, else
   * the level flags `$1821` (★ `$02:C252` stores it into +$38 — a slip of the original, see L_02C1A8).
   */
  var probeMissA = function () { var f = K.r16(0x1821); return (f & 2) ? 0 : f; };

  // ============================================================ the linked walkers of level 5 ($02:B81B)
  // L_02B81B: the head of a chain of walkers crawling along the terrain — +$30 bit 2 picks the length
  // ($DFAB), bits 0-1 the kind: 0 and 3 walk with the wall on one side (left / right first), 1 and 2
  // the mirrored way. Every 22 passes the head spawns the next segment as its child with the same
  // place and the count less one (state L_02B835 for the segments, which never spawn — their count is
  // 0 or less than the head's). Then the body: 2 HP (1 on hard), sprite set 7, the shot timers of the
  // difficulty tables in +$3A / +$3C, the frame table by the kind ($DF3F), speeds 1.0.
  C[0x02B81B] = function (x) {
    K.w16(x+0x34, K.d16(0xDFAB+((K.r16(x+0x30) & 4) >> 1)));
    K.w16(x+0x36, 1);
    K.w16(x+0x31, 3);
    L_02B835(x);
  };
  var L_02B835 = function (x) {
    K.w16(x+0x32, 0);
    K.w16(x+0x36, K.r16(x+0x36)-1);
    if (K.r16(x+0x36) != 0) { return; }
    // L_02B83E: the next segment of the chain (a child of this one)
    var n = K.r16(x+0x34);
    if (n != 0) {
      var y = K.spawn(x, 0x02B835, 16);
      if (y >= 0) {
        K.w16(y+0x30, K.r16(x+0x30));
        K.w16(y+0x1E, K.r16(x+0x1E));
        K.w16(y+0xB, K.r16(x+0xB));
        K.w16(y+0x10, K.r16(x+0x10));
        n--;
        K.w16(y+0x34, n);
        K.w16(y+0x31, (n & 1) ? 3 : 0);
        K.w16(y+0x36, 0x16);
      }
    }
    // L_02B88A: the body
    K.body(x, (K.r16(0x84) & 1) ? 1 : 2);   // ? $02:B8A5 (hard) read statically
    K.pal(x, 0x98);
    K.pal2(x, 0x80);
    K.slotsOf(x, 7);
    var p = K.diffParams(x);
    K.w16(x+0x3A, p[0]);
    K.w16(x+0x3C, p[1]);
    var kind = K.r16(x+0x30) & 3;
    K.w16(x+0x14, K.d16(0xDF3F+2*kind));
    K.w16(x+0x16, 0);
    K.w16(x+0xD, 0x100);
    K.w16(x+0x12, 0x100);
    if (kind == 0) { L_02B952(x); }
    else if (kind == 1) { L_02C199(x); }   // ? $02:B92C `JMP $C199`
    else if (kind == 2) { L_02C368(x); }   // ? $02:B934 `JMP $C368`
    else { L_02BB25(x); }
  };
  C[0x02B835] = L_02B835;

  /**
   * The pass every walker state begins with: into the missiles' list, the move, the screen position,
   * off the screen (`$1A + dx >= limit`, the vertical states also `$1C + $10 >= $F0`) → L_02C9F5,
   * the touch of the ship ($DF55), the frame of the animation, the phase (+$30 round $400), the hit
   * ($DF4F) with the blink → L_02C9DD. False when the object is gone.
   */
  var walkerPass = function (x, move, dx, limit, vertical) {
    K.listAdd(x);
    move(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, dx, limit)) { L_02C9F5(x); return false; }
    if (vertical && K.offBottom(x, 0x10, 0xF0)) { L_02C9F5(x); return false; }
    K.touchesShip(x, 0xDF55, true);
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x30, 0x400);
    if (K.hitBlink(x, 0x700, 0xDF4F)) { L_02C9DD(x); return false; }
    return true;
  };
  /**
   * A walking state: the pass, then three terrain probes — the first (the wall ahead) turns the corner
   * inward (`turn`), the second and third (the ground under the two corners) keep it walking (`landed`),
   * none → it walks round the edge (`edge`).
   */
  var walker = function (move, dx, limit, vertical, p1, turn, p2, p3, landed, edge) {
    return function (x) {
      if (!walkerPass(x, move, dx, limit, vertical)) { return; }
      if (probe(x, p1[0], p1[1])) { turn(x); return; }
      if (probe(x, p2[0], p2[1]) || probe(x, p3[0], p3[1])) { landed(x); return; }
      edge(x);
    };
  };
  var moveX = function (x) { K.moveX(x); }, moveXBack = function (x) { K.moveXBack(x); };
  var moveY = function (x) { K.moveY(x); }, moveYBack = function (x) { K.moveYBack(x); };
  var moveFree = function (x) { K.moveXSigned(x); K.moveYSigned(x); };
  /** `LDA $30,X; AND #3; ASL; PHY; TAY; LDA $DF47,Y; PLY; STA $14,X`: the frame table of a flying walker */
  var flyFrame = function (x) { K.w16(x+0x14, K.d16(0xDF47+2*(K.r16(x+0x30) & 3))); };
  /**
   * L_02BCF0 / L_02C535: a segment takes off after its parent — +$32 = $FF marks it for its own children,
   * the speeds come from the row of `tbl` by the side it walked on (+$38) and the sum of its coordinates.
   */
  var takeOff = function (x, tbl, state) {
    K.w16(x+0x32, 0xFF);
    var row = K.d16(tbl+K.r16(x+0x38));
    // ★ `LDA $0B,X; ADC $10,X` without CLC: the carry is the one `CPY #$17FB` left — clear, a node lies below $17FB
    var i = ((K.r16(x+0xB)+K.r16(x+0x10)) & 3) << 2;
    K.w16(x+0xD, K.d16(row+i));
    K.w16(x+0x12, K.d16(row+i+2));
    K.setState(x, state);
  };

  // --- kind 0 / 3: the wall on the left hand (the ground under the walker is below when it walks right)
  var L_02B952 = function (x) { K.w16(x+0x38, 4); K.setState(x, 0xB961); };   // walks left
  var L_02BA34 = function (x) { K.w16(x+0x38, 6); K.setState(x, 0xBA43); };   // walks up
  var L_02BB25 = function (x) { K.w16(x+0x38, 0); K.setState(x, 0xBB31); };   // walks right
  var L_02BC04 = function (x) { K.w16(x+0x38, 2); K.setState(x, 0xBC13); };   // walks down
  var L_02B94A = function (x) { bind(x); L_02B952(x); };
  var L_02BA2C = function (x) { bind(x); L_02BA34(x); };
  var L_02BB1D = function (x) { bind(x); L_02BB25(x); };
  var L_02BBFC = function (x) { bind(x); L_02BC04(x); };
  /** L_02BA0B (and $BAFC, $BBDB, $BCCF): on the ground — a segment follows a parent that took off, else the shot timer */
  var L_02BA0B = function (x) { bind(x); if (parentFlying(x)) { L_02BCF0(x); } else { shotTick(x); } };
  C[0x02B961] = walker(moveXBack, 0x40, 0x180, false, [-9, 8], L_02BA2C, [-8, 9], [7, 9], L_02BA0B, L_02BC04);
  C[0x02BA43] = walker(moveYBack, 0x40, 0x180, true, [-8, -8], L_02BB1D, [-9, -7], [-9, 8], L_02BA0B, L_02B952);
  C[0x02BB31] = walker(moveX, 0x40, 0x180, false, [8, -7], L_02BBFC, [-8, -8], [7, -8], L_02BA0B, L_02BA34);
  C[0x02BC13] = walker(moveY, 0x40, 0x180, true, [7, 9], L_02B94A, [8, -7], [8, 8], L_02BA0B, L_02BB25);
  // L_02BCF0: free flight ($DF5B rows), until the terrain is hit on one of the four sides
  var L_02BCF0 = function (x) { takeOff(x, 0xDF5B, 0xBD1F); };
  C[0x02BD1F] = function (x) {
    if (!walkerPass(x, moveFree, 0x10, 0x120, true)) { return; }
    if (probe(x, 0, -8)) { L_02BFBB(x); return; }
    if (probe(x, 0, 9)) { L_02BDE8(x); return; }
    if (probe(x, -9, 0)) { L_02BECA(x); return; }   // ? $02:BDD6 `JMP $BECA`
    if (probe(x, 8, 0)) { L_02C09D(x); return; }    // ? $02:BDE4 `JMP $C09D`
  };
  // the landing: the frame of the flying kind, the layer hit, the speed of the side, the walk goes on
  var L_02BE00 = function (x) { K.w16(x+0xD, 0x100); K.setState(x, 0xBE0F); };
  var L_02BDF8 = function (x) { bind(x); L_02BE00(x); };
  var L_02BDE8 = function (x) { flyFrame(x); L_02BDF8(x); };
  var L_02BEE2 = function (x) { K.w16(x+0x12, 0x100); K.setState(x, 0xBEF1); };
  var L_02BEDA = function (x) { bind(x); L_02BEE2(x); };
  var L_02BECA = function (x) { flyFrame(x); L_02BEDA(x); };   // ? read statically
  var L_02BFD3 = function (x) { K.w16(x+0xD, 0x100); K.setState(x, 0xBFE2); };
  var L_02BFCB = function (x) { bind(x); L_02BFD3(x); };
  var L_02BFBB = function (x) { flyFrame(x); L_02BFCB(x); };
  var L_02C0B5 = function (x) { K.w16(x+0x12, 0x100); K.setState(x, 0xC0C4); };
  var L_02C0AD = function (x) { bind(x); L_02C0B5(x); };
  var L_02C09D = function (x) { flyFrame(x); L_02C0AD(x); };   // ? read statically
  /** L_02BEB9 (and $BFAA, $C08C, $C180): a landed walker on the ground — no parent to follow any more */
  var L_02BEB9 = function (x) { bind(x); shotTick(x); };
  C[0x02BE0F] = walker(moveXBack, 0x20, 0x140, false, [-9, 8], L_02BEDA, [-8, 9], [7, 9], L_02BEB9, L_02C0B5);
  // ? $02:BEF1-$02:BFBA read statically (the landed walker walking up)
  C[0x02BEF1] = walker(moveYBack, 0x20, 0x140, true, [-8, -8], L_02BFCB, [-9, -7], [-9, 8], L_02BEB9, L_02BE00);
  C[0x02BFE2] = walker(moveX, 0x20, 0x140, false, [8, -7], L_02C0AD, [-8, -8], [7, -8], L_02BEB9, L_02BEE2);
  C[0x02C0C4] = walker(moveY, 0x20, 0x140, true, [7, 9], L_02BDF8, [8, -7], [8, 8], L_02BEB9, L_02BFD3);

  // --- kind 1 / 2: the mirrored family, ? $02:C191-$02:C9DC read statically (no coverage run spawned it)
  var L_02C199 = function (x) { K.w16(x+0x38, 4); K.setState(x, 0xC1A8); };   // walks left
  var L_02C278 = function (x, a) { K.w16(x+0x38, a); K.setState(x, 0xC284); };   // walks up (`STA $38,X` with A)
  var L_02C368 = function (x) { K.w16(x+0x38, 0); K.setState(x, 0xC374); };   // walks right
  var L_02C449 = function (x) { K.w16(x+0x38, 2); K.setState(x, 0xC458); };   // walks down
  var L_02C191 = function (x) { bind(x); L_02C199(x); };
  var L_02C26D = function (x) { bind(x); L_02C278(x, 6); };
  var L_02C360 = function (x) { bind(x); L_02C368(x); };
  var L_02C441 = function (x) { bind(x); L_02C449(x); };
  var L_02C33F = function (x) { bind(x); if (parentFlying(x)) { L_02C535(x); } else { shotTick(x); } };
  /** L_02C254: the same without the bind (the left-walking state alone skips it) */
  var L_02C254 = function (x) { if (parentFlying(x)) { L_02C535(x); } else { shotTick(x); } };
  // ★ L_02C1A8 walking off the edge: `$02:C252 BRA $C278` lands behind the `LDA #6` — +$38 takes what
  // `terrain_probe` left in A (0 with a collision layer), not 6; the flight after that uses row 0 of $DF63
  var L_02C252 = function (x) { L_02C278(x, probeMissA()); };
  C[0x02C1A8] = walker(moveXBack, 0x40, 0x180, false, [-9, -7], L_02C441, [-8, -8], [7, -8], L_02C254, L_02C252);
  C[0x02C284] = walker(moveYBack, 0x40, 0x180, true, [7, -8], L_02C191, [8, -7], [8, 8], L_02C33F, L_02C368);
  C[0x02C374] = walker(moveX, 0x40, 0x180, false, [8, 8], L_02C26D, [-8, 9], [7, 9], L_02C33F, L_02C449);
  C[0x02C458] = walker(moveY, 0x40, 0x180, true, [-8, 9], L_02C360, [-9, -7], [-9, 8], L_02C33F, L_02C199);
  var L_02C535 = function (x) { takeOff(x, 0xDF63, 0xC564); };
  C[0x02C564] = function (x) {
    if (!walkerPass(x, moveFree, 0x10, 0x120, true)) { return; }
    if (probe(x, 0, -8)) { L_02C62D(x); return; }
    if (probe(x, 0, 9)) { L_02C804(x); return; }
    if (probe(x, -9, 0)) { L_02C8E9(x); return; }
    if (probe(x, 8, 0)) { L_02C711(x); return; }
  };
  var L_02C645 = function (x) { K.w16(x+0xD, 0x100); K.setState(x, 0xC654); };
  var L_02C63D = function (x) { bind(x); L_02C645(x); };
  var L_02C62D = function (x) { flyFrame(x); L_02C63D(x); };
  var L_02C729 = function (x) { K.w16(x+0x12, 0x100); K.setState(x, 0xC738); };
  var L_02C721 = function (x) { bind(x); L_02C729(x); };
  var L_02C711 = function (x) { flyFrame(x); L_02C721(x); };
  var L_02C81C = function (x) { K.w16(x+0xD, 0x100); K.setState(x, 0xC82B); };
  var L_02C814 = function (x) { bind(x); L_02C81C(x); };
  var L_02C804 = function (x) { flyFrame(x); L_02C814(x); };
  var L_02C901 = function (x) { K.w16(x+0x12, 0x100); K.setState(x, 0xC910); };
  var L_02C8F9 = function (x) { bind(x); L_02C901(x); };
  var L_02C8E9 = function (x) { flyFrame(x); L_02C8F9(x); };
  C[0x02C654] = walker(moveXBack, 0x20, 0x140, false, [-9, -7], L_02C8F9, [-8, -8], [7, -8], L_02BEB9, L_02C729);
  C[0x02C738] = walker(moveYBack, 0x20, 0x140, true, [7, -8], L_02C63D, [8, -7], [8, 8], L_02BEB9, L_02C81C);
  C[0x02C82B] = walker(moveX, 0x20, 0x140, false, [8, 8], L_02C721, [-8, 9], [7, 9], L_02BEB9, L_02C901);
  C[0x02C910] = walker(moveY, 0x20, 0x140, true, [-8, 9], L_02C814, [-9, -7], [-9, 8], L_02BEB9, L_02C645);

  // L_02C9DD: killed — a point, the explosion, the sound, +$32 = $FF so the segments behind take off
  var L_02C9DD = function (x) {
    K.scoreAdd(1);
    K.explode(x, EXPLODE, true);
    K.sound(0x12);
    K.w16(x+0x32, 0xFF);
    L_02C9F5(x);
  };
  var L_02C9F5 = function (x) { K.setState(x, 0xC9FE); };
  // L_02C9FE: waits for its segments (the children) to go, then dies (`$F3` holds the depth compared)
  C[0x02C9FE] = function (x) {
    K.w8(0xF3, K.r8(x+2));
    if (!K.childrenDone(x)) { return; }
    K.endAt(x, 0xCA24);
  };
  C[0x02CA24] = kill;
  /** S_02CA28: an aimed shot ($03:D2BF) and the shot timer reloaded from +$3C — only when the shot was spawned */
  var S_02CA28 = function (x) {
    if (K.aimedShot(x) < 0) { return; }
    K.w16(x+0x3A, K.r16(x+0x3C));
  };


  // ============================================================ the aiming turret of level 7 ($02:DFC1)
  /** `LDA $84; BIT #$18 / #6`: the timer of the turret by the difficulty — the row of $E927 / $E937 / $E947 by +$30 */
  var turretTimer = function (x) {
    var d = K.r16(0x84);
    var tbl = (d & 0x18) ? 0xE947 : (d & 6) ? 0xE937 : 0xE927;   // ? $02:DFCD (easy) read statically
    return K.d16(tbl+2*K.r16(x+0x30));
  };
  /** `$02:E024`-`$02:E04D`: the shot aimed at the ship (direction in +$30), from the turret's screen place; the timer reloaded */
  var turretShot = function (x, y) {
    K.w16(y+0x30, K.directionTo(x, SHIP));
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0x1A)+0x200);
    K.w16(y+0x10, K.r16(x+0x1C)+0x200);
    K.w16(x+0x32, K.r16(x+0x34));
  };
  // L_02DFC1: an invisible emplacement in the wall that fires a shot ($E0D8) at the ship every +$34 passes
  // while it is on the screen.
  C[0x02DFC1] = function (x) {
    var t = turretTimer(x);
    K.w16(x+0x34, t);
    K.w16(x+0x32, t);
    K.setState(x, 0xDFF8);
  };
  C[0x02DFF8] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x11, 0x122)) { L_02E051(x); return; }   // ? $02:E008 `JMP $E051`
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    var y = K.spawn(0x17FB, 0x02E0D8, 16);
    if (y < 0) { return; }
    turretShot(x, y);
  };
  // ? $02:E051: gone off the screen
  var L_02E051 = function (x) { K.setState(x, 0xE058); };
  C[0x02E058] = kill;
  // L_02E05C: the same turret as a part of another object — the shots are its own children (? who spawns it)
  C[0x02E05C] = function (x) {
    var t = turretTimer(x);   // ? $02:E068 (easy) read statically
    K.w16(x+0x34, t);
    K.w16(x+0x32, t);
    K.objectScreenLayer(x);
    K.setState(x, 0xE097);
  };
  C[0x02E097] = function (x) {
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    var y = K.spawn(x, 0x02E0D8, 16);
    if (y < 0) { return; }
    turretShot(x, y);
  };
  // L_02E0D8: the turret's shot — flies straight in its direction (+$30) with the speeds of the
  // difficulty's table ($861F easy … $87DF), 1 HP, destroyed with a small explosion for 2 points.
  C[0x02E0D8] = function (x) {
    K.w16(x+0x14, 0xE91F);
    K.w16(x+0x16, 0);
    K.slotsOf(x, 0x1F);
    K.body(x, 1);
    K.pal(x, 0xB1);
    var d = K.r16(0x84);
    // ? $02:E112-$02:E182: the other difficulties, read statically
    var tbl = (d & 2) ? 0x869F : (d & 4) ? 0x871F : (d & 8) ? 0x879F : (d & 0x10) ? 0x87DF : 0x861F;
    var i = 4*K.r16(x+0x30);
    K.w16(x+0xD, K.d16(tbl+i));
    K.w16(x+0x12, K.d16(tbl+2+i));
    K.setState(x, 0xE18C);
  };
  C[0x02E18C] = function (x) {
    K.listAdd(x);
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    K.touchesShip(x, 0xE957, true);
    if (K.offRight(x, 0x11, 0x122) || K.offBottom(x, 0x11, 0xF2)) { L_02E213(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x40, 0x400);
    if (!K.hit(x, 0xE957)) { return; }
    // L_02E201
    K.explode(x, EXPLODE_AT, false);
    K.scoreAdd(2);
    K.sound(0x16);
    L_02E213(x);
  };
  var L_02E213 = function (x) { K.endAt(x, 0xE223); };
  C[0x02E223] = kill;

  if (typeof installEnemyCode5 === 'function') {
    installEnemyCode5(K);
  }
}

if (typeof globalThis !== 'undefined') { globalThis.installEnemyCode4 = installEnemyCode4; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installEnemyCode4; }
