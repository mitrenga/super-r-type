// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The objects of bank `$03` of Super R-Type (`sources/docs/disasm_notes.md`
 * §10), carried over state by state onto the kernel of
 * `app/gameKernel.js`: the **explosions** every enemy leaves (`$D08F`,
 * `$D0E4`, `$D144`, `$D1A4` — spawned through `S_03CE1B`, `S_03CE3E`,
 * `S_03CE67`, `S_03CE8A`, the kernel's `explode`), the **enemies' shots**
 * (`$D2BF` aimed in one of 16 directions, `$D404` the spinning kind), and
 * the **level-bound enemies**: the gun posts of level 1 (`$A370`), the
 * divers (`$BDA1`), the formation with its leader (`$C052`), the level 4
 * and 6 walkers and crawlers, the rolling mines and the batteries of
 * levels 5-7. The conventions are `app/enemies.js`'s.
 *
 * @param {Ship} K - The game.
 */
function installLevelEnemyCode(K) {
  var C = K.code;
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };

  // ============================================================ the explosions
  /** `L_03D08F` and its kin: an animation at the object's place, no body, palette $82 */
  var explosion = function (x, anim, state) {
    K.w16(x+0x14, anim);
    K.w16(x+0x16, 0);
    K.w16(x+0x20, 0);
    K.pal(x, 0x82);
    K.setState(x, state);
  };
  C[0x03D08F] = function (x) { explosion(x, 0xF9C5, 0xD0B2); };           // S_03CE1B: at the position
  C[0x03D0B2] = function (x) {
    K.objectScreen(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x40, 0x600)) { L_03D1F6(x); }
  };
  C[0x03D0E4] = function (x) { explosion(x, 0xF9C5, 0xD107); };           // S_03CE3E: on the layer
  C[0x03D107] = function (x) {
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x40, 0x600)) { L_03D1F6(x); }
  };
  C[0x03D139] = function (x) { explosion(x, 0xFE87, 0xD167); };           // ? the big burst at the position
  C[0x03D144] = function (x) { explosion(x, 0xFC2F, 0xD167); };           // S_03CE67: the small burst at the position
  C[0x03D167] = function (x) {
    K.objectScreen(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x40, 0x800)) { L_03D1F6(x); }
  };
  C[0x03D199] = function (x) { explosion(x, 0xFE87, 0xD1C7); };           // ? the big burst on the layer
  C[0x03D1A4] = function (x) { explosion(x, 0xFC2F, 0xD1C7); };           // S_03CE8A: the small burst on the layer
  C[0x03D1C7] = function (x) {
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x40, 0x800)) { L_03D1F6(x); }
  };
  var L_03D1F6 = function (x) { K.setState(x, 0xD1FD); };
  C[0x03D1FD] = kill;

  // ? L_03D262: a smoke trail by the parent's direction (+$30), drawn while the parent lives
  C[0x03D262] = function (x) {
    var i = (K.r16(x+0x30) & 0xF)*4;
    K.w16(x+0xB, K.d16(0x851F+i));
    K.w16(x+0x10, K.d16(0x8521+i));
    K.w16(x+0x20, 0);
    K.pal(x, 0x81);
    K.setState(x, 0xD291);
  };
  C[0x03D291] = function (x) {
    var p = K.r16(x+8);
    if (K.r16(p+6) & 0x80) {
      K.setState(x, 0xD2BB);
      return;
    }
    K.objectScreenParent(x);
    K.addSprite(x, (K.r16(0x50) & 4) ? 0xFE9C : 0xFEA1, 2, false);
  };
  C[0x03D2BB] = kill;

  // ============================================================ the enemies' shots
  /**
   * `L_03D2BF` / `L_03D404`: the speeds of direction +$32 (0-15) from the table of the difficulty
   * (`$04:FEAC` rows by the parameter +$31, `$04:FEFC` the tables), a body of one.
   */
  var shotInit = function (x) {
    var row = (K.r16(x+0x31) & 7)*10+0xFEAC;
    var tbl = K.d16(0xFEFC+K.d16(row+K.r16(0x88)));
    var i = (K.r16(x+0x32) & 0xF)*4;
    K.w16(x+0xD, K.d16(tbl+i));
    K.w16(x+0x12, K.d16(tbl+2+i));
    K.w16(x+0x20, 0);
    K.body(x, 1);
    K.pal(x, 0x81);
  };
  C[0x03D2BF] = function (x) {
    shotInit(x);
    K.setState(x, 0xD31F);
  };
  C[0x03D31F] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (K.r16(x+0x1A) >= 0x100 || K.r16(x+0x1C) >= 0xD0) { L_03D3F9(x); return; }
    K.addSprite(x, 0xFE97, 2, true);
    K.touchesShip(x, 0xFEA6, true);
    if (K.r16(0x50) & 1) {
      // ★ the odd passes test the ship's shots (the Force and the bits absorb it: kind $200), the even the terrain
      if (K.hitTest(x, 0x0200, 0xFEA6)) { L_03D3F9(x); }
      return;
    }
    if (!probe(x, 0, 0)) { return; }
    // L_03D3B8: the burst on the terrain
    K.w16(x+0x14, 0x9D16);
    K.w16(x+0x16, 0);
    K.setState(x, 0xD3CA);
  };
  C[0x03D3CA] = function (x) {
    K.objectScreen(x);
    K.drawAnim(x, 1, true);
    if (K.phaseEnd(x, 0x100, 0x300)) { L_03D3F9(x); }
  };
  var L_03D3F9 = function (x) { K.setState(x, 0xD400); };
  C[0x03D400] = kill;
  C[0x03D404] = function (x) {
    shotInit(x);
    K.w16(x+0x14, 0xF939);
    K.w16(x+0x16, 0);
    K.setState(x, 0xD46D);
  };
  C[0x03D46D] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (K.offRight(x, 4, 0x108) || K.offBottom(x, 4, 0xD8)) { L_03D527(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x40, 0x400);
    K.touchesShip(x, 0xFEA6, true);
    if (K.r16(0x50) & 1) {
      if (K.hitTest(x, 0x0200, 0xFEA6)) { L_03D527(x); }
      return;
    }
    if (!probe(x, 0, 0)) { return; }
    K.w16(x+0x14, 0x9D16);
    K.w16(x+0x16, 0);
    K.setState(x, 0xD54F);
  };
  var L_03D527 = function (x) { K.setState(x, 0xD52E); };
  C[0x03D52E] = kill;
  C[0x03D54F] = function (x) {
    K.objectScreen(x);
    K.drawAnim(x, 1, true);
    if (K.phaseEnd(x, 0x100, 0x300)) { L_03D527(x); }
  };

  // ============================================================ the gun post ($03:A370)
  // L_03A370: turns towards the ship every $1E passes and fires along the table's direction; +$30 = 0
  // the kind on the floor, else on the ceiling
  C[0x03A370] = function (x) {
    K.pal(x, 0x8D);
    K.slotsOf(x, 4);
    K.body(x, 1);
    K.w16(x+0x34, 1);
    var p = K.diffParams(x);
    K.w16(x+0x32, p[0]);
    K.w16(x+0x38, p[1]);
    if ((K.r16(x+0x30) & 0xFF) == 0) {
      K.w16(x+0x14, 0xD8E2);
      K.setState(x, 0xA497);
      return;
    }
    K.w16(x+0x14, 0xD8BF);
    K.setState(x, 0xA3E4);
  };
  var gunPost = function (x, frames, dirs, deathOnHit) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xD96D, true);
    if (K.offRight(x, 0x11, 0x122)) { L_03A54A(x); return; }
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) == 0) {
      var dir2 = K.directionTo(x, SHIP) << 1;
      K.w16(x+0x36, dir2);
      K.w16(x+0x14, K.d16(frames+dir2));
      K.w16(x+0x34, 0x1E);
    }
    K.addSprite(x, K.r16(x+0x14), 2, true);
    if (K.hit(x, 0xD967)) { L_03A538(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    var y = K.spawn(0x17FB, 0x03D2BF, 16);
    if (y < 0) { return; }
    K.w16(y+0x32, K.d16(dirs+K.r16(x+0x36)));
    K.w16(y+0x30, K.r16(x+0x30));
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0x1A)+0x200);
    K.w16(y+0x10, K.r16(x+0x1C)+0x200);
    K.w16(x+0x32, K.r16(x+0x38));
  };
  C[0x03A3E4] = function (x) { gunPost(x, 0xD907, 0xD947); };
  C[0x03A497] = function (x) { gunPost(x, 0xD8E7, 0xD927); };
  var L_03A538 = function (x) {
    K.explode(x, EXPLODE, true);
    K.scoreAdd(1);
    K.sound(0x13);
    L_03A54A(x);
  };
  var L_03A54A = function (x) { K.endAt(x, 0xA55A); };
  C[0x03A55A] = kill;

  // ============================================================ the divers ($03:BDA1)
  // L_03BDA1: the spawner — a diver every +$36 passes while on the screen
  C[0x03BDA1] = function (x) {
    K.w16(x+0x36, K.d16(0xF288+K.r16(0x88)));
    K.w16(x+0x34, 1);
    K.setState(x, 0xBDB8);
  };
  C[0x03BDB8] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x11, 0x122)) { L_03C03E(x); return; }
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) != 0) { return; }
    var y = K.spawn(0x17FB, 0x03BE03, 16);
    if (y < 0) { return; }
    K.w16(y+0x30, K.r16(x+0x30));
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
    K.w16(x+0x34, K.r16(x+0x36));
  };
  // L_03BE03: a diver — falls (or rises, +$30), turns towards the ship when it is near, dives at it
  C[0x03BE03] = function (x) {
    K.slotsOf(x, 0x25);
    K.pal(x, 0xA8);
    K.pal2(x, 0x80);
    K.body(x, (K.r16(0x84) & 7) ? 1 : 2);
    K.w16(x+0x12, K.d16((K.r16(x+0x30) == 0 ? 0xF254 : 0xF25E)+K.r16(0x88)));
    K.setState(x, 0xBE73);
  };
  C[0x03BE73] = function (x) {
    K.listAdd(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF27C, true);
    if (K.offRight(x, 0x11, 0x122) || K.offBottom(x, 0x11, 0xF2)) { L_03C03E(x); return; }
    K.addSprite(x, 0xF23D, 2, true);
    if (K.hitBlink(x, 0x0700, 0xF27C)) { L_03C02C(x); return; }
    // the ship within $30 below / above and $38 left / right
    if (((K.r16(x+0x1C)+0x30) & 0xFFFF) < shipY()) { return; }
    if (!(((K.r16(x+0x1C)-0x30-shipY()) & 0x8000))) { return; }
    if (((K.r16(x+0x1A)+0x38) & 0xFFFF) < shipX()) { return; }
    var a = (K.r16(x+0x1A)-0x38) & 0xFFFF;
    if (!(((a-shipX()) & 0x8000)) && a >= shipX()) { return; }
    // L_03BF0F: the dive
    K.w16(x+0x32, 0x3C);
    K.w16(x+0x14, 0xF24C);
    K.w16(x+0x16, 0);
    K.w16(x+0x12, K.d16((K.r16(x+0x30) == 0 ? 0xF268 : 0xF272)+K.r16(0x88)));
    K.sound(0x19);
    K.setState(x, 0xBF40);
  };
  C[0x03BF40] = function (x) {
    K.listAdd(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF27C, true);
    if (K.offRight(x, 0x20, 0x140) || K.offBottom(x, 0x20, 0x110)) { L_03C03E(x); return; }
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x80, 0x400);
    if (K.hitBlink(x, 0x0700, 0xF27C)) { L_03C02C(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) != 0) { return; }
    // ? L_03BFD1: burns out
    K.w16(x+0x20, 0);
    K.w16(x+0x14, 0xFC2F);
    K.w16(x+0x16, 0);
    K.w16(x+6, K.r16(x+6) | 0x20);
    K.sound(0x1A);
    K.setState(x, 0xBFF6);
  };
  C[0x03BFF6] = function (x) {
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF282, true);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x40, 0x600)) { L_03C03E(x); }
  };
  var L_03C02C = function (x) {
    K.explode(x, EXPLODE, true);
    K.scoreAdd(2);
    K.sound(0x17);
    L_03C03E(x);
  };
  var L_03C03E = function (x) { K.endAt(x, 0xC04E); };
  C[0x03C04E] = kill;

  // ============================================================ ? the formation ($03:C052)
  // ? L_03C052: three escorts (L_03C361), a leader (L_03C174), three more; the group on scripts of
  // ? bank $06 ($B010 the kind 0, $B034 the other), the escorts firing when the leader is near the ship
  var formationChild = function (x, i, tables) {
    var y = K.spawn(x, 0x03C361, 16);
    if (y < 0) { return false; }
    K.w16(y+0x1E, K.r16(x+0x1E));
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
    K.w16(y+0x38, K.d16(tables[3]+i));
    K.w16(y+0x30, K.d16(tables[2]+i) | K.r16(x+0x30));
    K.w16(y+0x32, K.d16(tables[1]+i));
    K.w16(y+0x34, K.d16(tables[0]+i));
    return true;
  };
  C[0x03C052] = function (x) {
    K.w16(x+0x36, 0);
    var n;
    for (n = 3; n > 0; n--) {
      if (!formationChild(x, (n-1)*2, [0xF463, 0xF46F, 0xF47B, 0xF487])) { break; }
    }
    // L_03C0AE
    for (;;) {
      var y = K.spawn(x, 0x03C174, 16);
      if (y >= 0) {
        K.w16(y+0x30, K.r16(x+0x30));
        K.w16(y+0x1E, K.r16(x+0x1E));
        K.w16(y+0xB, K.r16(x+0xB));
        K.w16(y+0x10, K.r16(x+0x10));
        K.w16(y+0x34, 0x49);
      }
      // L_03C0DB
      var again = false;
      for (n = 3; n > 0; n--) {
        if (!formationChild(x, (n-1)*2, [0xF469, 0xF475, 0xF481, 0xF48D])) { again = true; break; }
      }
      if (!again) { break; }
    }
    if (K.r16(x+0x30)) {
      K.w16(x+0x10, K.r16(x+0x10)+0x30);
    } else {
      K.w16(x+0x10, K.r16(x+0x10)-0x30);
    }
    K.setState(x, 0xC155);
  };
  C[0x03C155] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x40, 0x180)) { K.setState(x, 0xC170); }
  };
  C[0x03C170] = kill;
  // ? L_03C174: the leader
  C[0x03C174] = function (x) {
    K.slotsOf(x, 0x18);
    K.body(x, 5);
    K.pal(x, 0xA7);
    K.pal2(x, 0x80);
    if (K.r16(x+0x30) & 0xFF) {
      K.scriptStart(x, 0x100, 0xB034);
      K.setState(x, 0xC2A1);
      return;
    }
    K.scriptStart(x, 0x100, 0xB010);
    K.setState(x, 0xC1CA);
  };
  var wait34 = function (x, next) {
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) == 0) { K.setState(x, next); }
  };
  C[0x03C1CA] = function (x) { wait34(x, 0xC1D9); };
  C[0x03C2A1] = function (x) { wait34(x, 0xC2B0); };
  var leader = function (x, frames, boxes, death) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF3BD, true);
    var i = (K.r16(x+0x2D) & 0xF) << 1;
    K.w16(x+0x3C, i);
    K.addSprite(x, K.d16(frames+i), 2, false);
    if (K.hitBlink(x, 0x0700, K.d16(boxes+i))) { death(x); return; }
    K.hitTest(x, 0x0704, 0xF3B7);
  };
  var leaderDeath = function (x, next) {
    K.explode(x, EXPLODE, true);
    K.sound(0x15);
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.scoreAdd(1);
    K.w16(K.r16(x+8)+0x36, 0xFF);
    K.setState(x, next);
  };
  C[0x03C1D9] = function (x) { leader(x, 0xF377, 0xF423, function (x) { leaderDeath(x, 0xC26D); }); };
  C[0x03C2B0] = function (x) { leader(x, 0xF397, 0xF443, function (x) { leaderDeath(x, 0xC334); }); };
  var leaderGone = function (x) {
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF3BD, true);
    K.addSprite(x, 0xF332, 2, false);
    K.hitTest(x, 0x0704, 0xF3B7);
  };
  C[0x03C26D] = leaderGone;
  C[0x03C334] = leaderGone;
  // ? L_03C361: an escort
  C[0x03C361] = function (x) {
    K.slotsOf(x, 0x18);
    K.body(x, 0x3E8);
    K.pal(x, 0xA7);
    var p = K.diffParams(x);
    K.w16(x+0x38, K.r16(x+0x38)+p[0]);
    K.w16(x+0x3A, p[1]);
    if (K.r16(x+0x30) & 0xFF) {
      K.scriptStart(x, 0x100, 0xB034);
      K.setState(x, 0xC561);
      return;
    }
    K.scriptStart(x, 0x100, 0xB010);
    K.setState(x, 0xC3D6);
  };
  C[0x03C3D6] = function (x) { wait34(x, 0xC3E5); };
  C[0x03C561] = function (x) { wait34(x, 0xC570); };
  var escort = function (x, frames, boxes, dirs, death, gone) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF3BD, true);
    var i = (K.r16(x+0x2D) & 0xF) << 1;
    K.w16(x+0x3C, i);
    K.addSprite(x, K.d16(frames+i), 2, false);
    if (K.hitTest(x, 0x0700, K.d16(boxes+i))) { death(x); return; }
    K.hitTest(x, 0x0704, 0xF3B7);
    var p = K.r16(x+8);
    var near = ((K.r16(p+0x1A)-0x28) & 0xFFFF) < shipX() && ((K.r16(p+0x1A)+0x28) & 0xFFFF) >= shipX()
      && ((K.r16(p+0x1C)-0x28) & 0xFFFF) < shipY() && ((K.r16(p+0x1C)+0x28) & 0xFFFF) >= shipY();
    if (near) {
      K.w16(x+0x38, K.r16(x+0x38)-1);
      if (K.r16(x+0x38) == 0) {
        var y = K.spawn(0x17FB, 0x03D2BF, 16);
        if (y >= 0) {
          K.w16(y+0x32, K.d16(dirs+K.r16(x+0x3C)));
          K.w16(y+0x30, K.r16(x+0x30));
          K.w16(y+0x1E, K.r16(x+0x1E));
          K.w16(y+0xB, K.r16(x+0x1A)+0x200);
          K.w16(y+0x10, K.r16(x+0x1C)+0x200);
          K.w16(x+0x38, K.r16(x+0x3A));
        }
      }
    }
    // L_03C4B9: the leader gone — the escorts leave after +$32 passes
    if (K.r16(p+0x36) != 0) { K.setState(x, gone); }
  };
  var escortDeath = function (x, next) {
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.scoreAdd(1);
    K.explode(x, EXPLODE, true);
    K.sound(0x16);
    K.setState(x, next);
  };
  var escortLeaving = function (x, frames, death) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF3BD, true);
    K.addSprite(x, K.d16(frames+((K.r16(x+0x2D) & 0xF) << 1)), 2, false);
    K.hitTest(x, 0x0704, 0xF3B7);
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) { death(x); }
  };
  var escortGone = function (x) {
    K.scriptStep(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF3BD, true);
    K.addSprite(x, 0xF332, 2, false);
    K.hitTest(x, 0x0704, 0xF3B7);
  };
  C[0x03C3E5] = function (x) { escort(x, 0xF337, 0xF423, 0xF493, function (x) { escortDeath(x, 0xC52D); }, 0xC4CB); };
  C[0x03C4CB] = function (x) { escortLeaving(x, 0xF337, function (x) { escortDeath(x, 0xC52D); }); };
  C[0x03C52D] = escortGone;
  C[0x03C570] = function (x) { escort(x, 0xF357, 0xF443, 0xF4B3, function (x) { escortDeath(x, 0xC6B8); }, 0xC656); };
  C[0x03C656] = function (x) { escortLeaving(x, 0xF357, function (x) { escortDeath(x, 0xC6B8); }); };
  C[0x03C6B8] = escortGone;

  if (typeof installLevelEnemyCode2 === 'function') {
    installLevelEnemyCode2(K);
  }
} // installLevelEnemyCode

if (typeof globalThis !== 'undefined') { globalThis.installLevelEnemyCode = installLevelEnemyCode; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installLevelEnemyCode; }
