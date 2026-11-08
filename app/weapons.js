// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The bits and the homing missiles of Super R-Type (`$01:F77C`-`$01:FF9D`,
 * `sources/docs/disasm_notes.md` §9), carried over onto `app/ship.js`.
 *
 * **The bits** (the manual's PIT, `$17CD` = 1 one above the ship, 2 both)
 * are the root tasks `$174D` (above, flag bit 1 of `$4A`) and `$178D`
 * (below, bit 0): they fly in from the ship's trail (`$17CF`, the eight
 * last positions, offset by the ship's tilt counters `$7A`/`$7C`) to their
 * height, then follow the trail; the laser handlers of `$04:B487`/`$B49B`
 * ask them to shoot (`$17EF`/`$17F1`) and they spawn the bit shots of
 * `$01:CECA`… (`app/lasers.js`).
 *
 * **The homing missiles** (`$1689` = 1 or 2, `$1687` in flight) are
 * spawned by the ship's fire (`L_01B3DF`): they rise from the ship with a
 * growing speed, then pick the first enemy of the list `$168D` not yet
 * targeted and turn towards it (`S_00A67E`, `S_00A72F`, the speeds of
 * `$04:879F`), trailing smoke (`$03:D201`), and burst on the terrain or
 * the target (`$01:FF0D`).
 *
 * @param {Ship} K - The game.
 */
function installWeaponsCode(K) {
  var C = K.code;
  var over = function () { return (K.r16(0x4A) & 0x40) != 0; };

  // ================================================================ the bits
  /**
   * `L_01F79D` / `L_01F7C9` → `L_01F7CF`: a bit is born at the ship's
   * trail with its target height `$32` and its step `$34` (−$18 / −1
   * above, +$10 / +1 below), the tilt counters reset.
   */
  K.bitStart = function (x, target, step) {
    K.w16(x+0x32, target);
    K.w16(x+0x34, step);
    K.w16(x+0x30, 0);
    K.w16(0x7A, 0);
    K.w16(0x7C, 0);
    K.w16(x+0x20, 0);
    K.w16(x+0x22, 1);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w8(x+0x18, K.acquirePaletteSlot(0x81));
    K.setState(x, 0xF809);
  };
  /** the bit at the trail's position + the tilt counters, its height offset by +$30 */
  var bitPlace = function (x) {
    var y = K.r16(0x78);
    K.w16(x+0xB, K.r16(0x17CF+y)+K.r16(0x7A));
    K.w16(x+0x10, K.r16(0x17D1+y)+K.r16(0x7C)+K.r16(x+0x30));
    K.objectScreen(x);
    K.addSprite(x, 0xB4C1, 1, false);
    K.shotBox(x, 0x408, 0xB4C6);
  };
  // L_01F809: flying out to its height
  C[0x01F809] = function (x) {
    if (over()) { L_01F924(x); return; }
    bitPlace(x);
    var v = (K.r16(x+0x30)+K.r16(x+0x34)) & 0xFFFF;
    K.w16(x+0x30, v);
    if (v != K.r16(x+0x32)) { return; }
    if (x == 0x174D) { K.w16(0x17EF, 0); } else { K.w16(0x17F1, 0); }
    K.setState(x, 0xF867);
  };
  // L_01F867: following the ship; a shot when asked ($17EF / $17F1)
  C[0x01F867] = function (x) {
    if (over()) { L_01F924(x); return; }
    bitPlace(x);
    var flag = (x == 0x174D) ? 0x17EF : 0x17F1;
    var count = (x == 0x174D) ? 0x1675 : 0x167F;
    var v = K.r16(flag);
    if (v == 0) { return; }
    K.w16(flag, 0);
    K.w16(0, v & 1);
    if (K.r16(count) >= 2) { return; }
    var code;
    if (x == 0x174D) {
      code = (v & 1) ? 0x01CEE1 : 0x01CECA;
    } else {
      code = (v & 1) ? 0x01CF4A : 0x01CF3A;
    }
    var y = K.spawn(x, code, 8);
    if (y < 0) { return; }
    K.w16(count, K.r16(count)+1);
    K.w16(y+0xB, K.r16(x+0xB));
    K.w16(y+0x10, K.r16(x+0x10));
  };
  /** `L_01F924` / `L_01F92D`: the section's end — the palette freed, the root back to waiting */
  var L_01F924 = function (x) { K.setState(x, 0xF92D); };
  C[0x01F92D] = function (x) {
    if (!over()) {
      // $01:F934: only the sprite while the flag is clear again
      K.addSprite(x, 0xB4C1, 1, false);
      return;
    }
    K.freePaletteSlot(K.r8(x+0x18));
    K.L_01F943(x);
  };

  // ================================================= the missiles ($1689: 1 = homing, 2 = anti-ground)
  /**
   * `L_01F968`: the anti-ground missile (the manual's blue M): it falls
   * diagonally from the ship with a growing speed until it meets the
   * terrain, then rolls along it (`$FABB`) and falls off edges (`$FB3C`),
   * bursting seven times (`$FBD1`).
   */
  C[0x01F968] = function (x) {
    K.w16(0x1687, K.r16(0x1687)+1);
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x80));
    K.w16(x+0x22, 1);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(x+0xB, K.r16(0x1594));
    K.w16(x+0x10, K.r16(0x1599));
    K.w16(x+0xD, 0);
    K.w16(x+0x12, 0);
    K.setState(x, 0xF9A9);
  };
  /** the fall: both speeds grow by $10 a pass to $400 */
  var groundFall = function (x, growing) {
    if (K.r16(x+6) & 0x80) { L_01FA8E(x, K.r16(0x46)); return; }
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (offScreen(x)) { L_01FBA4(x); return; }
    K.addSprite(x, 0xFF58, 1, false);
    K.shotBox(x, 0x100, 0xFF5D);
    K.w16(0x42, 0);
    K.w16(0x44, 0xD);
    if (K.terrainHit(x)) { L_01FA8E(x, K.hitLayer); return; }
    K.w16(0x42, 0xD);
    K.w16(0x44, 0);
    if (K.terrainHit(x)) { L_01FA8E(x, K.hitLayer); return; }
    if (!growing) { return; }
    var sp = (K.r16(x+0xD)+0x10) & 0xFFFF;
    if (sp < 0x400) {
      K.w16(x+0xD, sp);
      K.w16(x+0x12, sp);
      return;
    }
    K.setState(x, 0xFA2B);
  };
  C[0x01F9A9] = function (x) { groundFall(x, true); };
  C[0x01FA2B] = function (x) { groundFall(x, false); };
  /** `L_01FA8E`: on the layer `layer`: bound to it, seven bursts, the first at once */
  var L_01FA8E = function (x, layer) {
    K.w16(x+0x1E, layer);
    K.objectFromLayer(x, layer);
    K.w16(x+0x34, 7);
    K.w16(x+0x32, 1);
    K.w16(x+0xD, 0x200);
    K.w16(x+0x12, 0x200);
    K.sound(6);
    K.setState(x, 0xFABB);   // L_01FAB2
  };
  /** every eighth pass a burst on the layer; the seventh ends the missile */
  var groundBurst = function (x) {
    var n = (K.r16(x+0x32)-1) & 0xFFFF;
    K.w16(x+0x32, n);
    if (n != 0) { return false; }
    K.w16(x+0x32, 8);
    var y = K.spawn(x, 0x01FBD1, 8);
    if (y >= 0) {
      K.w16(y+0x1E, K.r16(x+0x1E));
      K.w16(y+0xB, K.r16(x+0xB));
      K.w16(y+0x10, K.r16(x+0x10));
    }
    var left = (K.r16(x+0x34)-1) & 0xFFFF;
    K.w16(x+0x34, left);
    if (left == 0) { L_01FBA4(x); return true; }
    return false;
  };
  // L_01FABB: rolling along the ground
  C[0x01FABB] = function (x) {
    K.moveX(x);
    K.objectScreenLayer(x);
    if (offScreen(x)) { L_01FBA4(x); return; }
    if (groundBurst(x)) { return; }
    K.w16(0x42, 0);
    K.w16(0x44, 0xD);
    if (!K.terrainHit(x)) { K.setState(x, 0xFB3C); return; }   // L_01FB33: nothing below — falling
    K.w16(0x42, 8);
    K.w16(0x44, 0);
    if (K.terrainHit(x)) { L_01FBA4(x); }
  };
  // L_01FB3C: falling off an edge
  C[0x01FB3C] = function (x) {
    K.moveY(x);
    K.objectScreenLayer(x);
    if (offScreen(x)) { L_01FBA4(x); return; }
    if (groundBurst(x)) { return; }
    K.w16(0x42, 0);
    K.w16(0x44, 0xD);
    if (K.terrainHit(x)) { K.setState(x, 0xFABB); }
  };
  var L_01FBA4 = function (x) { K.setState(x, 0xFBAD); };
  C[0x01FBAD] = function (x) {
    if (!K.childrenDone(x)) { return; }
    K.w16(0x1687, K.r16(0x1687)-1);
    K.setState(x, 0xFBCD);
  };
  C[0x01FBCD] = function (x) { K.kill(x); };
  // L_01FBD1: a burst on the ground (the ship's death animation, drawn in group 2)
  C[0x01FBD1] = function (x) {
    K.w16(x+0x14, 0xF9C5);
    K.w16(x+0x16, 0);
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x80));
    K.w16(x+0x22, 1);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.setState(x, 0xFC06);
  };
  C[0x01FC06] = function (x) {
    K.objectScreenLayer(x);
    K.addSprite(x, K.animFrame(x), 2, true);
    var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
    if (v >= 0x600) { K.setState(x, 0xFC46); return; }
    K.w16(x+0x16, v);
    K.shotBox(x, 0x108, 0xFF63);
  };
  C[0x01FC46] = function (x) { K.kill(x); };

  // ----------------------------------------------------- the homing missiles
  /** `L_01FC4A`: two homing missiles (the pink M): the second is this one's child */
  C[0x01FC4A] = function (x) {
    K.w16(0x1687, K.r16(0x1687)+1);
    K.sound(5);
    K.spawn(x, 0x01FC70, 8);
    K.setState(x, 0xFC68);
  };
  C[0x01FC68] = function (x) {
    K.w16(x+0x34, 0xFFF8);
    missileBirth(x);
  };
  C[0x01FC70] = function (x) {
    K.w16(0x1687, K.r16(0x1687)+1);
    K.w16(x+0x34, 8);
    missileBirth(x);
  };
  /** `L_01FC79`: a missile at the ship, no speed, the rising animation `$04:FFB9` */
  var missileBirth = function (x) {
    K.w16(x+0x10, K.r16(0x1599));
    K.w16(x+0xB, K.r16(0x1594));
    K.w16(x+0xD, 0);
    K.w16(x+0x12, 0);
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x80));
    K.w16(x+0x22, 1);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w16(x+0x14, 0xFFB9);
    K.w16(x+0x16, 0);
    K.setState(x, 0xFCC0);
  };
  /** off the screen (x+16 ≥ $120 or y+16 ≥ $F0)? */
  var offScreen = function (x) {
    return ((K.r16(x+0x1A)+0x10) & 0xFFFF) >= 0x120 || ((K.r16(x+0x1C)+0x10) & 0xFFFF) >= 0xF0;
  };
  // L_01FCC0: rising with the ship's side step $34 added to the y speed, the x speed growing to $200
  C[0x01FCC0] = function (x) {
    if (K.r16(x+6) & 0x80) { L_01FEFD(x); return; }
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (offScreen(x)) { L_01FF6B(x); return; }
    K.addSprite(x, K.animFrame(x), 1, false);
    K.w16(0x42, 0);
    K.w16(0x44, 0);
    if (K.terrainHit(x)) { L_01FF0D(x, K.hitLayer); return; }
    K.shotBox(x, 0x100, 0xFFD9);
    K.w16(x+0x12, K.r16(x+0x12)+K.r16(x+0x34));
    var sp = (K.r16(x+0xD)+0x10) & 0xFFFF;
    if (sp < 0x200) {
      K.w16(x+0xD, sp);
      return;
    }
    // L_01FD3C: the flight at 3 px a pass, the smoke, 15 passes straight
    K.w16(x+0xD, 0x300);
    K.w16(x+0x12, 0);
    K.w16(x+0x36, 0xF);
    K.spawn(x, 0x03D201, 16);
    K.setState(x, 0xFD5F);
  };
  C[0x01FD5F] = function (x) {
    if (K.r16(x+6) & 0x80) { L_01FEFD(x); return; }
    K.moveXSigned(x);
    K.objectScreen(x);
    if (offScreen(x)) { L_01FF6B(x); return; }
    K.addSprite(x, K.animFrame(x), 1, false);
    K.w16(0x42, 0);
    K.w16(0x44, 0);
    if (K.terrainHit(x)) { L_01FF0D(x, K.hitLayer); return; }
    K.shotBox(x, 0x100, 0xFFD9);
    var n = (K.r16(x+0x36)-1) & 0xFFFF;
    K.w16(x+0x36, n);
    if (n == 0) { K.setState(x, 0xFDCC); }
  };
  // L_01FDCC: looking for a target in the enemy list $168D (bit 0 of +6 marks a taken one)
  C[0x01FDCC] = function (x) {
    if (K.r16(x+6) & 0x80) { L_01FEFD(x); return; }
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (offScreen(x)) { L_01FF6B(x); return; }
    K.addSprite(x, K.animFrame(x), 1, false);
    K.w16(0x42, 0);
    K.w16(0x42, 0);   // ($01:FE19: STZ $42 twice — $44 keeps its value)
    if (K.terrainHit(x)) { L_01FF0D(x, K.hitLayer); return; }
    K.shotBox(x, 0x100, 0xFFD9);
    var n = K.r16(0x168B);
    if (n == 0) { return; }
    for (var i = 0; i < n; i += 2) {
      var e = K.r16(0x168D+i);
      if (!(K.r16(e+6) & 1)) {
        K.w16(e+6, K.r16(e+6) | 1);
        K.w16(x+0x38, e);
        K.w16(x+0x32, 1);
        K.setState(x, 0xFE66);
        return;
      }
    }
  };
  // L_01FE66: homing — every second pass the direction turns towards the target, the speeds follow
  C[0x01FE66] = function (x) {
    if (K.r16(x+6) & 0x80) { L_01FEF1(x); return; }
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreen(x);
    if (offScreen(x)) { L_01FF5F(x); return; }
    K.addSprite(x, K.animFrame(x), 1, false);
    K.shotBox(x, 0x100, 0xFFD9);
    K.w16(0x42, 0);
    K.w16(0x42, 0);
    if (K.terrainHit(x)) { L_01FF01(x); return; }
    var target = K.r16(x+0x38);
    if (!(K.r16(target+6) & 1)) { K.setState(x, 0xFDCC); return; }
    var n = (K.r16(x+0x32)-1) & 0xFFFF;
    K.w16(x+0x32, n);
    if (n != 0) { return; }
    var dir = K.directionTo(x, target);
    K.turnTowards(x, dir);
    K.speedsByDirection(x, 0x879F);
    K.w16(x+0x32, 2);
  };
  /** `L_01FEF1` / `L_01FF01`: the target released; `L_01FEFD` / `L_01FF0D`: the burst on the layer */
  var L_01FEF1 = function (x) {
    var t = K.r16(x+0x38);
    K.w16(t+6, K.r16(t+6) & 0xFFFE);
    L_01FEFD(x);
  };
  var L_01FEFD = function (x) { L_01FF0D(x, K.r16(0x46)); };
  // ★ `L_01FF01` reaches `L_01FF0D` with Y = the target's node (`LDY $38,X` after the probe), so the burst
  // of a homing missile that hits the terrain is placed against the target's node as if it were a layer —
  // a slip of the original, kept (the burst's +$1E is the node and +$A..+$C follow its words)
  var L_01FF01 = function (x) {
    var t = K.r16(x+0x38);
    K.w16(t+6, K.r16(t+6) & 0xFFFE);
    L_01FF0D(x, t);
  };
  var L_01FF0D = function (x, layer) {
    K.w16(x+0x1E, layer);
    K.objectFromLayer(x, layer);
    K.w16(x+6, K.r16(x+6) | 0x80);
    K.w16(x+0x14, 0x9D16);
    K.w16(x+0x16, 0);
    K.setState(x, 0xFF30);
  };
  C[0x01FF30] = function (x) {
    K.objectScreenLayer(x);
    K.addSprite(x, K.animFrame(x), 1, false);
    var v = (K.r16(x+0x16)+0x80) & 0xFFFF;
    if (v < 0x300) {
      K.w16(x+0x16, v);
      return;
    }
    L_01FF74(x);
  };
  var L_01FF5F = function (x) {
    var t = K.r16(x+0x38);
    K.w16(t+6, K.r16(t+6) & 0xFFFE);
    L_01FF6B(x);
  };
  var L_01FF6B = function (x) {
    K.w16(x+6, K.r16(x+6) | 0x80);
    L_01FF74(x);
  };
  var L_01FF74 = function (x) {
    K.w16(0x1687, K.r16(0x1687)-1);
    K.setState(x, 0xFF80);
  };
  C[0x01FF80] = function (x) {
    if (!K.childrenDone(x)) { return; }
    K.setState(x, 0xFF9D);
  };
  C[0x01FF9D] = function (x) { K.kill(x); };

  // L_03D201: the missile's smoke — a child drawn behind the missile by its direction, until the missile is hit
  C[0x03D201] = function (x) {
    K.w16(x+0x20, 0);
    K.w8(x+0x18, K.acquirePaletteSlot(0x81));
    K.setState(x, 0xD21B);
  };
  C[0x03D21B] = function (x) {
    var y = K.r16(x+8);
    if (K.r16(y+6) & 0x80) { K.setState(x, 0xD25E); return; }
    var d = ((K.r8(y+0x17)+8) & 0xF) << 2;
    K.w16(x+0xB, K.d16(0x851F+d));
    K.w16(x+0x10, K.d16(0x8521+d));
    K.objectScreenParent(x);
    K.addSprite(x, (K.r16(0x50) & 4) ? 0xFE9C : 0xFEA1, 2, false);
  };
  C[0x03D25E] = function (x) { K.kill(x); };
} // installWeaponsCode

if (typeof globalThis !== 'undefined') { globalThis.installWeaponsCode = installWeaponsCode; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installWeaponsCode; }
