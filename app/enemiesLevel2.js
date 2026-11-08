// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The level-bound objects of Super R-Type, second part — bank `$03` of level 4 (`$A55E`, `$A8B5`, `$B201`, `$B7EC`, `$CBCD`):
 * the turning turret, the pod that releases hatches and their mines, the crawler with its bombs, the
 * falling block and the destructible wall piece. Carried over state by state onto the kernel of
 * `app/gameKernel.js` with the conventions, the marks and the measure of `app/enemies.js`
 * (`tools/matchenemies.mjs`).
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installLevelEnemyCode2(K) {
  var C = K.code;
  /** `JML task_kill` */
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };
  /**
   * `LDA $24,X; BNE blink; LDA #a; LDY #tbl; JSL S_009D3F; BCC done; BIT #$80; BNE dead; LDA #6; blink:
   * JSL S_00A0D9; done:` — the hit test with the blink but **without the flash sound** (`K.hitBlink`
   * plays `$18`); the objects of the map (the pod, the wall) use it.
   * @returns {boolean} True when the object died of the hit.
   */
  var hitBlinkQuiet = function (x, a, tbl) {
    var n = K.r16(x+0x24);
    if (n != 0) { K.blink(x, n); return false; }
    if (!K.hitTest(x, a, tbl)) { return false; }
    if (K.r16(x+6) & 0x80) { return true; }
    K.blink(x, 6);
    return false;
  };
  /** `LDA $84; BIT #1; BNE +; LDA #easy; …; BRA; +: LDA #hard; …`: a body whose hit points depend on the difficulty bit */
  var bodyByDifficulty = function (x, easy, hard) {
    K.body(x, (K.r16(0x84) & 1) ? hard : easy);
  };

  // ============================================================ the turning turret of level 4 ($03:A55E)
  // L_03A55E: a turret on the terrain — every $A passes it turns its barrel towards the ship (the frame
  // by the direction, $E664; the mirrored kind +$30 low byte ≠ 0 uses $E684 — ? never ran) and shoots
  // by the difficulty timers (+$34 / +$36); six hit points, the flash of a hit.
  C[0x03A55E] = function (x) {
    K.pal(x, 0xA4);
    K.pal2(x, 0x80);
    K.slotsOf(x, 0x17);
    K.body(x, 6);
    K.w16(x+0x32, 0xA);
    var p = K.diffParams(x);
    K.w16(x+0x34, p[0]);
    K.w16(x+0x36, p[1]);
    if (K.r16(x+0x30) & 0xFF) {
      K.w16(x+0x14, 0xE614);   // ? L_03A5D1
      K.setState(x, 0xA5E0);
    } else {
      K.w16(x+0x14, 0xE60A);   // L_03A696
      K.setState(x, 0xA6A5);
    }
  };
  /**
   * the turret's pass (states $A6A5 and ? $A5E0): the frame table `frames` by the direction (kept ×2
   * in +$38), the shot's direction from `dirs` by the same index (★ the shot gets no layer here —
   * unlike the walkers' aimed shot)
   */
  var turret = function (x, frames, dirs) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xE6EA, true);
    if (K.offRight(x, 0x30, 0x160)) { L_03A76D(x); return; }
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) {
      var a = K.directionTo(x, SHIP) << 1;
      K.w16(x+0x38, a);
      K.w16(x+0x14, K.d16(frames+a));
      K.w16(x+0x32, 0xA);
    }
    K.addSprite(x, K.r16(x+0x14), 2, true);
    if (K.hitBlink(x, 0x0700, 0xE6E4)) { L_03A75B(x); return; }   // ? $03:A700 the flash, $03:A75B the death never ran
    K.w16(x+0x34, K.r16(x+0x34)-1);
    if (K.r16(x+0x34) != 0) { return; }
    // ? $03:A71B / $03:A656: the shot never ran in the recordings
    var y = K.spawn(0x17FB, 0x03D2BF, 16);
    if (y < 0) { return; }
    K.w16(y+0x32, K.d16(dirs+K.r16(x+0x38)));
    K.w16(y+0x30, K.r16(x+0x30));
    K.w16(y+0xB, K.r16(x+0x1A)+0x200);
    K.w16(y+0x10, K.r16(x+0x1C)+0x200);
    K.w16(x+0x34, K.r16(x+0x36));
  };
  C[0x03A6A5] = function (x) { turret(x, 0xE664, 0xE6A4); };
  C[0x03A5E0] = function (x) { turret(x, 0xE684, 0xE6C4); };   // ? read statically
  var L_03A75B = function (x) {
    K.explode(x, EXPLODE, true);
    K.scoreAdd(3);
    K.sound(0x13);
    L_03A76D(x);
  };
  var L_03A76D = function (x) { K.endAt(x, 0xA77D); };
  C[0x03A77D] = kill;

  // ============================================================ the pod of level 4 ($03:A8B5)
  // L_03A8B5: a pod in the BG2 terrain with hatches ($AA0B) as its children — two above it (+$30 bit 0,
  // parameters $101 / $102) or three to its left (1 / 2 / 4). When the hatches are gone it can be
  // destroyed itself (ten hit points) and its blocks leave the map (`map_enqueue_c`, record by +$30).
  C[0x03A8B5] = function (x) {
    K.body(x, 0xA);
    var y;
    if (K.r16(x+0x30) & 1) {
      y = K.spawn(x, 0x03AA0B, 16);
      if (y >= 0) {
        K.w16(y+0x30, 0x101);
        K.w16(y+0xB, 3);
        K.w16(y+0x10, 0xFFDF);
        y = K.spawn(x, 0x03AA0B, 16);
        if (y >= 0) {
          K.w16(y+0x30, 0x102);
          K.w16(y+0xB, 3);
          K.w16(y+0x10, 0xFFEF);
        }
      }
    } else {
      // L_03A914
      y = K.spawn(x, 0x03AA0B, 16);
      if (y >= 0) {
        K.w16(y+0x30, 1);
        K.w16(y+0xB, 0xFFFD);
        K.w16(y+0x10, 0xFFE7);
        y = K.spawn(x, 0x03AA0B, 16);
        if (y >= 0) {
          K.w16(y+0x30, 2);
          K.w16(y+0xB, 0xFFFD);
          K.w16(y+0x10, 0xFFFF);
          y = K.spawn(x, 0x03AA0B, 16);
          if (y >= 0) {
            K.w16(y+0x30, 4);
            K.w16(y+0xB, 0xFFFD);
            K.w16(y+0x10, 0x17);
          }
        }
      }
    }
    K.setState(x, 0xA980);   // L_03A977
  };
  C[0x03A980] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x30, 0x160)) { L_03AA00(x); return; }
    // ★ the children test by hand: own depth into $F3, the next node's compared (`L_01804A` inline)
    K.w8(0xF3, K.r8(x+2));
    if (K.childrenDone(x)) { K.setState(x, 0xA9B2); }
  };
  C[0x03A9B2] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x30, 0x160)) { L_03AA00(x); return; }   // ? $03:A9C2
    if (!hitBlinkQuiet(x, 0x0700, 0xE816)) { return; }
    // L_03A9E3: destroyed — the big explosion, its blocks out of BG2
    K.explode(x, EXPLODE_BIG, true);
    K.sound(0x16);
    K.mapEnqueueRecord(K.d16(0xE887+2*(K.r16(x+0x30) & 0xFF)), 0x1862, true);
    L_03AA00(x);
  };
  var L_03AA00 = function (x) { K.setState(x, 0xAA07); };
  C[0x03AA07] = kill;
  // L_03AA0B: a hatch of the pod — sits at its offset from the pod (+$B/+$10, `object_screen_parent`),
  // frame by +$31 ($E7CE the upper kind, $E7C9 the side kind), releases a mine ($AB27) every $3C passes
  // first, then every $78 (or $F every other time on the easy difficulty); six hit points.
  C[0x03AA0B] = function (x) {
    K.slotsOf(x, 0x2F);
    K.pal(x, 0xA4);
    K.pal2(x, 0x80);
    K.body(x, 6);
    K.w16(x+0x32, 0x3C);
    K.w16(x+0x14, (K.r16(x+0x31) & 0xFF) ? 0xE7CE : 0xE7C9);
    K.w16(x+0x34, 0);
    K.setState(x, 0xAA68);
  };
  C[0x03AA68] = function (x) {
    K.listAdd(x);
    K.objectScreenParent(x);
    if (K.offBottom(x, 8, 0xE0)) { return; }   // L_03AAFC: below the screen it only waits
    K.addSprite(x, K.r16(x+0x14), 2, true);
    K.w16(x+0x32, K.r16(x+0x32)-1);
    if (K.r16(x+0x32) == 0) {
      var y = K.spawn(0x17FB, 0x03AB27, 16);
      if (y >= 0) {
        K.w16(y+0x30, K.r16(x+0x31) & 0xFF);
        K.w16(y+0x1E, 0x1832);
        K.w16(y+0x1A, K.r16(x+0x1A));
        K.w16(y+0x1C, K.r16(x+0x1C));
        K.w16(x+0x32, ((K.r16(0x84) & 1) || (K.r16(x+0x34) & 1)) ? 0x78 : 0xF);
        K.w16(x+0x34, K.r16(x+0x34)+1);
      }
    }
    if (!hitBlinkQuiet(x, 0x0700, 0xE810)) { return; }
    // L_03AAFD: destroyed — bound to the default layer for the explosion, three points
    K.objectBindLayer(x);
    K.explode(x, EXPLODE, true);
    K.scoreAdd(3);
    K.sound(0x17);
    K.endAt(x, 0xAB23);
  };
  C[0x03AB23] = kill;
  // L_03AB27: a mine of the hatch — set 4 pixels left of it (+$30 ≠ 0: right, ? never ran), opens
  // ($E806, group 2 front), then flies left at 4 pixels a pass ($E7FE; ? $E802 the mirrored) until the
  // terrain or the screen edge; it only touches the ship, it cannot be shot.
  C[0x03AB27] = function (x) {
    K.slotsOf(x, 0x17);
    K.body(x, 1);
    K.pal(x, 0xA3);
    K.w16(x+0x14, 0xE806);
    K.w16(x+0x16, 0);
    K.objectBindLayer(x);
    if (K.r16(x+0x30) != 0) {
      K.w16(x+0xB, K.r16(x+0xB)+4);   // ? $03:AB63
      K.w16(x+0xD, 0x400);
    } else {
      K.w16(x+0xB, K.r16(x+0xB)-4);
      K.w16(x+0xD, 0xFC00);
    }
    K.setState(x, 0xAB8B);
  };
  C[0x03AB8B] = function (x) {
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x10, 0x120)) { L_03AC46(x); return; }
    K.drawAnim(x, 2, false);
    if (!K.phaseEnd(x, 0x80, 0x500)) { return; }
    // L_03ABC9: open — flies
    K.w16(x+0x14, K.r16(x+0x30) != 0 ? 0xE802 : 0xE7FE);   // ? $03:ABCE the mirrored
    K.w16(x+0x16, 0);
    K.sound(0x3B);
    K.setState(x, 0xABF2);
  };
  C[0x03ABF2] = function (x) {
    K.moveXSigned(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x10, 0x120)) { L_03AC46(x); return; }
    K.drawAnim(x, 2, false);
    K.phaseWrap(x, 0x80, 0x200);
    K.touchesShip(x, 0xE81C, true);
    if (probe(x, 0, 0)) { L_03AC46(x); }
  };
  var L_03AC46 = function (x) { K.setState(x, 0xAC4D); };
  C[0x03AC4D] = kill;

  // ============================================================ the crawler of level 4 ($03:B201)
  // L_03B201: a crawler hanging from the terrain ($F0F7, two ship boxes) — $14 hit points ($A on the
  // hard difficulty), two hit boxes tested on alternate passes; every $78 passes (then $F0) it drops a
  // bomb ($B3F6) while above row $D0. Shot down, or when the terrain under it goes, it falls
  // (★ three points either way) with a thousand hit points and dies on the terrain below.
  C[0x03B201] = function (x) {
    bodyByDifficulty(x, 0x14, 0xA);   // ? $03:B21C the hard kind
    K.slotsOf(x, 0x14);
    K.w16(x+0x32, 0x78);
    K.w16(x+0x34, 0);
    K.pal(x, 0xA4);
    K.pal2(x, 0x80);
    K.setState(x, 0xB266);
  };
  C[0x03B266] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF114, true);
    K.touchesShip(x, 0xF11A, true);
    if (K.offRight(x, 0x30, 0x160)) { L_03B3EB(x); return; }
    K.addSprite(x, 0xF0F7, 2, true);
    if (K.hitBlink(x, 0x0700, (K.r16(0x50) & 1) ? 0xF108 : 0xF10E)) { L_03B33C(x); return; }
    // L_03B2F1: the bomb
    if (K.r16(x+0x1C) < 0xD0) {
      K.w16(x+0x32, K.r16(x+0x32)-1);
      if (K.r16(x+0x32) == 0) {
        var y = K.spawn(x, 0x03B3F6, 16);
        if (y >= 0) {
          K.w16(y+0x1E, K.r16(x+0x1E));
          K.w16(y+0xB, 0xFFF8);
          K.w16(y+0x10, 8);
          K.w16(x+0x32, 0xF0);
        }
      }
    }
    // L_03B325: still hanging?
    if (probe(x, 0, 0)) { return; }
    // L_03B330: the terrain is gone — falls
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFFDF);
    L_03B33C(x);
  };
  /** L_03B33C: the fall — the missile's mark off, three points, a body no shot kills, down and left */
  var L_03B33C = function (x) {
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.scoreAdd(3);
    K.body(x, 0x3E8);
    K.w16(x+0x1E, 0x1832);
    K.objectFromLayer(x, 0x1832);
    K.w16(x+0xD, 0xFF80);
    K.w16(x+0x12, 0x80);
    K.w16(x+0x34, 0xFF);
    K.sound(0x16);
    K.setState(x, 0xB38B);
  };
  C[0x03B38B] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF114, true);
    K.touchesShip(x, 0xF11A, true);
    if (K.offRight(x, 0x30, 0x160)) { L_03B3EB(x); return; }   // ? $03:B3B1
    K.addSprite(x, 0xF0F7, 2, true);
    K.hitTest(x, 0x0704, 0xF108);
    K.hitTest(x, 0x0704, 0xF10E);
    if (!probe(x, -0x10, 0x10)) { return; }
    // L_03B3E0: the terrain below
    K.explode(x, EXPLODE_BIG, true);
    K.sound(0x15);
    L_03B3EB(x);
  };
  var L_03B3EB = function (x) { K.setState(x, 0xB3F2); };
  C[0x03B3F2] = kill;
  // L_03B3F6: the crawler's bomb — a child at its offset: three passes closed ($F120), then open
  // ($F173, sound $26) for $36 passes with a ship box that turns with the pass counter ($F18F), then
  // closed for three more; it dies with the crawler's fall (the parent's +$34).
  C[0x03B3F6] = function (x) {
    K.slotsOf(x, 0x14);
    K.body(x, 1);
    K.w16(x+0x30, 3);
    K.pal(x, 0xA3);
    K.setState(x, 0xB42F);
  };
  C[0x03B42F] = function (x) {
    K.objectScreenParent(x);
    K.touchesShip(x, 0xF177, true);
    K.addSprite(x, 0xF120, 2, true);
    K.w16(x+0x30, K.r16(x+0x30)-1);
    if (K.r16(x+0x30) != 0) { return; }
    // L_03B44A
    K.w16(x+0x14, 0xF173);
    K.w16(x+0x16, 0);
    K.w16(x+0x30, 0x36);
    K.sound(0x26);
    K.setState(x, 0xB469);
  };
  C[0x03B469] = function (x) {
    K.objectScreenParent(x);
    K.touchesShip(x, K.d16(0xF18F+2*(K.r16(0x50) & 3)), true);
    K.drawAnim(x, 2, true);
    K.phaseWrap(x, 0x80, 0x200);
    K.w16(x+0x30, K.r16(x+0x30)-1);
    if (K.r16(x+0x30) == 0) {
      // L_03B4B5
      K.w16(x+0x30, 3);
      K.setState(x, 0xB4C4);
      return;
    }
    if (K.r16(K.r16(x+8)+0x34) != 0) { L_03B4DC(x); }
  };
  C[0x03B4C4] = function (x) {
    K.objectScreenParent(x);
    K.touchesShip(x, 0xF177, true);
    K.addSprite(x, 0xF120, 2, true);
    K.w16(x+0x30, K.r16(x+0x30)-1);
    if (K.r16(x+0x30) == 0) { L_03B4DC(x); }
  };
  var L_03B4DC = function (x) { K.setState(x, 0xB4E3); };
  C[0x03B4E3] = kill;

  // ============================================================ the falling block of level 4 ($03:B7EC)
  // L_03B7EC: a block ($F1F9) held by the terrain to its left — $14 hit points ($A hard); shot down or
  // with the terrain gone it gets a new body ($A / 5) and falls (+$12 = $80) until the terrain under
  // either corner stops it; then it sits and can still be shot (two points).
  C[0x03B7EC] = function (x) {
    bodyByDifficulty(x, 0x14, 0xA);   // ? $03:B807 the hard kind
    K.slotsOf(x, 0x2D);
    K.pal(x, 0xA4);
    K.pal2(x, 0x80);
    K.setState(x, 0xB848);
  };
  /** the block's pass (states $B848, $B8FA, $B97C): false when the object is gone; the death is `onDead` */
  var block = function (x, onDead) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF218, true);
    if (K.offRight(x, 0x30, 0x160)) { L_03B9E0(x); return false; }
    K.addSprite(x, 0xF1F9, 2, true);
    if (K.hitBlink(x, 0x0700, 0xF212)) { onDead(x); return false; }
    return true;
  };
  C[0x03B848] = function (x) {
    if (!block(x, L_03B8B3)) { return; }
    if (probe(x, -9, 0)) { return; }
    // L_03B8A7: the hold is gone
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFFDF);
    L_03B8B3(x);
  };
  /** L_03B8B3: the fall — a new body, bound to BG1, down at half a pixel a pass */
  var L_03B8B3 = function (x) {
    bodyByDifficulty(x, 0xA, 5);   // ? $03:B8CE the hard kind
    K.w16(x+0x1E, 0x1832);
    K.objectFromLayer(x, 0x1832);
    K.w16(x+0x12, 0x80);
    K.setState(x, 0xB8FA);
  };
  C[0x03B8FA] = function (x) {
    K.listAdd(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    K.touchesShip(x, 0xF218, true);
    if (K.offRight(x, 0x30, 0x160)) { L_03B9E0(x); return; }   // ? $03:B921
    K.addSprite(x, 0xF1F9, 2, true);
    if (K.hitBlink(x, 0x0700, 0xF212)) { L_03B9CE(x); return; }
    if (probe(x, -0xC, 0x11) || probe(x, 0xB, 0x11)) { K.setState(x, 0xB97C); }   // L_03B973: landed
  };
  C[0x03B97C] = function (x) {
    block(x, L_03B9CE);   // ? $03:B9BA the flash and the death never ran
  };
  var L_03B9CE = function (x) {
    K.explode(x, EXPLODE_BIG, true);
    K.scoreAdd(2);
    K.sound(0x15);
    L_03B9E0(x);
  };
  var L_03B9E0 = function (x) { K.endAt(x, 0xB9F0); };
  C[0x03B9F0] = kill;

  // ============================================================ the wall piece of level 4 ($03:CBCD)
  // L_03CBCD: a destructible piece of the BG2 terrain — hit points by the difficulty ($F6F7), no sprite
  // of its own; destroyed, it leaves the map (`map_enqueue_c`, record $F6C9 by +$30) with the big explosion.
  C[0x03CBCD] = function (x) {
    K.body(x, K.d16(0xF6F7+K.r16(0x88)));
    K.setState(x, 0xCBEA);
  };
  C[0x03CBEA] = function (x) {
    K.listAdd(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x20, 0x140)) { L_03CC54(x); return; }
    if (!hitBlinkQuiet(x, 0x0700, 0xF6F1)) { return; }
    // L_03CC27
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.scoreAdd(3);
    K.sound(0x15);
    K.explode(x, EXPLODE_BIG, true);
    K.mapEnqueueRecord(K.d16(0xF6C9+2*(K.r16(x+0x30) & 0xFF)), 0x1862, true);
    L_03CC54(x);
  };
  var L_03CC54 = function (x) { K.setState(x, 0xCC5B); };
  C[0x03CC5B] = kill;

  if (typeof installLevelEnemyCode3 === 'function') {
    installLevelEnemyCode3(K);
  }
}

if (typeof globalThis !== 'undefined') { globalThis.installLevelEnemyCode2 = installLevelEnemyCode2; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installLevelEnemyCode2; }
