// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The bosses of Super R-Type — the objects of bank `$08` the odd sections'
 * wave lists spawn (`sources/docs/disasm_notes.md` §10), carried over
 * state by state onto the kernel of `app/gameKernel.js`: the end-of-
 * section marker (`$824F`), the boss of every level with its parts, their
 * shots and their death. The bosses talk to their parts through the
 * flag words `$8C` (set by the object scripts of bank `$06`,
 * `L_009FF2`) and `$8E` (set by the parts), and the end of a boss raises
 * bit 5 of `$4A` — the section's end the level manager (`app/ship.js`)
 * acts on. The conventions are `app/enemies.js`'s.
 *
 * @param {Ship} K - The game.
 */
function installBossCode(K) {
  var C = K.code;
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };
  /** `LDA $84; BIT #1; BNE +3; LDA #3; STA $00; JSL S_00A71E; AND $00`: the next byte of the sequence masked by 3, or by the hard difficulty's word */
  var seqMasked = function () {
    var m = (K.r16(0x84) & 1) ? K.r16(0x84) : 3;
    return K.sequenceNext() & m;
  };
  /** `LDA $02,X; STA $F3; LDY $00,X; LDA $02,Y; CMP $F3; BEQ ok; BCC ok; RTL`: the task waits for its children */
  var childrenDone = function (x) { return K.childrenDone(x); };

  // ============================================================ the end of a section ($08:824F)
  // ? L_08824F: the last entry of a level's wave list raises bit 5 of $4A — the ship flies out
  C[0x08824F] = function (x) {
    K.w16(0x4A, K.r16(0x4A) | 0x20);
    K.setState(x, 0x825C);
  };
  C[0x08825C] = kill;

  // ============================================================ boss 1 ($08:8260)
  // L_088260: comes in from the right with four arms (L_0887BE), then swings on the scripts
  // $94DE / $9A42 at a speed that climbs and falls, spawning the eyes (L_088881) and firing
  C[0x088260] = function (x) {
    K.slotsOf(x, 0x19);
    K.pal(x, 0xA6);
    K.pal2(x, 0x80);
    K.w16(x+0x22, K.d16(0xB5DE+K.r16(0x88)));
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(x+0x3E, K.d16(0xB5F2+K.r16(0x86)) & 0xFF);
    K.w16(x+0x38, 0);
    K.w16(x+0x16, 0);
    K.w16(x+0xB, 0x340);
    K.w16(x+0x10, 0x260);
    K.w16(x+0xD, 0x400);
    for (var i = 0; i < 4; i++) {
      var y = K.spawn(x, 0x0887BE, 8);
      if (y < 0) { break; }
      K.w16(y+0x30, 0x20*i);
    }
    K.setState(x, 0x831A);
  };
  /** the body of a pass: the sprite, the phase by the speed +$2E (wrapping at $8000), the arms' angle +$30, the hit */
  var boss1Body = function (x) {
    K.addSprite(x, 0xB4CC, 2, true);
    var v = (K.r16(x+0x2E)+K.r16(x+0x16)) & 0xFFFF;
    if (v >= 0x8000) { v &= 0xFF; }
    K.w16(x+0x16, v);
    K.w16(x+0x30, K.r16(x+0x17) & 0x7C);
    if (K.hitBlink(x, 0x0700, 0xB5B8)) { L_088611(x); return true; }
    K.touchesShip(x, 0xB5B8, true);
    return false;
  };
  C[0x08831A] = function (x) {
    K.listAdd(x);
    K.moveXBack(x);
    K.objectScreen(x);
    if (boss1Body(x)) { return; }
    if (K.r16(x+0xB) >= 0x2E8) {
      var sp = (K.r16(x+0xD)-0x10) & 0xFFFF;
      if (sp < 0x100) { sp = 0x100; }
      K.w16(x+0xD, sp);
      return;
    }
    // L_088399: in place — one of the two swing scripts
    var script = (K.sequenceNext() & 1) ? 0x9A42 : 0x94DE;
    K.scriptStart(x, 0, script);
    S_08869B(x);
    K.w16(x+0x3C, K.d16(0x89A9+K.r16(0x88)));
    L_0883BC(x);
  };
  // L_0883BC: the swing speeds up by +$32 a pass to the limit of $B5BE
  var L_0883BC = function (x) {
    K.w16(x+0x32, 0x10);
    K.w16(x+0x34, K.d16(0xB5BE+(seqMasked() << 1)));
    K.sound(0x1C);
    K.setState(x, 0x83EC);
  };
  C[0x0883EC] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreen(x);
    if (boss1Body(x)) { return; }
    S_088670(x);
    S_0886B6(x);
    var v = (K.r16(x+0x2E)+K.r16(x+0x32)) & 0xFFFF;
    if (v < K.r16(x+0x34)) {
      K.w16(x+0x2E, v);
      return;
    }
    // L_088466: at the top speed for $B5C6 passes
    K.w16(x+0x2E, K.r16(x+0x34));
    K.w16(x+0x36, K.d16(0xB5C6+(seqMasked() << 1)));
    K.setState(x, 0x848F);
  };
  C[0x08848F] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreen(x);
    if (boss1Body(x)) { return; }
    S_088670(x);
    S_0886B6(x);
    K.w16(x+0x36, K.r16(x+0x36)-1);
    if (K.r16(x+0x36) == 0) { K.setState(x, 0x8508); }
  };
  C[0x088508] = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreen(x);
    if (boss1Body(x)) { return; }
    S_088670(x);
    S_0886B6(x);
    var v = (K.r16(x+0x2E)-K.r16(x+0x32)) & 0xFFFF;
    if (v < K.r16(x+0x34)) {
      K.w16(x+0x2E, v);
      return;
    }
    // L_088582: a rest of $B5CE passes
    K.w16(x+0x36, K.d16(0xB5CE+(seqMasked() << 1)));
    K.setState(x, 0x85A5);
  };
  C[0x0885A5] = function (x) {
    K.listAdd(x);
    K.objectScreen(x);
    if (boss1Body(x)) { return; }
    S_0886B6(x);
    K.w16(x+0x36, K.r16(x+0x36)-1);
    if (K.r16(x+0x36) == 0) { L_0883BC(x); }
  };
  // S_088670: an eye (L_088881) every $B5D6 passes, up to +$3E of them alive
  var S_088670 = function (x) {
    K.w16(x+0x3A, K.r16(x+0x3A)-1);
    if (K.r16(x+0x3A) != 0) { return; }
    if (K.r16(x+0x38) < K.r16(x+0x3E)) {
      var y = K.spawn(x, 0x088881, 16);
      if (y < 0) { return; }
      K.w16(x+0x38, K.r16(x+0x38)+1);
      K.w16(y+0xB, K.r16(x+0xB));
      K.w16(y+0x10, K.r16(x+0x10));
    }
    S_08869B(x);
  };
  var S_08869B = function (x) {
    K.w16(x+0x3A, K.d16(0xB5D6+(seqMasked() << 1)));
  };
  // S_0886B6: every $89F9 passes an aimed shot (+$30 = $100) or four shots in the four quarters (+$30 = 1)
  var S_0886B6 = function (x) {
    K.w16(x+0x3C, K.r16(x+0x3C)-1);
    if (K.r16(x+0x3C) != 0) { return; }
    var y;
    if (K.sequenceNext() & 2) {
      y = K.spawn(0x17FB, 0x03D2BF, 16);
      if (y >= 0) {
        K.w16(y+0x32, K.directionTo(x, SHIP));
        K.w16(y+0x30, 0x100);
        K.w16(y+0xB, K.r16(x+0xB));
        K.w16(y+0x10, K.r16(x+0x10));
      }
    } else {
      for (var dir = 0; dir < 16; dir += 4) {
        y = K.spawn(0x17FB, 0x03D2BF, 16);
        if (y < 0) { break; }
        K.w16(y+0x32, dir);
        K.w16(y+0x30, 1);
        K.w16(y+0xB, K.r16(x+0xB));
        K.w16(y+0x10, K.r16(x+0x10));
      }
    }
    // L_0887B5
    K.w16(x+0x3C, K.d16(0x89F9+K.r16(0x88)));
  };
  // ? L_088611: the death — the section's end flag, the score, the burst, the music off
  var L_088611 = function (x) {
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.w16(0x4A, K.r16(0x4A) | 0x20);
    K.scoreAdd(0x20);
    K.explode(x, EXPLODE_SMALL, false);
    K.sound(0xFF);
    K.sound(0x24);
    K.setState(x, 0x8642);
  };
  C[0x088642] = function (x) {
    if (!childrenDone(x)) { return; }
    K.sound(0x24);
    K.w16(0x4A, K.r16(0x4A) | 0x10);
    K.setState(x, 0x866C);
  };
  C[0x08866C] = kill;
  // L_0887BE: an arm — at the angle of the parent's +$30 plus its own, from the table $B530
  C[0x0887BE] = function (x) {
    K.slotsOf(x, 0x19);
    K.pal(x, 0xA6);
    K.pal2(x, 0x80);
    K.w16(x+0x22, K.d16(0xB5E8+K.r16(0x88)));
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.setState(x, 0x8801);
  };
  C[0x088801] = function (x) {
    var p = K.r16(x+8);
    if (K.r16(p+6) & 0x80) { L_088860(x); return; }
    var a = (K.r16(p+0x30)+K.r16(x+0x30)) & 0x7C;
    K.w16(x+0xB, K.d16(0xB530+a));
    K.w16(x+0x10, K.d16(0xB532+a));
    K.objectScreenParent(x);
    K.addSprite(x, 0xB4D7, 2, true);
    if (K.hitBlink(x, 0x0700, 0xB5B8)) { L_088860(x); return; }
    K.touchesShip(x, 0xB5B8, true);
  };
  var L_088860 = function (x) {
    K.scoreAdd(5);
    K.sound(0x17);
    K.objectFromScreen(x);
    K.explode(x, EXPLODE_AT, false);
    K.setState(x, 0x887D);
  };
  C[0x08887D] = kill;
  // L_088881: an eye — waits at the boss, then flies at the ship
  C[0x088881] = function (x) {
    K.slotsOf(x, 0x19);
    K.pal(x, 0xCF);
    K.pal2(x, 0x80);
    K.body(x, 3);
    K.w16(x+0x14, K.d16(0xB5B0+((K.sequenceNext() & 3) << 1)));
    K.w16(x+0x16, 0);
    // ? the PRO difficulty (bit 4 of $16E5) waits $12C passes
    K.w16(x+0x32, (K.r16(0x16E5) & 0x10) ? 0x12C : 0);
    K.setState(x, 0x88E7);
  };
  C[0x0888E7] = function (x) {
    var p = K.r16(x+8);
    if (K.r16(p+6) & 0x80) { L_088A09(x); return; }
    K.objectScreen(x);
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x30, 0x400);
    if (K.hitBlink(x, 0x0700, 0xB5B8)) { L_088A52(x); return; }
    K.touchesShip(x, 0xB5B8, true);
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    // ? L_088958: at the ship
    var i = K.directionTo(x, SHIP) << 2;
    K.w16(x+0xD, K.d16(0x859F+i));
    K.w16(x+0x12, K.d16(0x85A1+i));
    K.setState(x, 0x8977);
  };
  C[0x088977] = function (x) {
    var p = K.r16(x+8);
    if (K.r16(p+6) & 0x80) { L_088A09(x); return; }
    K.moveXSigned(x);
    K.moveYSigned(x);
    if (K.offRight(x, 0x10, 0x120) || K.offBottom(x, 0x10, 0xF0)) { L_088A5D(x); return; }
    K.objectScreen(x);
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x60, 0x400);
    if (K.hitBlink(x, 0x0700, 0xB5B8)) { L_088A52(x); return; }
    K.touchesShip(x, 0xB5B8, true);
  };
  // ? L_088A09: the boss is dead — the eye spins out
  var L_088A09 = function (x) {
    K.w16(x+0x32, (K.sequenceNext() & 0x1F)+1);
    K.setState(x, 0x8A1D);
  };
  C[0x088A1D] = function (x) {
    K.objectScreen(x);
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x30, 0x400);
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) { L_088A52(x); }
  };
  var L_088A52 = function (x) {
    K.explode(x, EXPLODE_AT, false);
    K.sound(0x13);
    L_088A5D(x);
  };
  var L_088A5D = function (x) {
    var p = K.r16(x+8);
    K.w16(p+0x38, K.r16(p+0x38)-1);
    K.setState(x, 0x8A6E);
  };
  C[0x088A6E] = kill;

  if (typeof installBossCode2 === 'function') {
    installBossCode2(K);
  }
} // installBossCode

if (typeof globalThis !== 'undefined') { globalThis.installBossCode = installBossCode; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installBossCode; }
