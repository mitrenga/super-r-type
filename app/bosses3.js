// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The bosses of Super R-Type, third part — the bosses of levels 5, 6 and 7
 * (bank `$08`): the head of level 5 (`$B12D`) with its jaws, teeth, flaps,
 * worms, bombs and spitter and the section's scroll (`$C1ED`); the
 * three-part boss of level 6 (`$C21A`) with its guns, spikes, bombs and
 * mines; the fortress of level 7 (`$D1D0`, `$D1F2`, `$D49A`, `$D55B`) with
 * its wall builders, homing shots and shells — and the turret spawner
 * `$02DF65` of bank `$02` only the fortress uses. Carried over state by
 * state onto the kernel of `app/gameKernel.js` with the conventions, the
 * marks and the measure of `app/enemies.js` (`tools/matchenemies.mjs`).
 * The bosses talk to their parts through the flag word `$8E`.
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installBossCode3(K) {
  var C = K.code;
  /** `JML task_kill` */
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };

  /** the layer object of a layer record (`$1832` BG1 / `$1862` BG2) — the bosses read and write its fields */
  var layer = function (base) { return K.level.layers[base == 0x1862 ? 1 : 0]; };
  /** `STA $001E,Y` on a layer record: the integer part of the layer's y */
  var layerSetY = function (base, v) { var l = layer(base); l.y = ((v & 0xFFFF) << 8) | (l.y & 0xFF); };
  /** `STA $1827; LDY #$1862; STA $0014,Y`: the scroll speed and BG2's speed x together */
  var setScrollSpeed = function (v) { K.w16(0x1827, v); K.level.scrollSpeed = v; };
  /**
   * `terrain_probe` with its result byte: ★ the routine leaves the collision nibble of the hit block in A
   * (`LDA $7E3160,X; AND #$FF`), and the jaws of boss 5 test its bit 0 (`BIT #$0001`) — a kind of block the
   * jaw may bite through. Zero when nothing was hit. (Candidate for the kernel: `terrainHit` returning the byte.)
   */
  var probeByte = function (x, dx, dy) {
    K.w16(0x42, dx & 0xFFFF);
    K.w16(0x44, dy & 0xFFFF);
    var flags = K.r16(0x1821);
    if (flags & 1) {
      var a = K.level.collision[K.collisionAddress(x, 0) & 0x1FFF];
      if (a) { K.hitLayer = 0x1832; return a; }
    }
    if (flags & 2) {
      var b = K.level.collision[(K.collisionAddress(x, 1)+0x1000) & 0x1FFF];
      if (b) { K.hitLayer = 0x1862; return b; }
    }
    K.hitLayer = (flags & 2) ? 0x1862 : 0x1832;
    return 0;
  };
  /** `LDA #tbl; STA $00; LDA $17,X; AND #$FF; ASL; ADC $00; TAY; LDA $0000,Y`: a frame of a table the object does not keep in +$14 */
  var animAt = function (x, tbl) { return K.d16(tbl+(K.r8(x+0x17) << 1)); };
  /** `LDA $08,X … LDA $06,Y; BIT #$80`: the parent is dead */
  var parentDead = function (x) { return (K.r16(K.r16(x+8)+6) & 0x80) != 0; };
  /** `S_03CDF0`: the burst `$03D08F` at the object's screen position + 512 (the parts' guns and spikes keep offsets from the parent in +$B / +$10) */
  var S_03CDF0 = function (x) {
    var y = K.spawn(0x17FB, EXPLODE_AT, 16);
    if (y < 0) { return; }
    K.w16(y+0xB, K.r16(x+0x1A)+0x200);
    K.w16(y+0x10, K.r16(x+0x1C)+0x200);
  };
  /** `S_03CF5E`: the remains of a boss — object `$03CF85` (a child, 8 free nodes) with +$30 = the record `rec`, the boss's layer and position */
  var S_03CF5E = function (x, rec) {
    var y = K.spawn(x, 0x03CF85, 8);
    if (y < 0) { return; }
    K.w16(y+0x30, rec);
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
  };

  // ============================================================ boss 5 ($08:B12D) — section 9
  // L_08B12D: the head of level 5 — rides on BG2 with two jaws (L_08B3FA / L_08B62E) and two flaps
  // (L_08B9B2 / L_08B9C0); when the layer's speed reaches $40 the fight starts: two timers
  // (L_08B360 raises $8E bit 4 = the spitter, L_08B3AA bits 5/6 = the worms and bombs of the flaps)
  C[0x08B12D] = function (x) {
    K.slotsOf(x, 9);
    K.w16(x+0x14, 0xC20A);
    K.w16(x+0x16, 0);
    K.pal(x, 0x9A);
    K.pal2(x, 0x80);
    K.w16(x+0x22, K.d16(0xC2FE+K.r16(0x88)));
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.spawn(x, 0x08B3FA, 8);
    K.spawn(x, 0x08B62E, 8);
    K.spawn(x, 0x08B9B2, 8);
    K.spawn(x, 0x08B9C0, 8);
    K.setState(x, 0xB19F);
  };
  C[0x08B19F] = function (x) {
    K.objectScreenLayer(x);
    K.addSprite(x, 0xC1BC, 2, true);
    if (layer(0x1862).speedX == 0x40) { return; }
    // L_08B1B6: the layer's speed has left $40 (L_08C1ED raises it) — the fight
    K.w16(0x8E, K.r16(0x8E) | 4);
    K.sound(0x31);
    K.spawn(x, 0x08B360, 8);
    K.spawn(x, 0x08B3AA, 8);
    L_08B1D7(x);
  };
  var L_08B1D7 = function (x) { K.setState(x, 0xB1E0); };
  // L_08B1E0: the mouth opens (phase up to $200); open, it can be hit and raises $8E bit 3; a block
  // under it (terrain) closes it (L_08B295)
  C[0x08B1E0] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x50, 0x1A0)) { L_08B346(x); return; }   // ? $B1F0
    K.drawAnim(x, 2, true);
    var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
    var open = v >= 0x300;
    if (open) { v = 0x200; }
    K.w16(x+0x16, v);
    if (open) {
      K.touchesShip(x, 0xC1FE, true);
      if (K.hitBlink(x, 0x0700, 0xC1F8)) { L_08B2F9(x); return; }   // ? $B235
      K.hitTest(x, 0x0704, 0xC1FE);
      K.w16(0x8E, K.r16(0x8E) | 8);
      if (K.r16(0x8E) & 0x10) {
        K.spawn(x, 0x08BF80, 16);   // ? $B262: the spitter
      }
    }
    // L_08B26F
    if (!probe(x, 0, 0)) { return; }
    K.w16(0x8E, K.r16(0x8E) & 0xFFF7);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFFDF);
    K.setState(x, 0xB295);
  };
  C[0x08B295] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x50, 0x1A0)) { L_08B346(x); return; }   // ? $B2A5
    K.drawAnim(x, 2, true);
    K.touchesShip(x, 0xC1FE, true);
    K.hitTest(x, 0x0702, 0xC1F8);
    K.hitTest(x, 0x0704, 0xC1FE);
    if (!probe(x, 0, 0)) { L_08B1D7(x); return; }
    var v = (K.r16(x+0x16)-0x80) & 0xFFFF;
    if (v >= 0x300) { v &= 0xFF; }
    K.w16(x+0x16, v);
  };
  // ? L_08B2F9: the death — the section's end flag, the score, the remains, and the layer the head rides
  // on drifts away on its own (kind $A, speed x counting down from 0 a pass)
  var L_08B2F9 = function (x) {
    K.w16(0x4A, K.r16(0x4A) | 0x20);
    K.scoreAdd(0x100);
    S_03CF5E(x, 0xC292);
    var l = layer(K.r16(x+0x1E));
    l.kind = 0xA;
    l.speedX = 0;
    l.speedY = 0;
    K.setState(x, 0xB328);
  };
  C[0x08B328] = function (x) {
    var l = layer(K.r16(x+0x1E));
    l.speedX = (l.speedX-1) & 0xFFFF;
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x50, 0x1A0)) { L_08B346(x); }
  };
  // ? L_08B346: gone — the layer stops, bit 4 of $4A ends the section
  var L_08B346 = function (x) {
    layer(K.r16(x+0x1E)).kind = 0;
    K.w16(0x4A, K.r16(0x4A) | 0x10);
    K.setState(x, 0xB35C);
  };
  C[0x08B35C] = kill;
  // L_08B360: the spitter's timer — $C2EA passes, then $8E bit 4 for one pass
  C[0x08B360] = function (x) {
    K.w16(x+0x32, K.d16(0xC2EA+K.r16(0x88)));
    K.w16(x+0x34, K.r16(x+0x32));
    K.setState(x, 0xB377);
  };
  C[0x08B377] = function (x) {
    if (parentDead(x)) { L_08B39F(x); return; }
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) != 0) { return; }
    K.w16(0x8E, K.r16(0x8E) | 0x10);
    K.setState(x, 0xB397);
  };
  C[0x08B397] = function (x) {   // ? the bit back off, the count restarts ($B368)
    K.w16(0x8E, K.r16(0x8E) & 0xFFEF);
    K.w16(x+0x34, K.r16(x+0x32));
    K.setState(x, 0xB377);
  };
  var L_08B39F = function (x) { K.setState(x, 0xB3A6); };
  C[0x08B3A6] = kill;   // ?
  // L_08B3AA: the flaps' timer — $C2F4 passes, then $8E bit 5 (a worm) or bit 6 (a bomb) for one pass
  C[0x08B3AA] = function (x) {
    K.w16(x+0x32, K.d16(0xC2F4+K.r16(0x88)));
    L_08B3B2(x);
  };
  var L_08B3B2 = function (x) {
    K.w16(x+0x34, K.r16(x+0x32));
    K.setState(x, 0xB3C1);
  };
  C[0x08B3C1] = function (x) {
    if (parentDead(x)) { L_08B39F(x); return; }
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) != 0) { return; }
    var bit = (K.sequenceNext() & 2) ? 0x20 : 0x40;
    K.w16(x+0x36, bit);
    K.w16(0x8E, K.r16(0x8E) | bit);
    K.setState(x, 0xB3F2);
  };
  C[0x08B3F2] = function (x) {
    K.w16(0x8E, K.r16(0x8E) & ~K.r16(x+0x36));
    L_08B3B2(x);
  };

  // ------------------------------------------------------------ the jaws (L_08B3FA upper, L_08B62E lower)
  // Each jaw sits on the head, grows teeth (L_08B92C / L_08B918) by S_08B85F, and once BG2 runs at $200
  // opens and closes by the blocks it probes in BG1 (bit 0 of the collision nibble = a block it may bite)
  // — and moves BG1 itself (its +$1E y) to show the bite. The jaw's $8E bit (1 upper, 2 lower) = open.
  var JAW_UPPER = {bit: 1, anim: 0xC1E0, rest: 0xFFB8, open: 0xFFBC, layerOpen: 0x214, dy1: 0xFFE1, dy2: 0xFFDD,
                   wait: 0xB448, arrive: 0xB497, closed: 0xB529, opened: 0xB5B2, slip: false};
  var JAW_LOWER = {bit: 2, anim: 0xC1E4, rest: 0x48, open: 0x44, layerOpen: 0x21C, dy1: 0x1F, dy2: 0x23,
                   wait: 0xB67C, arrive: 0xB6CB, closed: 0xB75D, opened: 0xB7E6, slip: true};
  var jawInit = function (x, j) {
    K.slotsOf(x, 9);
    K.w16(x+0x14, j.anim);
    K.w16(x+0x16, 0);
    K.pal(x, 0x9A);
    K.w16(x+0x22, 0xFFFF);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(0x8E, K.r16(0x8E) & ~j.bit);
    K.w16(x+0xB, 0x20);
    K.w16(x+0x10, j.rest);
    K.setState(x, j.wait);
  };
  /** the jaw's pass: the sprite on the parent, the ship, the shots */
  var jawBody = function (x) {
    K.objectScreenParent(x);
    K.drawAnim(x, 2, false);
    K.touchesShip(x, 0xC204, true);
    K.hitTest(x, 0x0700, 0xC204);
  };
  var jawBodyAnim = function (x) {
    K.objectScreenParent(x);
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x80, 0x200);
    K.touchesShip(x, 0xC204, true);
    K.hitTest(x, 0x0700, 0xC204);
  };
  // L_08B448 / L_08B67C: waiting for the fight ($8E bit 2) — then the first tooth
  var jawWait = function (x, j) {
    jawBody(x);
    if (!(K.r16(0x8E) & 4)) { return; }
    K.spawn(x, 0x08B92C, 8);
    K.w16(x+0x32, 0x10);
    K.setState(x, j.arrive);
  };
  // L_08B497 / L_08B6CB: the jaw slides back (+$B up to $28) while BG2 speeds up to $200
  var jawArrive = function (x, j) {
    K.w16(x+0x10, (K.r16(0x8E) & 3) ? j.open : j.rest);   // ? $B49E / $B6D2
    jawBodyAnim(x);
    var v = K.r16(x+0xB);
    if (j.slip) {
      // ★ L_08B71D: `LDA #1; BIT $50; LDA $0B,X; BEQ` — the pass-counter test is overwritten by the
      // load of +$B, so the lower jaw slides every pass (and would stop at +$B = 0)
      if (v != 0 && v != 0x28) { K.w16(x+0xB, v+1); }
    } else if ((K.r16(0x50) & 1) && v != 0x28) {
      K.w16(x+0xB, v+1);
    }
    if (layer(0x1862).speedX < 0x200) { return; }
    // L_08B508 / L_08B73C
    K.w16(x+0x32, 0);
    jawClose(x, j);
  };
  // L_08B50B / L_08B73F: shut — the bit off, the jaw at rest, BG1 back at y $218
  var jawClose = function (x, j) {
    K.w16(0x8E, K.r16(0x8E) & ~j.bit);
    K.w16(x+0x10, j.rest);
    layerSetY(0x1832, 0x218);
    K.setState(x, j.closed);
  };
  // ? L_08B529 / L_08B75D: shut; a block ahead whose nibble has bit 0 clear opens the jaw and lifts BG1
  var jawClosed = function (x, j) {
    K.w16(x+0x10, (K.r16(0x8E) & 3) ? j.open : j.rest);
    jawBodyAnim(x);
    S_08B85F(x);
    var p = probeByte(x, 0x17, j.dy1);
    if (!p || (p & 1)) { return; }
    K.w16(0x8E, K.r16(0x8E) | j.bit);
    K.w16(x+0x10, j.open);
    layerSetY(0x1832, j.layerOpen);
    K.setState(x, j.opened);
  };
  // ? L_08B5B2 / L_08B7E6: open; three probes along the bite — a block with bit 0 set behind it shuts the jaw
  var jawOpened = function (x, j) {
    jawBodyAnim(x);
    S_08B85F(x);
    var p = probeByte(x, 0x17, j.dy2);
    if (p && !(p & 1)) { return; }
    p = probeByte(x, 0, j.dy2);
    if (p && !(p & 1)) { return; }
    p = probeByte(x, 0xFFF0, j.dy2);
    if (p && (p & 1)) { jawClose(x, j); }
  };
  C[0x08B3FA] = function (x) { jawInit(x, JAW_UPPER); };
  C[0x08B448] = function (x) { jawWait(x, JAW_UPPER); };
  C[0x08B497] = function (x) { jawArrive(x, JAW_UPPER); };
  C[0x08B529] = function (x) { jawClosed(x, JAW_UPPER); };
  C[0x08B5B2] = function (x) { jawOpened(x, JAW_UPPER); };
  C[0x08B62E] = function (x) { jawInit(x, JAW_LOWER); };
  C[0x08B67C] = function (x) { jawWait(x, JAW_LOWER); };
  C[0x08B6CB] = function (x) { jawArrive(x, JAW_LOWER); };
  C[0x08B75D] = function (x) { jawClosed(x, JAW_LOWER); };
  C[0x08B7E6] = function (x) { jawOpened(x, JAW_LOWER); };
  // ? S_08B85F: the teeth by BG1's speed — +$32 bits 4/5 = the layer moves (left / right), bits 0/1 = the
  // tooth grown for that direction (L_08B92C for left, L_08B918 for right); the jaw slides along with it
  var S_08B85F = function (x) {
    var sp = layer(0x1832).speedX;
    var m = sp == 0 ? 0 : (sp & 0x8000) ? 0x10 : 0x20;
    var a = (K.r16(x+0x32) & 0xFFCF) | m;
    K.w16(x+0x32, a);
    var v = K.r16(x+0xB);
    if ((a & 3) == 0) {
      if ((a & 0x30) == 0) {
        // the layer stands: the jaw settles at +$B = $20
        if (K.r16(0x50) & 1) {
          if (v == 0x20) { return; }
          K.w16(x+0xB, v < 0x20 ? v+1 : v-1);
        }
        return;
      }
      var keep = a & 0xFFFC;
      var bit;
      if ((a & 0x10) == 0) { K.spawn(x, 0x08B918, 16); bit = 2; } else { K.spawn(x, 0x08B92C, 16); bit = 1; }
      K.w16(x+0x32, keep | bit);
      return;
    }
    if (a & 1) {
      if ((a & 0x10) == 0) { K.w16(x+0x32, a & 0xFFFC); return; }
      if ((K.r16(0x50) & 1) && v != 0x28) { K.w16(x+0xB, v+1); }
      return;
    }
    if ((a & 0x20) == 0) { K.w16(x+0x32, a & 0xFFFC); return; }
    if ((K.r16(0x50) & 1) && v != 0x18) { K.w16(x+0xB, v-1); }
  };
  // L_08B92C / ? L_08B918: a tooth — on the jaw while the jaw's +$32 keeps the tooth's bit
  C[0x08B918] = function (x) {
    K.w16(x+0x14, 0xC1F0);
    K.w16(x+0x16, 0);
    K.w16(x+0x32, 0x20);
    L_08B93E(x, 0x28);
  };
  C[0x08B92C] = function (x) {
    K.w16(x+0x14, 0xC1E8);
    K.w16(x+0x16, 0);
    K.w16(x+0x32, 0x10);
    L_08B93E(x, 0xFFD8);
  };
  var L_08B93E = function (x, bx) {
    K.w16(x+0xB, bx);
    K.w16(x+0x10, 0);
    K.slotsOf(x, 0x2B);
    K.pal(x, 0x9B);
    K.setState(x, 0xB965);
  };
  C[0x08B965] = function (x) {
    K.objectScreenParent(x);
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x80, 0x400);
    K.touchesShip(x, 0xC210, true);
    if (K.r16(K.r16(x+8)+0x32) & K.r16(x+0x32)) { return; }
    K.setState(x, 0xB9AE);
  };
  C[0x08B9AE] = kill;   // ?

  // ------------------------------------------------------------ the flaps (L_08B9B2 upper, L_08B9C0 lower)
  // bob between +$32 and +$34 once the fight is on, and launch what the timer's bits ask for (S_08BAB5)
  C[0x08B9B2] = function (x) {
    K.w16(x+0x32, 0xFFB0);
    K.w16(x+0x34, 0xFFF0);
    L_08B9CC(x, 0xFFF0);
  };
  C[0x08B9C0] = function (x) {
    K.w16(x+0x34, 0x50);
    K.w16(x+0x32, 0x10);
    L_08B9CC(x, 0x10);
  };
  var L_08B9CC = function (x, y0) {
    K.w16(x+0x10, y0);
    K.w16(x+0xB, 0xFFF4);
    K.slotsOf(x, 9);
    K.pal(x, 0x9A);
    K.w16(x+0x22, 0xFFFF);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(x+0x12, 0x80);
    K.setState(x, 0xBA0E);
  };
  var flapBody = function (x) {
    K.objectScreenParent(x);
    K.addSprite(x, 0xC1D7, 2, true);
    K.touchesShip(x, 0xC210, true);
    K.hitTest(x, 0x0700, 0xC210);
  };
  C[0x08BA0E] = function (x) {
    flapBody(x);
    if (!(K.r16(0x8E) & 4)) { return; }
    L_08BA32(x);
  };
  var L_08BA32 = function (x) {
    K.w16(x+0x36, 0xB4);
    K.setState(x, 0xBA41);
  };
  C[0x08BA41] = function (x) {
    K.moveYBack(x);
    flapBody(x);
    S_08BAB5(x);
    if (K.r16(x+0x10) >= K.r16(x+0x32)) {
      K.w16(x+0x36, K.r16(x+0x36)-1);
      if (K.r16(x+0x36) != 0) { return; }
      K.w16(x+0x36, 0xB4);
    }
    K.setState(x, 0xBA81);
  };
  C[0x08BA81] = function (x) {
    K.moveY(x);
    flapBody(x);
    S_08BAB5(x);
    if (K.r16(x+0x10) >= K.r16(x+0x34)) { K.setState(x, 0xBA41); return; }
    K.w16(x+0x36, K.r16(x+0x36)-1);
    if (K.r16(x+0x36) == 0) { L_08BA32(x); }
  };
  // S_08BAB5: on the screen past x $48, the timer's bit 5 launches a worm (L_08BAEC), bit 6 a bomb (? L_08BDAF) at the flap
  var S_08BAB5 = function (x) {
    if (K.r16(x+0x1A) < 0x48) { return; }
    var f = K.r16(0x8E);
    if (!(f & 0x60)) { return; }
    var y = K.spawn(x, (f & 0x20) ? 0x08BAEC : 0x08BDAF, 16);   // ? $BACB: the bomb
    if (y < 0) { return; }
    K.w16(y+0x1A, K.r16(x+0x1A));
    K.w16(y+0x1C, K.r16(x+0x1C));
  };
  // L_08BAEC: a worm — crawls left along the terrain (16 directions, table $C308), turns at the ship (L_08BCBD)
  C[0x08BAEC] = function (x) {
    K.spawn(x, 0x03D201, 16);
    K.slotsOf(x, 0x2B);
    K.pal(x, 0x9A);
    K.body(x, 1);
    K.w16(x+0x1E, K.r16(0x46));
    K.objectFromLayer(x, K.r16(0x46));
    K.w16(x+0x34, K.d16(0xC308+K.r16(0x88)));
    K.w16(x+0x16, 0x800);
    K.w16(x+0x32, 0x10);
    L_08BB41(x);
  };
  var L_08BB41 = function (x) {
    K.w16(x+0x36, 8);
    K.speedsByDirection(x, K.r16(x+0x34));
    K.setState(x, 0xBB57);
  };
  /** the worm's pass up to the probes: the move, the edges, the sprite (★ table $C216 in both branches of the pass-counter test), the ship, the shots */
  var wormBody = function (x, back) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x10, 0x120) || K.offBottom(x, 0x10, 0xF0)) { L_08BDA4(x); return true; }   // ? $BB6F / $BB7E
    K.addSprite(x, animAt(x, 0xC216), 2, back);
    K.touchesShip(x, 0xC236, true);
    if (K.hit(x, 0xC236)) { L_08BD50(x); return true; }   // ? $BBB6
    return false;
  };
  /** `DEC $32,X; BEQ +; LDA #$10; STA $32,X; LDA $36,X; JSL S_00A72F; LDY $34,X; JSL S_00A752`: every 16 passes a step towards +$36 */
  var wormTurn = function (x) {
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) { return; }
    K.w16(x+0x32, 0x10);
    K.turnTowards(x, K.r16(x+0x36));
    K.speedsByDirection(x, K.r16(x+0x34));
  };
  C[0x08BB57] = function (x) {
    if (wormBody(x, false)) { return; }
    if (K.touchesShip(x, 0xC23C, false)) { L_08BCBD(x); return; }
    if (probe(x, 0, 0)) { L_08BD50(x); return; }
    if (probe(x, 0xFFE8, 0)) { L_08BBF7(x); return; }
    wormTurn(x);
  };
  // ? L_08BBF7: a wall ahead — climb (direction 4) or descend ($C) by the half of the screen
  var L_08BBF7 = function (x) {
    K.w16(x+0x36, K.r16(x+0x1C) >= 0x70 ? 0xC : 4);
    K.speedsByDirection(x, K.r16(x+0x34));
    K.setState(x, 0xBC1A);
  };
  C[0x08BC1A] = function (x) {   // ?
    if (wormBody(x, false)) { return; }
    if (K.touchesShip(x, 0xC23C, false)) { L_08BCBD(x); return; }
    if (probe(x, 0, 0)) { L_08BD50(x); return; }
    if (!probe(x, 0xFFE8, 0)) { L_08BB41(x); return; }
    wormTurn(x);
  };
  // L_08BCBD: at the ship — one step towards it, then 16 passes straight (L_08BCDE) and again
  var L_08BCBD = function (x) {
    K.turnTowards(x, K.directionTo(x, SHIP));
    K.speedsByDirection(x, K.r16(x+0x34));
    K.w16(x+0x32, 0x10);
    K.setState(x, 0xBCDE);
  };
  C[0x08BCDE] = function (x) {
    if (wormBody(x, true)) { return; }
    // ★ `STZ $42; STZ $42`: $44 is not cleared — the probe uses the dy the last probe of any object left
    K.w16(0x42, 0);
    if (K.terrainHit(x)) { L_08BD50(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) { L_08BCBD(x); }
  };
  // L_08BD50: the worm's death — the burst animation $9D16 in place
  var L_08BD50 = function (x) {
    K.w16(x+0x20, 0);
    K.w16(x+0x14, 0x9D16);
    K.w16(x+0x16, 0);
    K.w16(x+6, K.r16(x+6) | 0x80);
    K.sound(0x12);
    K.setState(x, 0xBD75);
  };
  C[0x08BD75] = function (x) {
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x80, 0x300)) { L_08BDA4(x); }
  };
  var L_08BDA4 = function (x) { K.setState(x, 0xBDAB); };
  C[0x08BDAB] = kill;
  // ? L_08BDAF: a bomb — with its own `$03D262` child, drifts left (speed $100), slows to $80 while it
  // touches terrain around it (S_08BF50); 40 hit points
  C[0x08BDAF] = function (x) {
    var y = K.spawn(x, 0x03D262, 16);
    if (y >= 0) { K.w16(y+0x30, 0); }
    K.slotsOf(x, 0x2B);
    K.pal(x, 0x9B);
    K.body(x, 0x28);
    K.w16(x+0x1E, K.r16(0x46));
    K.objectFromLayer(x, K.r16(0x46));
    L_08BDF8(x);
  };
  var L_08BDF8 = function (x) {
    K.w16(x+0x14, 0xC286);
    K.w16(x+0x16, 0);
    K.w16(x+0xD, 0x100);
    K.sound(0x2C);
    K.setState(x, 0xBE17);
  };
  var bombBody = function (x) {
    K.moveXBack(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x10, 0x120)) { L_08BF45(x); return true; }
    K.drawAnim(x, 2, false);
    K.touchesShip(x, 0xC236, true);
    if (K.hit(x, 0xC236) && (K.r16(x+6) & 0x80)) { L_08BEF8(x); return true; }
    return false;
  };
  C[0x08BE17] = function (x) {
    if (bombBody(x)) { return; }
    K.phaseWrap(x, 0x80, 0x200);
    if (!S_08BF50(x)) { return; }
    K.w16(x+0x14, 0xC28A);
    K.w16(x+0x16, 0);
    K.w16(x+0xD, 0x80);
    K.setState(x, 0xBE92);
  };
  C[0x08BE92] = function (x) {
    if (bombBody(x)) { return; }
    K.phaseWrap(x, 0x80, 0x400);
    if (S_08BF50(x)) { return; }
    L_08BDF8(x);
  };
  var L_08BEF8 = function (x) {
    K.w16(x+0x20, 0);
    K.w16(x+0x14, 0x9D16);
    K.w16(x+0x16, 0);
    K.w16(x+6, K.r16(x+6) | 0x80);
    K.setState(x, 0xBF16);
  };
  C[0x08BF16] = function (x) {
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x80, 0x300)) { L_08BF45(x); }
  };
  var L_08BF45 = function (x) { K.setState(x, 0xBF4C); };
  C[0x08BF4C] = kill;
  /** S_08BF50: the four corners (-8,-3), (-8,3), (8,3), (8,-3) against the terrain */
  var S_08BF50 = function (x) {
    return probe(x, 0xFFF8, 0xFFFD) || probe(x, 0xFFF8, 3) || probe(x, 8, 3) || probe(x, 8, 0xFFFD);
  };
  // ? L_08BF80: the spitter in the mouth — grows ($C25C), then runs the list $C272: a word ≥ $8000 is the
  // state of a spit (L_08C0B3…) it fires from the spawner, 0 waits a pass, anything else ends it ($C266)
  C[0x08BF80] = function (x) {
    K.slotsOf(x, 0x2B);
    K.pal(x, 0x9B);
    K.w16(x+0x14, 0xC25C);
    K.w16(x+0x16, 0);
    K.w16(x+0xB, 0);
    K.w16(x+0x10, 0);
    K.setState(x, 0xBFB0);
  };
  C[0x08BFB0] = function (x) {
    K.objectScreenParent(x);
    K.drawAnim(x, 2, false);
    if (!K.phaseEnd(x, 0x80, 0x300)) { return; }
    K.w16(x+0x14, 0xC262);
    K.w16(x+0x16, 0);
    K.w16(x+0x32, 0xC272);
    K.setState(x, 0xBFF7);
  };
  C[0x08BFF7] = function (x) {
    K.objectScreenParent(x);
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x80, 0x200);
    var w = K.d16(K.r16(x+0x32));
    if (w != 0) {
      if (!(w & 0x8000)) {
        K.w16(x+0x14, 0xC266);
        K.w16(x+0x16, 0);
        K.setState(x, 0xC079);
        return;
      }
      var y = K.spawn(0x17FB, 0x08C0B3, 16);
      if (y >= 0) {
        K.setState(y, w);   // ★ `STA $0003,Y`: the list's word is the spit's first state
        K.w16(y+0xB, K.r16(x+0x1A)+0x200);
        K.w16(y+0x10, K.r16(x+0x1C)+0x200);
      }
    }
    K.w16(x+0x32, K.r16(x+0x32)+2);
  };
  C[0x08C079] = function (x) {
    K.objectScreenParent(x);
    K.drawAnim(x, 2, false);
    if (K.phaseEnd(x, 0x80, 0x300)) { K.setState(x, 0xC0AF); }
  };
  C[0x08C0AF] = kill;
  // ? L_08C0B3 … L_08C0F2: a spit in one of five directions (the speeds at $C2E0 + the direction's offset)
  var spit = function (x, anim, dir) {
    K.w16(x+0x14, anim);
    K.w16(x+0x16, 0);
    var t = (dir+K.d16(0xC2E0+K.r16(0x88))) & 0xFFFF;
    K.w16(x+0xD, K.d16(t));
    K.w16(x+0x12, K.d16(t+2));
    K.slotsOf(x, 0x2B);
    K.pal(x, 0x9B);
    K.setState(x, 0xC132);
  };
  C[0x08C0B3] = function (x) { K.sound(0x2B); spit(x, 0xC242, 0x28); };
  C[0x08C0C8] = function (x) { spit(x, 0xC246, 0x24); };
  C[0x08C0D6] = function (x) { spit(x, 0xC24A, 0x20); };
  C[0x08C0E4] = function (x) { spit(x, 0xC24E, 0x1C); };
  C[0x08C0F2] = function (x) { spit(x, 0xC252, 0x18); };
  C[0x08C132] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (K.offRight(x, 0x10, 0x120) || K.offBottom(x, 0x10, 0xF0)) { L_08C1E2(x); return; }
    K.drawAnim(x, 2, false);
    K.touchesShip(x, 0xC26C, true);
    K.phaseWrap(x, 0x80, 0x200);
    if (!probe(x, 0, 0)) { return; }
    // ★ `TYA; STA $1E,X`: the layer the probe hit becomes the spit's layer — it splashes on it
    K.w16(x+0x1E, K.hitLayer);
    K.objectFromLayer(x, K.hitLayer);
    K.w16(x+0x14, 0xC256);
    K.w16(x+0x16, 0);
    K.setState(x, 0xC1B3);
  };
  C[0x08C1B3] = function (x) {
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, false);
    if (K.phaseEnd(x, 0x80, 0x300)) { L_08C1E2(x); }
  };
  var L_08C1E2 = function (x) { K.setState(x, 0xC1E9); };
  C[0x08C1E9] = kill;
  // L_08C1ED: the section's scroll speeds up by 2 a pass to $200, BG2 along with it
  C[0x08C1ED] = function (x) {
    var v = K.r16(0x1827)+2;
    if (v >= 0x200) {
      setScrollSpeed(0x200);   // ? $C203
      layer(0x1862).speedX = 0x200;
      K.setState(x, 0xC216);
      return;
    }
    setScrollSpeed(v);
    layer(0x1862).speedX = v;
  };
  C[0x08C216] = kill;   // ?

  // ============================================================ boss 6 ($08:C21A) — section 11
  // L_08C21A: the three-part boss of level 6 — the parts (L_08C2D6, L_08C49F, L_08C733) fly in and then
  // walk a route of stations (S_08C9C7 over the tables $C60E / $C6F1 / $C7D4 chosen by +$30 = a draw of
  // the sequence); $8E bits 0-2 = a part is at its station (or dead), bit 3 = the boss's "go on" to all
  C[0x08C21A] = function (x) {
    K.w16(0x8E, 7);
    K.w16(x+0x30, K.sequenceNext() & 6);
    var y = K.spawn(x, 0x08C2D6, 0);
    if (y >= 0) { K.w16(y+0x30, K.r16(x+0x30)); }
    y = K.spawn(x, 0x08C49F, 0);
    if (y >= 0) { K.w16(y+0x30, K.r16(x+0x30)); }
    y = K.spawn(x, 0x08C733, 0);
    if (y >= 0) { K.w16(y+0x30, K.r16(x+0x30)); }
    L_08C262(x);
  };
  var L_08C262 = function (x) { K.setState(x, 0xC26B); };
  C[0x08C26B] = function (x) {
    if ((K.r16(0x8E) & 7) != 7) { return; }
    K.setState(x, 0xC27F);
  };
  // ? L_08C27F: all three in place — bit 3 for a pass; if they still hold their bits they are dead: the end
  C[0x08C27F] = function (x) {
    K.w16(0x8E, K.r16(0x8E) | 8);
    K.setState(x, 0xC28E);
  };
  C[0x08C28E] = function (x) {
    if ((K.r16(0x8E) & 7) != 7) {
      K.w16(0x8E, K.r16(0x8E) & 0xFFF7);
      L_08C262(x);
      return;
    }
    K.w16(0x4A, K.r16(0x4A) | 0x20);
    K.setState(x, 0xC2AF);
  };
  C[0x08C2AF] = function (x) {
    if (!K.childrenDone(x)) { return; }
    K.w16(0x4A, K.r16(0x4A) | 0x10);
    K.setState(x, 0xC2D2);
  };
  C[0x08C2D2] = kill;

  /** the parts' shared init: sprite set $29, palettes $BD/$80, hit points $C81E, the start and the speed $C80A on both axes */
  var partInit = function (x, bit, bx, by) {
    K.w16(0x8E, K.r16(0x8E) & ~bit);
    K.slotsOf(x, 0x29);
    K.pal(x, 0xBD);
    K.pal2(x, 0x80);
    K.body(x, K.d16(0xC81E+K.r16(0x88)));
    K.w16(x+0xB, bx);
    K.w16(x+0x10, by);
    var sp = K.d16(0xC80A+K.r16(0x88));
    K.w16(x+0xD, sp);
    K.w16(x+0x12, sp);
    K.w16(x+0x32, 0);
  };
  /** a part's pass: the sprite, the ship, the shots (bit 7 = killed), the second box for the ship's shots */
  var partBody = function (x, meta, box, hitBox) {
    K.objectScreen(x);
    K.addSprite(x, meta, 2, true);
    K.touchesShip(x, box, true);
    var dead = K.hitBlink(x, 0x0700, hitBox);
    if (!dead) { K.hitTest(x, 0x0704, box); }
    return dead;
  };
  /** `S_08C9C7`: the next station of the route +$36 (restarted at +$34 at an odd byte) — the target x/y
   *  from the table $C7DC by the byte's nibbles, +$32 bits 0/1 = move right / down */
  var S_08C9C7 = function (x) {
    K.w16(x+0x36, K.r16(x+0x34));
    S_08C9CD(x);
  };
  var S_08C9CD = function (x) {
    var f = K.r16(x+0x32) & 0xFFF0;
    K.w16(0x00, f);
    var a;
    for (;;) {
      a = K.d16(K.r16(x+0x36));
      if (!(a & 1)) { break; }
      K.w16(x+0x36, K.r16(x+0x34));
    }
    K.w16(0x02, a);
    var tx = K.d16(0xC7DC+(a & 0xE));
    K.w16(x+0x38, tx);
    if (tx >= K.r16(x+0xB)) { f |= 1; K.w16(0x00, f); }
    var ty = K.d16(0xC7DC+((a >> 3) & 0xE));
    K.w16(x+0x3A, ty);
    if (ty >= K.r16(x+0x10)) { f |= 2; K.w16(0x00, f); }
    K.w16(x+0x36, K.r16(x+0x36)+1);
    K.w16(x+0x32, f);
  };
  /** `S_08CA1A`: a step towards the station on each axis not yet reached (+$32 bits 2/3 = reached) */
  var S_08CA1A = function (x) {
    var f = K.r16(x+0x32);
    K.w16(0x00, f);
    if (!(f & 4)) {
      if (f & 1) {
        K.moveX(x);
        if (K.r16(x+0x38) < K.r16(x+0xB)) { K.w16(x+0xB, K.r16(x+0x38)); f |= 4; K.w16(0x00, f); }
      } else {
        K.moveXBack(x);
        if (K.r16(x+0x38) >= K.r16(x+0xB)) { K.w16(x+0xB, K.r16(x+0x38)); f |= 4; K.w16(0x00, f); }
      }
    }
    if (!(f & 8)) {
      if (f & 2) {
        K.moveY(x);
        if (K.r16(x+0x3A) < K.r16(x+0x10)) { K.w16(x+0x10, K.r16(x+0x3A)); K.w16(x+0x32, f | 8); return; }
      } else {
        K.moveYBack(x);
        if (K.r16(x+0x3A) >= K.r16(x+0x10)) { K.w16(x+0x10, K.r16(x+0x3A)); K.w16(x+0x32, f | 8); return; }
      }
    }
    K.w16(x+0x32, f);
  };
  /** `L_08C47C` and its twins: a part's death — 50 points, its bit stays, the burst, the sound */
  var partDeath = function (x, bit, state) {
    K.scoreAdd(0x50);
    K.w16(0x8E, K.r16(0x8E) | bit);
    K.explode(x, EXPLODE_SMALL, false);
    K.sound(0x15);
    K.setState(x, state);
  };

  // L_08C2D6: part A, the top one with two guns (L_08CA82 / L_08CAB6) and two pairs of spikes
  C[0x08C2D6] = function (x) {
    partInit(x, 4, 0x1C0, 0x240);
    K.spawn(x, 0x08CA82, 8);
    K.spawn(x, 0x08CAB6, 8);
    K.spawn(x, 0x08CBDA, 8);
    K.spawn(x, 0x08CD39, 8);
    K.setState(x, 0xC35F);
  };
  C[0x08C35F] = function (x) {
    K.moveX(x);
    if (partBody(x, 0xC312, 0xC521, 0xC50F)) { L_08C47C(x); return; }
    if (K.r16(x+0xB) < 0x2C0) { return; }
    // ? L_08C3AF: on the screen — the route
    K.w16(x+0x34, K.d16(0xC60E+K.r16(x+0x30)));
    S_08C9C7(x);
    L_08C3BB(x);
  };
  var L_08C3BB = function (x) { K.setState(x, 0xC3C4); };
  C[0x08C3C4] = function (x) {   // ? on the way to the station
    S_08CA1A(x);
    if (partBody(x, 0xC312, 0xC521, 0xC50F)) { L_08C47C(x); return; }
    if ((K.r16(x+0x32) & 0xC) != 0xC) { return; }
    K.w16(0x8E, K.r16(0x8E) | 4);
    K.setState(x, 0xC425);
  };
  C[0x08C425] = function (x) {   // ? at the station — until the boss's bit 3
    if (partBody(x, 0xC312, 0xC521, 0xC50F)) { L_08C47C(x); return; }
    if (!(K.r16(0x8E) & 8)) { return; }
    K.w16(0x8E, K.r16(0x8E) & 0xFFFB);
    S_08C9CD(x);
    L_08C3BB(x);
  };
  var L_08C47C = function (x) { partDeath(x, 4, 0xC49B); };   // ?
  C[0x08C49B] = kill;

  // L_08C49F: part B (bit 0) with spikes; at a station it drops a bomb (? L_08D07D) or, low on the
  // screen, lays mines (? L_08D125); L_08C733: part C (bit 1), the same with the mines to the right
  var PART_B = {bit: 1, meta: 0xC368, box: 0xC527, hitBox: 0xC515, route: 0xC6F1, mineDx: -8,
                go: 0xC578, walk: 0xC581, drop: 0xC61B, wait: 0xC6B9, death: 0xC710, dead: 0xC72F};
  var PART_C = {bit: 2, meta: 0xC337, box: 0xC52D, hitBox: 0xC51B, route: 0xC7D4, mineDx: 8,
                go: 0xC80C, walk: 0xC815, drop: 0xC8AF, wait: 0xC94D, death: 0xC9A4, dead: 0xC9C3};
  C[0x08C49F] = function (x) {
    partInit(x, 1, 0x1A0, 0x260);
    K.spawn(x, 0x08CBEB, 16);
    K.spawn(x, 0x08CBFC, 16);
    K.setState(x, 0xC516);
  };
  C[0x08C733] = function (x) {
    partInit(x, 2, 0x1E0, 0x260);
    K.spawn(x, 0x08CD4A, 16);
    K.spawn(x, 0x08CD5B, 16);
    K.setState(x, 0xC7AA);
  };
  // L_08C516 / L_08C7AA: flying in
  var partEnter = function (x, p, limit) {
    K.moveX(x);
    if (partBody(x, p.meta, p.box, p.hitBox)) { partDeath(x, p.bit, p.dead); return; }
    if (K.r16(x+0xB) < limit) { return; }
    // ? L_08C566 / L_08C7FA
    K.w16(x+0x34, K.d16(p.route+K.r16(x+0x30)));
    S_08C9C7(x);
    K.w16(x+0x3C, 0x3C);
    K.setState(x, p.walk);
  };
  // ? L_08C581 / L_08C815: towards the station; there, after the rest +$3C, the bomb or the mines
  var partWalk = function (x, p) {
    S_08CA1A(x);
    if (partBody(x, p.meta, p.box, p.hitBox)) { partDeath(x, p.bit, p.dead); return; }
    if (K.r16(x+0x3C) != 0) { K.w16(x+0x3C, K.r16(x+0x3C)-1); }
    if ((K.r16(x+0x32) & 0xC) != 0xC) { return; }
    if (K.r16(x+0x3C) != 0) { partArmed(x, p); return; }
    if (K.r16(x+0x10) < 0x280) {
      // a bomb (L_08D07D) that falls up to the part's y; +$32 bit 15 = it is gone
      K.w16(x+0x32, K.r16(x+0x32) & 0x7FFF);
      var y = K.spawn(x, 0x08D07D, 16);
      if (y < 0) { partRest(x, p); return; }
      K.w16(y+0x32, K.r16(x+0xB));
      K.w16(y+0x34, K.r16(x+0x10));
      K.setState(x, p.drop);
      return;
    }
    // $C667 / $C8FB: (the draw & 3) + $C828[$86] mines
    var n = ((K.sequenceNext() & 3)+(K.d16(0xC828+K.r16(0x86)) & 0xFF)) & 0xFFFF;
    K.w16(0x0A, n);
    for (;;) {
      var m = K.spawn(x, 0x08D125, 16);
      if (m < 0) { break; }
      K.w16(m+0xB, K.r16(x+0xB)+p.mineDx);
      K.w16(m+0x10, K.r16(x+0x10)-0x18);
      K.w16(0x0A, K.r16(0x0A)-1);
      if (K.r16(0x0A) == 0) { break; }
    }
    partRest(x, p);
  };
  var partRest = function (x, p) {
    K.w16(x+0x3C, 0xF0);
    partArmed(x, p);
  };
  var partArmed = function (x, p) {
    K.w16(0x8E, K.r16(0x8E) | p.bit);
    K.setState(x, p.wait);
  };
  // ? L_08C61B / L_08C8AF: the bomb is falling
  var partDrop = function (x, p) {
    if (partBody(x, p.meta, p.box, p.hitBox)) { partDeath(x, p.bit, p.dead); return; }
    if (K.r16(x+0x32) & 0x8000) { partRest(x, p); }
  };
  // ? L_08C6B9 / L_08C94D: at the station — until the boss's bit 3
  var partWait = function (x, p) {
    if (partBody(x, p.meta, p.box, p.hitBox)) { partDeath(x, p.bit, p.dead); return; }
    if (!(K.r16(0x8E) & 8)) { return; }
    K.w16(0x8E, K.r16(0x8E) & ~p.bit);
    S_08C9CD(x);
    K.w16(x+0x3C, 0x3C);
    K.setState(x, p.walk);
  };
  C[0x08C516] = function (x) { partEnter(x, PART_B, 0x2A0); };
  C[0x08C581] = function (x) { partWalk(x, PART_B); };
  C[0x08C61B] = function (x) { partDrop(x, PART_B); };
  C[0x08C6B9] = function (x) { partWait(x, PART_B); };
  C[0x08C72F] = kill;
  C[0x08C7AA] = function (x) { partEnter(x, PART_C, 0x2E0); };
  C[0x08C815] = function (x) { partWalk(x, PART_C); };
  C[0x08C8AF] = function (x) { partDrop(x, PART_C); };
  C[0x08C94D] = function (x) { partWait(x, PART_C); };
  C[0x08C9C3] = kill;

  // L_08CA82 / L_08CAB6: the guns of part A — every $89A9/$89B3 passes a shot ($03D2BF) in the direction
  // the table +$36 ($C4B1 / $C4C1) gives for the direction to the ship, the shot's kind +$38
  C[0x08CA82] = function (x) {
    K.w16(x+0x14, 0xC471);
    K.w16(x+0xB, 0xFFE8);
    K.w16(x+0x10, 0xFFE8);
    K.w16(x+0x16, 0x800);
    K.w16(x+0x36, 0xC4B1);
    K.w16(x+0x34, K.d16(0x89F9+K.r16(0x88)));
    K.w16(x+0x32, K.d16(0x89A9+K.r16(0x88)));
    K.w16(x+0x38, 0x100);
    L_08CAE8(x);
  };
  C[0x08CAB6] = function (x) {
    K.w16(x+0x14, 0xC491);
    K.w16(x+0xB, 0x18);
    K.w16(x+0x10, 0xFFE8);
    K.w16(x+0x16, 0);
    K.w16(x+0x36, 0xC4C1);
    K.w16(x+0x34, K.d16(0x8A03+K.r16(0x88)));
    K.w16(x+0x32, K.d16(0x89B3+K.r16(0x88)));
    K.w16(x+0x38, 0x200);
    L_08CAE8(x);
  };
  /** the init the guns and spikes share: sprite set $29, palettes $BD/$80, hit points $C814 */
  var L_08CAE8 = function (x) {
    K.slotsOf(x, 0x29);
    K.pal(x, 0xBD);
    K.pal2(x, 0x80);
    K.body(x, K.d16(0xC814+K.r16(0x88)));
    K.setState(x, 0xCB2B);
  };
  C[0x08CB2B] = function (x) {
    K.objectScreenParent(x);
    K.drawAnim(x, 2, true);
    if (K.hitBlink(x, 0x0700, 0xC509)) { L_08CBC4(x); return; }   // ? $CB56
    // L_08CB6C
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    K.w16(x+0x32, K.r16(x+0x34));
    var y = K.spawn(0x17FB, 0x03D2BF, 16);
    if (y < 0) { return; }
    var d = K.d8(K.r16(x+0x36)+K.directionTo(x, SHIP));
    K.w8(x+0x17, d);
    K.w16(y+0x32, d & 0xF);
    K.w16(y+0x30, K.r16(x+0x38));
    K.w16(y+0xB, K.r16(x+0x1A)+0x200);
    K.w16(y+0x10, K.r16(x+0x1C)+0x200);
  };
  var L_08CBC4 = function (x) {   // ? the gun's death
    K.explode(x, EXPLODE_AT, false);
    K.sound(0x17);
    K.setState(x, 0xCBD6);
  };
  C[0x08CBD6] = kill;

  // L_08CBDA / L_08CBEB / L_08CBFC: the spikes on the parts' left; they fire a shot to the left (L_08CF0D)
  // with a flash (L_08CE99) when the ship is left of them and within 16 above / below
  var spikeInit = function (x, bx, by, meta, state) {
    K.w16(x+0xB, bx);
    K.w16(x+0x10, by);
    K.w16(x+0x14, meta);
    K.slotsOf(x, 0x29);
    K.pal(x, 0xBD);
    K.pal2(x, 0x80);
    K.body(x, K.d16(0xC814+K.r16(0x88)));
    K.setState(x, state);
  };
  C[0x08CBDA] = function (x) { spikeInit(x, 0xFFE8, 0xFFF8, 0xC3F8, 0xCC51); };
  C[0x08CBEB] = function (x) { spikeInit(x, 0xFFE8, 0xFFF8, 0xC3F8, 0xCC51); };
  C[0x08CBFC] = function (x) { spikeInit(x, 0xFFE8, 0x0008, 0xC402, 0xCC51); };
  /** a spike's pass: the sprite (+$14 is the metasprite itself), the hit; true when it died */
  var spikeBody = function (x) {
    K.objectScreenParent(x);
    K.addSprite(x, K.r16(x+0x14), 2, true);
    return K.hitBlink(x, 0x0700, 0xC509);
  };
  /** `LDA $1C,X; CLC; ADC #$10; CMP $15A5; BCC no; SEC; SBC #$20; CMP $15A5; BCC fire`: the ship within 16 of the spike's y */
  var spikeAimed = function (x) {
    var v = (K.r16(x+0x1C)+0x10) & 0xFFFF;
    if (v < shipY()) { return false; }
    return ((v-0x20) & 0xFFFF) < shipY();
  };
  var L_08CC48 = function (x) { K.setState(x, 0xCC51); };
  C[0x08CC51] = function (x) {
    if (spikeBody(x)) { L_08CD23(x); return; }   // ? $CC6D
    if (K.r16(x+0x1A) < shipX()) { return; }
    if (!spikeAimed(x)) { return; }
    // L_08CCA1
    var y = K.spawn(0x17FB, 0x08CF0D, 16);
    if (y >= 0) {
      // ★ `CLC; ADC #$0200; ADC #$0010`: the second add takes the first's carry
      var v = K.r16(x+0x1A)+0x200;
      K.w16(y+0xB, (v & 0xFFFF)+0x10+(v >> 16));
      K.w16(y+0x10, K.r16(x+0x1C)+0x200);
    }
    K.spawn(x, 0x08CE99, 16);
    K.w16(x+0x32, 0x3C);
    K.setState(x, 0xCCE8);
  };
  C[0x08CCE8] = function (x) {
    if (spikeBody(x)) { L_08CD23(x); return; }   // ? $CD04
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) { L_08CC48(x); }
  };
  var L_08CD23 = function (x) {   // ? a spike's death
    S_03CDF0(x);
    K.sound(0x16);
    K.setState(x, 0xCD35);
  };
  C[0x08CD35] = kill;
  // L_08CD39 / L_08CD4A / L_08CD5B: the spikes on the right, firing right (L_08CFFF, flash L_08CF8B)
  C[0x08CD39] = function (x) { spikeInit(x, 0x18, 0xFFF8, 0xC3F3, 0xCDB0); };
  C[0x08CD4A] = function (x) { spikeInit(x, 0x18, 0xFFF8, 0xC3F3, 0xCDB0); };
  C[0x08CD5B] = function (x) { spikeInit(x, 0x18, 0x0008, 0xC3FD, 0xCDB0); };
  var L_08CDA7 = function (x) { K.setState(x, 0xCDB0); };
  C[0x08CDB0] = function (x) {
    if (spikeBody(x)) { L_08CE83(x); return; }   // ? $CDCC
    if (K.r16(x+0x1A) >= shipX()) { return; }
    if (!spikeAimed(x)) { return; }
    // L_08CE00
    var y = K.spawn(0x17FB, 0x08CFFF, 16);
    if (y >= 0) {
      K.w16(y+0xB, K.r16(x+0x1A)+0x200-0x10);
      K.w16(y+0x10, K.r16(x+0x1C)+0x200);
    }
    K.spawn(x, 0x08CF8B, 16);
    K.w16(x+0x32, 0x3C);
    K.setState(x, 0xCE48);
  };
  C[0x08CE48] = function (x) {
    if (spikeBody(x)) { L_08CE83(x); return; }   // ? $CE64
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) { L_08CDA7(x); }
  };
  var L_08CE83 = function (x) {   // ?
    S_03CDF0(x);
    K.sound(0x16);
    K.setState(x, 0xCE95);
  };
  C[0x08CE95] = kill;
  // L_08CE99 / L_08CF8B: the muzzle flash on the spike
  var flash = function (x, bx, anim, state) {
    K.w16(x+0xB, bx);
    K.w16(x+0x10, 0);
    K.slotsOf(x, 0x29);
    K.pal(x, 0x80);
    K.w16(x+0x14, anim);
    K.w16(x+0x16, 0);
    K.sound(0x2F);
    K.setState(x, state);
  };
  var flashPass = function (x, next) {
    K.objectScreenParent(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x80, 0x800)) { K.setState(x, next); }
  };
  C[0x08CE99] = function (x) { flash(x, 0xFFF8, 0xC4E1, 0xCED3); };
  C[0x08CED3] = function (x) { flashPass(x, 0xCF09); };
  C[0x08CF09] = kill;
  C[0x08CF8B] = function (x) { flash(x, 0x0008, 0xC4D1, 0xCFC5); };
  C[0x08CFC5] = function (x) { flashPass(x, 0xCFFB); };
  C[0x08CFFB] = kill;
  // L_08CF0D / L_08CFFF: the spikes' shots, left and right at $200 a pass, off at x $1F0 / $310
  var spikeShot = function (x, anim, state) {
    K.slotsOf(x, 0x29);
    K.pal(x, 0x80);
    K.w16(x+0x14, anim);
    K.w16(x+0x16, 0);
    K.w16(x+0xD, 0x200);
    K.setState(x, state);
  };
  var spikeShotPass = function (x) {
    K.objectScreen(x);
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x80, 0x300);   // ? $CF6F
    K.touchesShip(x, 0xC503, true);
  };
  C[0x08CF0D] = function (x) { spikeShot(x, 0xC4F7, 0xCF3D); };
  C[0x08CF3D] = function (x) {
    K.moveXBack(x);
    if (K.r16(x+0xB) < 0x1F0) { K.setState(x, 0xCF87); return; }
    spikeShotPass(x);
  };
  C[0x08CF87] = kill;
  C[0x08CFFF] = function (x) { spikeShot(x, 0xC4F1, 0xD02F); };
  C[0x08D02F] = function (x) {
    K.moveX(x);
    if (K.r16(x+0xB) >= 0x310) { K.setState(x, 0xD079); return; }
    spikeShotPass(x);
  };
  C[0x08D079] = kill;
  // ? L_08D07D: the bomb of parts B / C — rises from the bottom ($2E0) at $2AA a pass to the part's y (+$34)
  // at its x (+$32); one hit kills it; gone, it raises bit 15 of the part's +$32
  C[0x08D07D] = function (x) {
    K.slotsOf(x, 0x29);
    K.pal(x, 0x8E);
    K.body(x, 1);
    K.w16(x+0x14, K.d16(0xC461+((K.sequenceNext() & 7) << 1)));
    K.w16(x+0x12, 0x2AA);
    K.w16(x+0xB, K.r16(x+0x32));
    K.w16(x+0x10, 0x2E0);
    K.sound(0x2E);
    K.setState(x, 0xD0D8);
  };
  C[0x08D0D8] = function (x) {
    K.moveYBack(x);
    K.objectScreen(x);
    K.addSprite(x, K.r16(x+0x14), 2, false);
    K.touchesShip(x, 0xC4FD, true);
    if (K.hit(x, 0xC4FD)) {
      K.explode(x, EXPLODE_AT, false);
      K.sound(0x12);
    } else if (K.r16(x+0x10) >= K.r16(x+0x34)) {
      return;
    }
    // $D10E
    var p = K.r16(x+8);
    K.w16(p+0x32, K.r16(p+0x32) | 0x8000);
    K.setState(x, 0xD121);
  };
  C[0x08D121] = kill;
  // ? L_08D125: a mine — thrown with the speeds $C7EA / $C7FA of a draw, falling faster by $10 a pass
  C[0x08D125] = function (x) {
    K.slotsOf(x, 0x29);
    K.pal(x, 0x8E);
    K.body(x, 1);
    K.sound(0x30);
    var i = (K.sequenceNext() & 7) << 1;
    K.w16(x+0x14, K.d16(0xC461+i));
    K.w16(x+0xD, K.d16(0xC7EA+i));
    K.w16(x+0x12, K.d16(0xC7FA+i));
    K.setState(x, 0xD17A);
  };
  C[0x08D17A] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.w16(x+0x12, K.r16(x+0x12)+0x10);
    K.objectScreen(x);
    if (K.offBottom(x, 0x10, 0xF0)) { L_08D1C5(x); return; }
    K.addSprite(x, K.r16(x+0x14), 2, false);
    K.touchesShip(x, 0xC4FD, true);
    if (!K.hit(x, 0xC4FD)) { return; }
    K.explode(x, EXPLODE_AT, false);
    K.sound(0x12);
    L_08D1C5(x);
  };
  var L_08D1C5 = function (x) { K.setState(x, 0xD1CC); };
  C[0x08D1CC] = kill;


  // ============================================================ boss 7 — section 13
  // The last boss is a fortress built of map blocks: the wave list spawns two pods (L_08D1D0 / L_08D1F2,
  // $8E bits 1 / 2 when destroyed), four block guns (L_08D49A) and the controller (L_08D55B) whose children
  // rewrite the map (L_08D2C8 / L_08D3BD), launch homing shots (L_08D65B) and shells (L_08D7FB). $8E bit 15
  // = the fortress is beaten, bit 11 = the shots speed up, bit 0 = the second wall's turn.
  /** `S_03CEB3`: the object `$03CEDA` (a child, 8 free nodes) with +$30 = `rec`, the object's layer and position */
  var S_03CEB3 = function (x, rec) {
    var y = K.spawn(x, 0x03CEDA, 8);
    if (y < 0) { return; }
    K.w16(y+0x30, rec);
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
  };
  /** `S_03D009`: the object `$03D022` (a child, 8 free nodes) with +$30 = `rec` and +$34 = the caller's node */
  var S_03D009 = function (x, rec) {
    var y = K.spawn(x, 0x03D022, 8);
    if (y < 0) { return; }
    K.w16(y+0x30, rec);
    K.w16(y+0x34, x);
  };
  /** `S_01C01E`: the object `$01C047` as a child of the ship at the object's screen position + ($1E0, $208) */
  var S_01C01E = function (x) {
    var y = K.spawn(SHIP, 0x01C047, 8);
    if (y < 0) { return; }
    K.w16(y+0xB, K.r16(x+0x1A)+0x1E0);
    K.w16(y+0x10, K.r16(x+0x1C)+0x208);
  };

  // L_08D1D0 / L_08D1F2: the pods — animated at the speed +$34, their $8E bit in +$32
  C[0x08D1D0] = function (x) {
    K.w16(x+0x32, 2);
    K.w16(x+0x34, 0x20);
    K.body(x, K.d16(0xCE29+K.r16(0x88)));
    L_08D212(x);
  };
  C[0x08D1F2] = function (x) {
    K.w16(x+0x32, 4);
    K.w16(x+0x34, 0x10);
    K.body(x, K.d16(0xCE33+K.r16(0x88)));
    L_08D212(x);
  };
  var L_08D212 = function (x) {
    K.slotsOf(x, 0x23);
    K.pal(x, 0xBC);
    K.pal2(x, 0x80);
    K.w16(x+0x14, 0xCCA7);
    K.w16(x+0x16, 0);
    K.setState(x, 0xD24A);
  };
  C[0x08D24A] = function (x) {
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, true);
    K.touchesShip(x, 0xCCB7, true);
    if (K.hitBlink(x, 0x0700, 0xCCB7)) { L_08D2AC(x); return; }   // ? $D27C
    if (K.r16(0x8E) & 0x8000) { L_08D2AC(x); return; }
    var v = (K.r16(x+0x16)+K.r16(x+0x34)) & 0xFFFF;
    if (v >= 0x800) { v &= 0xFF; }
    K.w16(x+0x16, v);
  };
  // ? L_08D2AC: a pod's death — 100 points, the burst on the layer, its bit into $8E
  var L_08D2AC = function (x) {
    K.scoreAdd(0x100);
    K.explode(x, EXPLODE, true);
    K.w16(0x8E, K.r16(0x8E) | K.r16(x+0x32));
    K.setState(x, 0xD2C4);
  };
  C[0x08D2C4] = kill;   // ?

  /** `LDA $8E; BIT #$8000; BNE gone`: the fortress is beaten — the child leaves */
  var beaten = function () { return (K.r16(0x8E) & 0x8000) != 0; };
  /** one block record of a wall list every 16 passes: `rec = tbl[+$16]` into BG1, +$16 up to 4; true at the last */
  var wallStep = function (x, tbl) {
    K.w16(x+0x32, 0x10);
    K.mapEnqueueRecord(K.d16(tbl+K.r16(x+0x16)), 0x1832, false);
    if (K.r16(x+0x16) == 4) { return true; }
    K.w16(x+0x16, K.r16(x+0x16)+2);
    return false;
  };
  /** `STZ $16,X; LDA #1; STA $32,X; LDA #$33; JSL sound_queue`: a wall starts to build */
  var wallStart = function (x, state) {
    K.w16(x+0x16, 0);
    K.w16(x+0x32, 1);
    K.sound(0x33);
    K.setState(x, state);
  };
  // L_08D2C8: the first wall builder — $F0 passes, three blocks of $CBFF, $2A passes, three of $CC05,
  // and (every other time) the second builder's turn ($8E bit 0)
  C[0x08D2C8] = function (x) {
    K.w16(x+0x34, 0);
    L_08D2CB(x);
  };
  var L_08D2CB = function (x) {
    K.w16(x+0x32, 0xF0);
    K.setState(x, 0xD2DA);
  };
  C[0x08D2DA] = function (x) {
    if (beaten()) { L_08D3B2(x); return; }   // ? $D2E1
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    wallStart(x, 0xD303);
  };
  C[0x08D303] = function (x) {
    if (beaten()) { L_08D3B2(x); return; }   // ? $D30A
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    if (!wallStep(x, 0xCBFF)) { return; }
    // L_08D333
    K.w16(x+0x32, 0x2A);
    K.setState(x, 0xD342);
  };
  C[0x08D342] = function (x) {
    if (beaten()) { L_08D3B2(x); return; }   // ? $D349
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    wallStart(x, 0xD36B);   // ? L_08D352
  };
  C[0x08D36B] = function (x) {   // ?
    if (beaten()) { L_08D3B2(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    if (!wallStep(x, 0xCC05)) { return; }
    // $D39B: every second round the other builder's turn
    K.w16(x+0x34, K.r16(x+0x34) ^ 1);
    if (!(K.r16(x+0x34) & 1)) { K.w16(0x8E, K.r16(0x8E) | 1); }
    L_08D2CB(x);
  };
  var L_08D3B2 = function (x) { K.setState(x, 0xD3B9); };   // ?
  C[0x08D3B9] = kill;
  // L_08D3BD: the second wall builder — waits for $8E bit 0, then $CC3F, $5A passes, $CC45
  C[0x08D3BD] = function (x) { K.setState(x, 0xD3C6); };
  C[0x08D3C6] = function (x) {
    if (beaten()) { L_08D48F(x); return; }   // ? $D3CD
    if (!(K.r16(0x8E) & 1)) { return; }
    K.w16(0x8E, K.r16(0x8E) & 0xFFFE);   // ? $D3D6
    wallStart(x, 0xD3F4);
  };
  C[0x08D3F4] = function (x) {   // ?
    if (beaten()) { L_08D48F(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    if (!wallStep(x, 0xCC3F)) { return; }
    K.w16(x+0x32, 0x5A);
    K.setState(x, 0xD433);
  };
  C[0x08D433] = function (x) {   // ?
    if (beaten()) { L_08D48F(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    wallStart(x, 0xD45C);
  };
  C[0x08D45C] = function (x) {   // ?
    if (beaten()) { L_08D48F(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    if (wallStep(x, 0xCC45)) { K.setState(x, 0xD3C6); }
  };
  var L_08D48F = function (x) { K.setState(x, 0xD496); };   // ?
  C[0x08D496] = kill;
  // L_08D49A: a block gun — 40 hit points, no sprite (it is map blocks: +$14 = the table $CC7F[+$30] of
  // four records cycled every $CC87[draw] passes); destroyed, its last record and the remains ($CC95)
  C[0x08D49A] = function (x) {
    K.body(x, 0x28);
    K.w16(x+0x14, K.d16(0xCC7F+K.r16(x+0x30)));
    K.w16(x+0x32, 0x3C);
    K.w16(x+0x16, 0);
    K.setState(x, 0xD4C7);
  };
  C[0x08D4C7] = function (x) {
    K.objectScreenLayer(x);
    K.hitTest(x, 0x0700, 0xCC8F);
    if (beaten()) { L_08D518(x); return; }   // ? $D4DC
    if (K.r16(x+6) & 0x80) { L_08D518(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    K.w16(x+0x32, K.d16(0xCC87+(K.sequenceNext() & 6)));
    K.mapEnqueueRecord(K.d16(K.r16(x+0x14)+K.r16(x+0x16)), 0x1832, false);
    K.w16(x+0x16, (K.r16(x+0x16)+2) & 6);
  };
  var L_08D518 = function (x) {   // ?
    K.mapEnqueueRecord(K.d16(K.r16(x+0x14)+8), 0x1832, false);
    S_03CEB3(x, 0xCC95);
    S_01C01E(x);
    K.setState(x, 0xD53A);
  };
  C[0x08D53A] = function (x) {   // ?
    if (!K.childrenDone(x)) { return; }
    K.setState(x, 0xD557);
  };
  C[0x08D557] = kill;
  // L_08D55B: the controller — its children, then $1518 passes or both pods ($8E bits 1-2) end the fortress
  C[0x08D55B] = function (x) {
    K.w16(x+0x32, 0x1518);
    K.spawn(x, 0x08D65B, 8);
    K.spawn(x, 0x08D7FB, 8);
    K.spawn(x, 0x08D2C8, 8);
    K.spawn(x, 0x08D3BD, 8);
    K.spawn(x, 0x02DF65, 8);
    K.setState(x, 0xD599);
  };
  C[0x08D599] = function (x) {
    if ((K.r16(0x8E) & 6) != 6) {
      K.w16(x+0x32, K.r16(x+0x32)-1);
      if (K.r16(x+0x32) != 0) {
        if (K.r16(x+0x32) == 0x4B0) { K.w16(0x8E, K.r16(0x8E) | 0x800); }   // ? $D5B0
        return;
      }
    }
    // ? L_08D5B7: beaten — bit 15, the section's end, the finale object ($CDE0), the music off
    K.w16(0x8E, K.r16(0x8E) | 0x8000);
    K.w16(0x4A, K.r16(0x4A) | 0x20);
    S_03D009(x, 0xCDE0);
    K.sound(0xFF);
    K.sound(0x24);
    K.w16(x+0x16, 0);
    K.setState(x, 0xD5E4);
  };
  C[0x08D5E4] = function (x) {   // ? three records of $CCBD into BG1
    K.objectScreenLayer(x);
    K.mapEnqueueRecord(K.d16(0xCCBD+K.r16(x+0x16)), 0x1832, false);
    K.w16(x+0x16, K.r16(x+0x16)+2);
    if (K.r16(x+0x16) == 6) { K.setState(x, 0xD60C); }
  };
  C[0x08D60C] = function (x) {   // ? two more into BG2
    K.objectScreenLayer(x);
    K.mapEnqueueRecord(K.d16(0xCCBD+K.r16(x+0x16)), 0x1862, false);
    K.w16(x+0x16, K.r16(x+0x16)+2);
    if (K.r16(x+0x16) == 0xA) { K.setState(x, 0xD634); }
  };
  C[0x08D634] = function (x) {   // ?
    if (!K.childrenDone(x)) { return; }
    K.w16(0x4A, K.r16(0x4A) | 0x10);
    K.setState(x, 0xD657);
  };
  C[0x08D657] = kill;
  // L_02DF65 (bank $02, spawned only by the controller $08:D587): eight wall turrets (`$02E05C`, the
  // level-7 wall turret of `app/enemies4.js`) on BG1 at the places of $E95D / $E96D with the kinds of
  // $E97D; stays until the fortress is beaten. (Carried over here because nothing else spawns it.)
  C[0x02DF65] = function (x) {
    K.w16(0x00, 0xE);
    for (;;) {
      var y = K.spawn(x, 0x02E05C, 8);
      // (no carry test — the original writes through Y whatever the spawn gave)
      if (y >= 0) {
        K.w16(y+0x1E, 0x1832);
        var i = K.r16(0x00);
        K.w16(0x02, K.d16(0xE95D+i));
        K.w16(0x04, K.d16(0xE96D+i));
        K.w16(y+0x30, K.d16(0xE97D+i));
        K.w16(y+0xB, K.r16(0x02));
        K.w16(y+0x10, K.r16(0x04));
      }
      if (K.r16(0x00) == 0) { break; }
      K.w16(0x00, K.r16(0x00)-2);
    }
    K.setState(x, 0xDFAE);
  };
  C[0x02DFAE] = function (x) {
    if (!beaten()) { return; }
    K.setState(x, 0xDFBD);   // ?
  };
  C[0x02DFBD] = kill;   // ?
  // L_08D65B: every $CE51 passes a homing shot (? L_08D6BC) from the right edge at one of two heights
  C[0x08D65B] = function (x) {
    var n = K.d16(0xCE51+K.r16(0x88));
    K.w16(x+0x34, n);
    K.w16(x+0x32, n);
    K.setState(x, 0xD66F);
  };
  C[0x08D66F] = function (x) {
    if (beaten()) { K.setState(x, 0xD6B8); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    // ? $D67B
    K.w16(x+0x32, K.r16(x+0x34));
    var y = K.spawn(x, 0x08D6BC, 16);
    if (y < 0) { return; }
    K.w16(y+0xB, 0x2A8);
    K.w16(y+0x10, (K.sequenceNext() & 1) ? 0x28C : 0x240);
    K.w16(y+0x16, 0x800);
  };
  C[0x08D6B8] = kill;   // ?
  // ? L_08D6BC: the homing shot — turns a step towards the ship every +$36 passes (16, or 1 once $8E bit 11 is up)
  C[0x08D6BC] = function (x) {
    K.slotsOf(x, 0x22);
    K.pal(x, 0xB6);
    K.body(x, 0xA);
    K.w16(x+0x34, K.d16(0xCE5B+K.r16(0x88)));
    K.w16(x+0x36, 0x10);
    K.w16(x+0x16, 0x800);
    K.sound(0x36);
    L_08D701(x);
  };
  var L_08D701 = function (x) {
    K.turnTowards(x, K.directionTo(x, SHIP));
    K.speedsByDirection(x, K.r16(x+0x34));
    K.w16(x+0x32, K.r16(x+0x36));
    K.setState(x, 0xD722);
  };
  C[0x08D722] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (K.offRight(x, 0x10, 0x120) || K.offBottom(x, 0x10, 0xF0)) { L_08D7F0(x); return; }
    K.addSprite(x, animAt(x, (K.r16(0x50) & 2) ? 0xCA85 : 0xCAA5), 2, true);
    K.touchesShip(x, 0xCAC5, true);
    K.hitTest(x, 0x0700, 0xCAC5);
    if (K.r16(x+6) & 0x80) { L_08D7A5(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) { L_08D701(x); return; }
    if (K.r16(x+0x36) == 0x10 && (K.r16(0x8E) & 0x800)) { K.w16(x+0x36, 1); }
  };
  var L_08D7A5 = function (x) {
    K.w16(x+0x20, 0);
    K.w16(x+0x14, 0x9D16);
    K.w16(x+0x16, 0);
    K.sound(5);
    K.setState(x, 0xD7C1);
  };
  C[0x08D7C1] = function (x) {
    K.objectScreen(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x80, 0x300)) { L_08D7F0(x); }
  };
  var L_08D7F0 = function (x) { K.setState(x, 0xD7F7); };
  C[0x08D7F7] = kill;
  // L_08D7FB: every $CE1F passes two shells (L_08D86F) from the right on the scripts $A630 / $A640
  C[0x08D7FB] = function (x) {
    var n = K.d16(0xCE1F+K.r16(0x88));
    K.w16(x+0x34, n);
    K.w16(x+0x32, n);
    K.setState(x, 0xD80F);
  };
  C[0x08D80F] = function (x) {
    if (beaten()) { K.setState(x, 0xD86B); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    K.w16(x+0x32, K.r16(x+0x34));
    var y = K.spawn(x, 0x08D86F, 16);
    if (y >= 0) {
      K.w16(y+0xB, 0x2F4);
      K.w16(y+0x10, 0x218);
      K.w16(y+0x30, 0xA630);
    }
    y = K.spawn(x, 0x08D86F, 16);
    if (y >= 0) {
      K.w16(y+0xB, 0x2F4);
      K.w16(y+0x10, 0x2B4);
      K.w16(y+0x30, 0xA640);
    }
  };
  C[0x08D86B] = kill;   // ?
  // L_08D86F: a shell — runs its script +$30 at the speed $CE3D; when the script's speed runs out it flies
  // at the ship with the speeds of $CE47
  C[0x08D86F] = function (x) {
    K.slotsOf(x, 0x2C);
    K.pal(x, 0xBC);
    K.scriptStart(x, K.d16(0xCE3D+K.r16(0x88)), K.r16(x+0x30));
    K.sound(0x34);
    K.setState(x, 0xD8A3);
  };
  var shellBody = function (x, a) {
    K.addSprite(x, animAt(x, (K.r16(0x50) & 2) ? 0xCA45 : 0xCA65), 2, true);
    K.touchesShip(x, 0xCAC5, true);
    K.hitTest(x, 0x0704, 0xCAC5);
  };
  C[0x08D8A3] = function (x) {
    K.scriptStep(x);
    K.objectScreen(x);
    K.w16(x+0x16, K.r16(x+0x2C));
    shellBody(x);
    if (K.r16(x+0x2E) != 0) { return; }
    // L_08D8EA
    var d = K.directionTo(x, SHIP);
    K.w8(x+0x17, d);
    var t = ((d << 2)+K.d16(0xCE47+K.r16(0x88))) & 0xFFFF;
    K.w16(x+0xD, K.d16(t));
    K.w16(x+0x12, K.d16(t+2));
    K.setState(x, 0xD916);
  };
  C[0x08D916] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (K.offRight(x, 0x10, 0x120) || K.offBottom(x, 0x10, 0xF0)) { K.setState(x, 0xD97B); return; }   // ? $D92E / $D93D → $D974
    shellBody(x);
  };
  C[0x08D97B] = kill;   // ?

  if (typeof installBossCode4 === 'function') {
    installBossCode4(K);
  }
}

if (typeof globalThis !== 'undefined') { globalThis.installBossCode3 = installBossCode3; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installBossCode3; }
