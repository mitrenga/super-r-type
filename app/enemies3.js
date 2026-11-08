// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The enemies of Super R-Type, third part — the walkers of level 4 (bank `$02`, `$AD34` family)
 * and the hopper of level 3 that follows them in the bank (`$B403`, never spawned in any recording —
 * read statically, `?`).
 * Carried over state by state onto the kernel of `app/gameKernel.js` with
 * the conventions, the marks and the measure of `app/enemies.js`
 * (`tools/matchenemies.mjs`).
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installEnemyCode3(K) {
  var C = K.code;
  /** `JML task_kill` */
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };
  /** `LDA #meta; STA $14,X; STZ $16,X; LDA #state; STA $03,X`: a new animation and the state that plays it */
  var animState = function (x, meta, state) {
    K.w16(x+0x14, meta);
    K.w16(x+0x16, 0);
    K.setState(x, state);
  };
  /**
   * `DEC $34,X; BNE +; (the aimed shot block); LDA $36,X; STA $34,X`: the shot timer of the walker —
   * at zero an aimed shot (`$03:D2BF`) and the timer reloaded from +$36 (not when no node was free).
   */
  var shoot = function (x) {
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) == 0 && K.aimedShot(x) >= 0) {
      K.w16(x+0x34, K.r16(x+0x36));
    }
  };

  // ============================================================ the walker of level 4 ($02:AD34)
  // L_02AD34: a walker on the floor — comes in by a script (+$30 low byte 0: from the right, walking
  // left; else from the left, walking right, $B059), shoots at the ship by the difficulty timers
  // (+$34 / +$36 = $899F / $89EF). When its script puts it on the ground it stands up ($AE8D / $B153),
  // walks (+$D = -1 / +1 a pixel a pass), turns at a wall and shoots standing ($B31F), and at the
  // edge of a floor it crouches ($AFD3 / $B299) and jumps by one of the scripts $AC14 / $AC26
  // ($AC34 / $AC46 mirrored) — down to a lower floor or up. One hit kills it ($B3DD).
  C[0x02AD34] = function (x) {
    K.slotsOf(x, 0xA);
    K.body(x, 1);
    K.pal(x, 0x87);
    var p = K.diffParams(x);
    K.w16(x+0x34, p[0]);
    K.w16(x+0x36, p[1]);
    if (K.r16(x+0x30) & 0xFF) { L_02B059(x); return; }
    K.scriptStart(x, 0x200, 0xAC20);
    L_02AD9D(x);
  };
  /** L_02AD9D: the flight frame of the left-bound walker and its scripted state */
  var L_02AD9D = function (x) { animState(x, 0xDDB3, 0xADAF); };
  /**
   * the scripted flight (states $ADAF and $B075 mirrored): the list, the script, the ship touch, off the
   * screen (right or bottom — ? the bottom `JMP $B3EF` never ran), the frame, the phase, a hit, the shot
   * timer; false when the object is gone
   */
  var walkerFlight = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xDDD1, true);
    if (K.offRight(x, 0x20, 0x140)) { L_02B3EF(x); return false; }
    if (K.offBottom(x, 0x18, 0x100)) { L_02B3EF(x); return false; }   // ? $02:ADE5 / $02:B0AB
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x100, 0x200);
    if (K.hit(x, 0xDDD1)) { L_02B3DD(x); return false; }
    shoot(x);   // ? $02:AE27 / $02:B0ED: the shot block of the flight never ran
    return true;
  };
  C[0x02ADAF] = function (x) {
    if (!walkerFlight(x)) { return; }
    if (probe(x, 0, 0xF)) { animState(x, 0xDDAD, 0xAE8D); }   // L_02AE7B: the ground under it — it stands up
  };
  /**
   * standing up / crouching (states $AE8D, $AFD3, $B153, $B299): the animation plays once;
   * returns true at its end, false while it plays or when the object is gone
   */
  var walkerPose = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xDDD1, true);
    K.drawAnim(x, 2, true);
    if (K.hit(x, 0xDDD1)) { L_02B3DD(x); return false; }
    return K.phaseEnd(x, 0x40, 0x300);
  };
  C[0x02AE8D] = function (x) {
    if (!walkerPose(x)) { return; }
    // L_02AEDE: walks left
    animState(x, 0xDDB7, 0xAEF6);
    K.w16(x+0xD, 0xFF00);
  };
  /** the walk (states $AEF6 and $B1BC): false when the object is gone */
  var walkerWalk = function (x) {
    K.listAdd(x);
    K.moveXSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xDDD1, true);
    if (K.offRight(x, 0x20, 0x140)) { L_02B3EF(x); return false; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x20, 0x400);
    if (K.hit(x, 0xDDD1)) { L_02B3DD(x); return false; }
    shoot(x);
    return true;
  };
  C[0x02AEF6] = function (x) {
    if (!walkerWalk(x)) { return; }
    if (!probe(x, -0xD, 0xF)) { animState(x, 0xDDAD, 0xAFD3); return; }   // L_02AFC1: no floor ahead — crouches
    if (probe(x, -0xD, 0)) { L_02B31F(x); }   // ? $02:AFBD: a wall ahead — stands and shoots
  };
  C[0x02AFD3] = function (x) {
    if (!walkerPose(x)) { return; }
    // L_02B024: the jump — down ($AC14) unless the floor ahead is a step up ($AC26, ?)
    K.w16(x+0x10, K.r16(x+0x10)-1);
    if (probe(x, -0x31, 0) || !probe(x, -0x31, 0xF)) {
      K.scriptStart(x, 0x200, 0xAC14);
    } else {
      K.scriptStart(x, 0x200, 0xAC26);   // ? $02:B04C
    }
    L_02AD9D(x);
  };
  // L_02B059: the mirrored walker — comes from the left by script $AC40, walks right
  var L_02B059 = function (x) {
    K.scriptStart(x, 0x200, 0xAC40);
    L_02B063(x);
  };
  var L_02B063 = function (x) { animState(x, 0xDDC5, 0xB075); };
  C[0x02B075] = function (x) {
    if (!walkerFlight(x)) { return; }
    if (probe(x, 0, 0xF)) { animState(x, 0xDDBF, 0xB153); }   // L_02B141
  };
  C[0x02B153] = function (x) {
    if (!walkerPose(x)) { return; }
    // L_02B1A4: walks right
    animState(x, 0xDDC9, 0xB1BC);
    K.w16(x+0xD, 0x100);
  };
  C[0x02B1BC] = function (x) {
    if (!walkerWalk(x)) { return; }
    if (!probe(x, 0xC, 0xF)) { animState(x, 0xDDBF, 0xB299); return; }   // ? L_02B287
    if (probe(x, 0xC, 0)) { L_02B31F(x); }
  };
  // ? $02:B299-$02:B31E: the mirrored crouch and jump, read statically — scripts $AC34 / $AC46
  C[0x02B299] = function (x) {
    if (!walkerPose(x)) { return; }
    K.w16(x+0x10, K.r16(x+0x10)-1);
    if (probe(x, 0x30, 0) || !probe(x, 0x30, 0xF)) {
      K.scriptStart(x, 0x200, 0xAC34);
    } else {
      K.scriptStart(x, 0x200, 0xAC46);
    }
    L_02B063(x);
  };
  // L_02B31F: at a wall — stands still, faces the ship and shoots
  var L_02B31F = function (x) {
    K.w16(x+0x32, 1);
    K.w16(x+0x34, 0x3C);
    K.setState(x, 0xB334);
  };
  C[0x02B334] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xDDD1, true);
    if (K.offRight(x, 0x20, 0x140)) { L_02B3EF(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) {
      K.w16(x+0x32, 0x3C);
      // ★ `ADC #$200` without CLC — the carry is clear here (the `BCC` above was taken)
      K.w16(x+0x14, ((K.r16(x+0x1A)+0x200) & 0xFFFF) >= K.r16(0x1594) ? 0xDD3F : 0xDD4A);
    }
    K.addSprite(x, K.r16(x+0x14), 2, true);
    if (K.hit(x, 0xDDD1)) { L_02B3DD(x); return; }
    shoot(x);
  };
  // L_02B3DD: hit — explodes, two points, sound $12
  var L_02B3DD = function (x) {
    K.explode(x, EXPLODE, true);
    K.scoreAdd(2);
    K.sound(0x12);
    L_02B3EF(x);
  };
  var L_02B3EF = function (x) { K.endAt(x, 0xB3FF); };
  C[0x02B3FF] = kill;

  // ============================================================ the hopper launcher of level 3 ($02:B403)
  // ? $02:B403-$02:B81A: never executed in any recording (section 4, 11 wave entries) — read statically.
  // L_02B403: an invisible launcher — while the ship is within $30 pixels to its left (+$31 bit 0: to
  // its right, $B48D) it releases a hopper ($B4F1) every +$36 passes ($DE47 by +$30 bits 0-1).
  C[0x02B403] = function (x) {
    K.w16(x+0x36, K.d16(0xDE47+2*(K.r16(x+0x30) & 3)));
    K.w16(x+0x32, 1);
    K.setState(x, (K.r16(x+0x31) & 1) ? 0xB48D : 0xB42B);
  };
  /** the launch: the timer, the hopper at the launcher's position and layer */
  var L_02B452 = function (x) {
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    var y = K.spawn(0x17FB, 0x02B4F1, 16);
    if (y < 0) { return; }
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
    K.w16(x+0x32, K.r16(x+0x36));
  };
  C[0x02B42B] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x20, 0x140)) { L_02B4E6(x); return; }
    if (((K.r16(x+0x1A)-0x30) & 0xFFFF) >= shipX()) { return; }
    if (K.r16(x+0x1A) < shipX()) { return; }
    L_02B452(x);
  };
  C[0x02B48D] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x20, 0x140)) { L_02B4E6(x); return; }
    if (K.r16(x+0x1A) >= shipX()) { return; }
    if (((K.r16(x+0x1A)+0x30) & 0xFFFF) < shipX()) { return; }
    L_02B452(x);
  };
  var L_02B4E6 = function (x) { K.setState(x, 0xB4ED); };
  C[0x02B4ED] = kill;
  // L_02B4F1: the hopper — opens ($DE1F) by script $AC54 at the speed of the difficulty ($DE3D), waits
  // $14 passes, then jumps by script $AC5A ($DE23); dies on the terrain or of two hits and leaves two
  // fragments ($B714) flying apart.
  C[0x02B4F1] = function (x) {
    K.slotsOf(x, 0x1C);
    K.body(x, 2);
    K.pal(x, 0xAA);
    K.pal2(x, 0xAA);
    K.w16(x+0x14, 0xDE1F);
    K.w16(x+0x16, 0);
    K.scriptStart(x, K.d16(0xDE3D+K.r16(0x88)), 0xAC54);
    K.setState(x, 0xB547);
  };
  C[0x02B547] = function (x) {
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x40, 0x200);
    if (K.r16(x+0x2E) != 0) { return; }   // the script still runs
    K.w16(x+0x34, 0x14);
    K.setState(x, 0xB58F);
  };
  C[0x02B58F] = function (x) {
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x40, 0x200);
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) != 0) { return; }
    K.w16(x+0x14, 0xDE23);
    K.w16(x+0x16, 0);
    K.scriptStart(x, K.d16(0xDE3D+K.r16(0x88)), 0xAC5A);
    K.setState(x, 0xB5E2);
  };
  C[0x02B5E2] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xDE37, true);
    if (K.offRight(x, 0x10, 0x120)) { L_02B700(x); return; }
    if (K.offBottom(x, 0x10, 0xF0)) { L_02B700(x); return; }
    K.drawAnim(x, 2, true);
    // the phase runs round the upper half of the table: `CMP #$A00; BCC; AND #$FF; ORA #$800`
    var v = (K.r16(x+0x16)+0x40) & 0xFFFF;
    if (v >= 0xA00) { v = (v & 0xFF) | 0x800; }
    K.w16(x+0x16, v);
    if (probe(x, 0, -8)) { L_02B67B(x); return; }
    if (K.hitBlink(x, 0x0700, 0xDE37)) { L_02B6EE(x); }
  };
  /** L_02B67B: the terrain — two fragments, one right ($61, +$2D 3), one left (-$61, +$2D 5), both up */
  var L_02B67B = function (x) {
    var y = K.spawn(0x17FB, 0x02B714, 16);
    if (y < 0) { L_02B6F5(x); return; }
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
    K.w16(y+0xD, 0x61);
    K.w16(y+0x12, 0xEC);
    K.w16(y+0x2D, 3);
    y = K.spawn(0x17FB, 0x02B714, 16);
    if (y < 0) { L_02B6F5(x); return; }
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
    K.w16(y+0xD, 0xFF9F);
    K.w16(y+0x12, 0xEC);
    K.w16(y+0x2D, 5);
    L_02B6EE(x);
  };
  var L_02B6EE = function (x) {
    K.scoreAdd(2);
    L_02B6F5(x);
  };
  var L_02B6F5 = function (x) {
    K.explode(x, EXPLODE, true);
    K.sound(0x13);
    L_02B700(x);
  };
  var L_02B700 = function (x) { K.endAt(x, 0xB710); };
  C[0x02B710] = kill;
  // L_02B714: a fragment of the hopper — flies by its direction +$2D (a word: +$2E rides along, ★ the
  // stores are 16-bit) and every $14 passes turns one step towards the ship ($859F speeds)
  C[0x02B714] = function (x) {
    K.slotsOf(x, 0x1C);
    K.body(x, 1);
    K.pal(x, 0xAA);
    K.w16(x+0x30, 0x14);
    K.w16(x+0x32, 0x14);
    K.setState(x, 0xB750);
  };
  C[0x02B750] = function (x) {
    K.listAdd(x);
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xDEC1, true);
    if (K.offRight(x, 0x10, 0x120)) { L_02B807(x); return; }
    if (K.offBottom(x, 0x10, 0xF0)) { L_02B807(x); return; }
    K.addSprite(x, K.d16(0xDEA1+2*K.r16(x+0x2D)), 2, true);
    if (K.hit(x, 0xDEC1)) { K.scoreAdd(1); L_02B7FC(x); return; }
    if (probe(x, 0, 0)) { L_02B7FC(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    K.w16(x+0x32, K.r16(x+0x30));
    var dir = K.directionTo(x, SHIP);
    var d = K.r16(x+0x2D);
    var diff = (dir-d) & 0xFFFF;
    if (diff != 0) {
      d = (diff & 8) ? d-1 : d+1;
    }
    d &= 0xF;
    K.w16(x+0x2D, d);
    K.w16(x+0xD, K.d16(0x859F+4*d));
    K.w16(x+0x12, K.d16(0x85A1+4*d));
  };
  var L_02B7FC = function (x) {
    K.explode(x, EXPLODE, true);
    K.sound(0x12);
    L_02B807(x);
  };
  var L_02B807 = function (x) { K.endAt(x, 0xB817); };
  C[0x02B817] = kill;

  if (typeof installEnemyCode4 === 'function') {
    installEnemyCode4(K);
  }
}

if (typeof globalThis !== 'undefined') { globalThis.installEnemyCode3 = installEnemyCode3; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installEnemyCode3; }
