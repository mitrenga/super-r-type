// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The Force of Super R-Type — the root task `$16F9` (`$01:DE0E`-`$01:F21A`,
 * `sources/docs/disasm_notes.md` §9) carried over state by state onto
 * `app/ship.js`. The Force comes when `$1743` (its stage 1-3) is set: it
 * enters from the left, looks for the ship, aligns with it vertically,
 * docks at the front or the back (`$E55E`: wherever the ship's x lies),
 * leaves on A or R (`$E6B4` / `$E96B`), hugs the terrain it meets
 * (`$E72A` / `$E9DE`: probes ahead, behind, above and below), comes back
 * when called (`$EC23`). Its stage picks three handlers (`$04:B4AF`,
 * `$B4B5`, `$B4BB`: the tiles and the sprite of the pass, the shots) and,
 * docked, B fires the laser of `$1745` through `$04:B487` (front) or
 * `$B49B` (back) — the laser objects are `app/lasers.js`.
 *
 * ★ Every state's tests are the original's, in the original's order, with
 * the short gaps the surveys never ran decoded statically (`JMP`s to the
 * shared ends, marked ?). The variables: `$1739`-`$173D` the three tile
 * groups loaded, `$173F` / `$1741` the handlers, `$1743` the stage (bit 7
 * = handlers set), `$1745` the laser, `$1747` docked back (1) or front
 * (0), `$1749` moving up (1) or down (0), `$174B` moving right (1), left
 * ($FFFF) or not (0), `$15E5` the ship's x offset while the Force is in
 * front ($10), `$3C,X` bit 0 = called, `$3A,X` a wait, `$3E,X` shots out.
 *
 * Measured by `tools/matchship.mjs` (the `b` recordings of `traceship.py`).
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installForceCode(K) {
  var C = K.code;
  var shipX = function () { return K.r16(0x1594); };
  var shipY = function () { return K.r16(0x1599); };
  var aPressed = function () { return (K.r16(0x15CB) & 0x90) != 0; };
  var over = function () { return (K.r16(0x4A) & 0x40) != 0; };
  var box = function (x) { K.shotBox(x, 0x208, 0xB481); };
  var touch = function (x) { return K.touchesShip(x, 0xB47B, false); };
  var H = function (x) { K.forceHandler(x); };
  var ED72 = function () { K.forceLevelInit(); };
  var fire = function (x) { K.forceFire(x); };
  var ahead = function (x) { return K.forceProbe(x, true); };
  var behind = function (x) { return K.forceProbe(x, false); };
  var upFree = function (x) { return K.forceProbeUp(x); };
  var downFree = function (x) { return K.forceProbeDown(x); };
  var probeC4 = function (x) { return K.forceProbeC4(x); };
  var probeEF = function (x) { return K.forceProbeEF(x); };

  // ------------------------------------------------------------ the entry
  /** `L_01DE2F`: the Force is born at the left edge */
  K.forceStart = function (x) {
    var a = [0x1681, 0x1683, 0x15E7, 0x15E9, 0x15EB, 0x15ED, 0x15EF, 0x1675, 0x1677, 0x1679, 0x167B, 0x167D, 0x167F];
    for (var i = 0; i < a.length; i++) {
      K.w16(a[i], 0);
    }
    K.w16(x+0x3C, 0);
    K.w16(0x1747, 0);
    K.w16(0x1749, 0);
    K.w16(0x174B, 0);
    K.w16(x+0x3E, 0);
    K.w16(0x1743, K.r16(0x1743) & 0xFF7F);
    K.w16(x+0x20, 0);
    K.w16(x+0x22, 1);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w8(x+0x18, K.acquirePaletteSlot(0x81));
    L_01DE91(x);
  };
  var L_01DE91 = function (x) {
    K.w16(x+0xA, 0);
    K.w16(x+0xB, 0x1F0);
    K.w16(x+0xF, 0);
    K.w16(x+0x10, 0x270);
    L_01DEB9(x);
  };
  var L_01DEA5 = function (x) {
    K.w16(x+0xB, K.r16(x+0x1A)+0x200);
    K.w16(x+0x10, K.r16(x+0x1C)+0x200);
    L_01DEB9(x);
  };
  var L_01DEB9 = function (x) {
    K.w16(x+0xD, 0x80);
    K.w16(0x174B, 1);
    K.setState(x, 0xDECE);
  };
  var L_01DF9C = function (x) {
    K.w16(x+0xB, K.r16(x+0x1A)+0x200);
    K.w16(x+0x10, K.r16(x+0x1C)+0x200);
    L_01DFB0(x);
  };
  var L_01DFB0 = function (x) {
    K.w16(x+0xD, 0x80);
    K.w16(0x174B, 0xFFFF);
    K.setState(x, 0xDFC5);
  };
  var L_01DF29 = function (x) {
    K.w16(x+0xD, 0x80);
    K.w16(0x174B, 1);
    K.setState(x, 0xDF3E);
  };
  var L_01E020 = function (x) {
    K.w16(x+0xD, 0x80);
    K.w16(0x174B, 0xFFFF);
    K.setState(x, 0xE035);
  };
  var L_01E090 = function (x) { K.w16(0x174B, 0); K.setState(x, 0xE09C); };
  var L_01E105 = function (x) { K.w16(0x174B, 0); K.setState(x, 0xE111); };
  var L_01E17A = function (x) { K.w16(x+0x3A, 0x1E); K.w16(0x174B, 0); K.setState(x, 0xE18C); };
  var L_01E1E0 = function (x) { K.w16(x+0x12, 0x80); K.w16(0x174B, 0); K.w16(0x1749, 1); K.setState(x, 0xE1F8); };
  var L_01E273 = function (x) { K.w16(x+0x3A, 0x1E); K.w16(0x174B, 0); K.setState(x, 0xE285); };
  var L_01E2D9 = function (x) { K.w16(x+0x12, 0x80); K.w16(0x174B, 0); K.w16(0x1749, 0); K.setState(x, 0xE2EE); };
  var L_01E36C = function (x) { K.w16(x+0x3A, 0x1E); K.w16(0x174B, 0); K.setState(x, 0xE37E); };
  var L_01E3D2 = function (x) { K.w16(x+0x12, 0x80); K.w16(0x174B, 0); K.w16(0x1749, 1); K.setState(x, 0xE3EA); };
  var L_01E465 = function (x) { K.w16(x+0x3A, 0x1E); K.w16(0x174B, 0); K.setState(x, 0xE477); };
  var L_01E4CB = function (x) { K.w16(x+0x12, 0x80); K.w16(0x174B, 0); K.w16(0x1749, 0); K.setState(x, 0xE4E0); };
  var L_01ED3A = function (x) { K.setState(x, 0xED43); };

  /** the common tail of the free states: the handler, the box, the fire, the ship's touch (→ dock), A/R (→ call) */
  var tail = function (x) {
    H(x);
    box(x);
    fire(x);
    if (touch(x)) {
      L_01E55E(x);
      return true;
    }
    if (aPressed()) {
      L_01EC23(x);
      return true;
    }
    return false;
  };

  // ---------------------------------------------------- the free flight
  C[0x01DECE] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.moveX(x);
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (K.r16(x+0xB) < 0x240) { return; }
    if (shipX() >= 0x280) { L_01E090(x); return; }
    L_01DF29(x);
  };
  C[0x01DF3E] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.moveX(x);
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (K.r16(x+0xB) >= 0x2C0) { L_01E105(x); return; }
    if (shipX() >= 0x280) { L_01E020(x); return; }
  };
  C[0x01DFC5] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.moveXBack(x);
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = behind(x);
    if (p) { L_01E9DE(x, p); return; }
    if (K.r16(x+0xB) >= 0x2C0) { return; }
    if (shipX() >= 0x280) { L_01E020(x); return; }
    L_01E105(x);
  };
  C[0x01E035] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.moveXBack(x);
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = behind(x);
    if (p) { L_01E9DE(x, p); return; }
    if (K.r16(x+0xB) < 0x240) { L_01E090(x); return; }
    if (shipX() >= 0x280) { return; }
    L_01DF29(x);
  };
  // the Force stands right of the ship's half and looks for the ship's height
  C[0x01E09C] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    // ★ $01:E0E2: the ship still left of $280 — back to flying ahead ($E0E7 uncovered: JMP L_01DEB9)
    if (shipX() < 0x280) { L_01DEB9(x); return; }
    var y = K.r16(x+0x10), sy = shipY();
    if (sy >= y) {
      if (sy == y) { return; }
      L_01E273(x);
      return;
    }
    L_01E17A(x);
  };
  C[0x01E111] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() >= 0x280) { L_01E020(x); return; }
    var y = K.r16(x+0x10), sy = shipY();
    if (sy >= y) {
      if (sy == y) { return; }
      L_01E465(x);
      return;
    }
    L_01E36C(x);
  };
  // a wait of 30 passes before moving up (E18C/E37E) or down (E285/E477)
  C[0x01E18C] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() < 0x280) { L_01DF29(x); return; }
    var n = (K.r16(x+0x3A)-1) & 0xFFFF;
    K.w16(x+0x3A, n);
    if (n == 0) { L_01E1E0(x); }
  };
  C[0x01E285] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() < 0x280) { L_01DF29(x); return; }
    var n = (K.r16(x+0x3A)-1) & 0xFFFF;
    K.w16(x+0x3A, n);
    if (n == 0) { L_01E2D9(x); }
  };
  C[0x01E37E] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() >= 0x280) { L_01E020(x); return; }
    var n = (K.r16(x+0x3A)-1) & 0xFFFF;
    K.w16(x+0x3A, n);
    if (n == 0) { L_01E3D2(x); }
  };
  C[0x01E477] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreen(x);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() >= 0x280) { L_01E020(x); return; }
    var n = (K.r16(x+0x3A)-1) & 0xFFFF;
    K.w16(x+0x3A, n);
    if (n == 0) { L_01E4CB(x); }
  };
  /** moving up or down towards the ship's height, stopped by the terrain (the integer y put back) */
  var moveVertical = function (x, upwards, layer) {
    var y0 = K.r16(x+0x10);
    if (upwards) { K.moveYBack(x); } else { K.moveY(x); }
    if (layer) { K.objectScreenLayer(x); } else { K.objectScreen(x); }
    var blocked = upwards ? !upFree(x) : !downFree(x);
    if (blocked) {
      K.w16(x+0x10, y0);
      if (layer) { K.objectScreenLayer(x); } else { K.objectScreen(x); }
    }
  };
  C[0x01E1F8] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    moveVertical(x, true, false);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() < 0x280) { L_01DF29(x); return; }
    var y = K.r16(x+0x10), sy = shipY();
    if (sy == y) { L_01E090(x); return; }
    if (sy > y) { L_01E2D9(x); }
  };
  C[0x01E2EE] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    moveVertical(x, false, false);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() < 0x280) { L_01DF29(x); return; }
    var y = K.r16(x+0x10), sy = shipY();
    if (sy == y) { L_01E090(x); return; }
    if (sy < y) { L_01E1E0(x); }
  };
  C[0x01E3EA] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    moveVertical(x, true, false);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() >= 0x280) { L_01E020(x); return; }
    var y = K.r16(x+0x10), sy = shipY();
    if (sy == y) { L_01E105(x); return; }
    if (sy > y) { L_01E4CB(x); }
  };
  C[0x01E4E0] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    moveVertical(x, false, false);
    if (tail(x)) { return; }
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (shipX() >= 0x280) { L_01E020(x); return; }
    var y = K.r16(x+0x10), sy = shipY();
    if (sy == y) { L_01E105(x); return; }
    if (sy < y) { L_01E3D2(x); }
  };

  // ------------------------------------------------------------- docked
  /** `L_01E55E`: the touch — the position from the screen, a sound, docked in front of or behind the ship */
  var L_01E55E = function (x) {
    K.objectFromScreen(x);
    K.sound(3);
    K.w16(x+0x3C, K.r16(x+0x3C) & 0xFFFE);
    if (shipX() < K.r16(x+0xB)) {
      K.w16(0x1747, 0);
      K.w16(0x15E5, 0x10);
      K.setState(x, 0xE592);
      return;
    }
    K.w16(0x1747, 1);
    K.setState(x, 0xE610);
  };
  /** the laser handler of the docked Force on B: the stage's rows of `$04:B487` (front) / `$B49B` (back) */
  var laser = function (x, table) {
    if (!(K.r16(0x15CB) & 0x8000)) { return; }
    K.w16(0x42, 0);
    K.w16(0x44, 0);
    if (K.terrainHit(x)) { return; }
    var lvl = ((K.r16(0x1743) & 0x7F)-2) & 0xFFFF;
    if (lvl & 0x8000) { return; }
    var handler = K.d16(table+(((K.r16(0x1745) << 1)+lvl) << 1));
    K.laserHandler(x, handler);
  };
  C[0x01E592] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.w16(x+0xB, shipX()+0x13);
    K.w16(x+0x10, shipY());
    K.objectScreen(x);
    direction();
    H(x);
    box(x);
    if (aPressed()) { L_01E6B4(x); return; }
    laser(x, 0xB487);
  };
  C[0x01E610] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.w16(x+0xB, shipX()-0x13);
    K.w16(x+0x10, shipY());
    K.objectScreen(x);
    direction();
    H(x);
    box(x);
    if (aPressed()) { L_01E96B(x); return; }
    laser(x, 0xB49B);
  };
  /** `S_01E67F`: the joypad's directions into `$174B` (right 1, left $FFFF, else 0) and `$1749` (up 1, down 0) */
  var direction = function () {
    var joy = K.r16(0x15C9);
    K.w16(0x174B, (joy & 0x100) ? 1 : ((joy & 0x200) ? 0xFFFF : 0));
    if (joy & 0x800) {
      K.w16(0x1749, 1);
    } else if (joy & 0x400) {
      K.w16(0x1749, 0);
    }
  };
  /** `L_01E6B4`: leaving the front — a spark, forward at 8 px a pass */
  var L_01E6B4 = function (x) {
    K.w16(0x15E5, 0);
    K.w16(x+0xD, 0x800);
    K.w16(0x174B, 1);
    var y = K.spawn(x, 0x01B86E, 16);
    if (y >= 0) {
      K.w16(y+0xB, 0xFFF8);
      K.w16(y+0x10, 0);
      K.sound(4);
    }
    K.setState(x, 0xE6EE);
  };
  C[0x01E6EE] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.moveX(x);
    K.objectScreen(x);
    H(x);
    box(x);
    fire(x);
    var p = ahead(x);
    if (p) { L_01E72A(x, p); return; }
    if (K.r16(x+0xB) >= 0x2F0) { L_01DFB0(x); }
  };
  /** `L_01E96B`: leaving the back — a spark, backward at 8 px a pass */
  var L_01E96B = function (x) {
    K.w16(x+0xD, 0x800);
    K.w16(0x174B, 0xFFFF);
    var y = K.spawn(x, 0x01B879, 16);
    if (y >= 0) {
      K.w16(y+0xB, 8);
      K.w16(y+0x10, 0);
      K.sound(4);
    }
    K.setState(x, 0xE9A2);
  };
  C[0x01E9A2] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.moveXBack(x);
    K.objectScreen(x);
    H(x);
    box(x);
    fire(x);
    var p = behind(x);
    if (p) { L_01E9DE(x, p); return; }
    if (K.r16(x+0xB) < 0x210) { L_01DEB9(x); }
  };

  // ---------------------------------------------------- hugging the terrain
  /** `L_01E72A`: the terrain ahead (the probe's bits in A): bound to the layer; bit 4 = a wall ahead → back off */
  var L_01E72A = function (x, p) {
    K.w16(0, p);
    K.objectBindLayer(x);
    if (p & 0x10) {
      K.w16(x+0xD, 0x100);
      K.w16(0x174B, 0xFFFF);
      K.setState(x, 0xE74C);
      return;
    }
    L_01E798(x);
  };
  var L_01E798 = function (x) {
    K.w16(x+0x12, 0x100);
    if (K.r16(x+0x1C) < 0x70) { L_01E879(x); return; }
    K.setState(x, 0xE7B2);   // L_01E7A9
  };
  var L_01E879 = function (x) { K.setState(x, 0xE882); };
  /** the common tail while bound to the layer: off the layer's screen → born again at the left */
  var layerTail = function (x) {
    if (((K.r16(x+0x1A)+0x20) & 0xFFFF) >= 0x140) {
      L_01DE91(x);
      return true;
    }
    H(x);
    box(x);
    fire(x);
    if (touch(x)) {
      L_01E55E(x);
      return true;
    }
    return false;
  };
  C[0x01E74C] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.moveXBack(x);
    K.objectScreenLayer(x);
    if (layerTail(x)) { return; }
    if (ahead(x) & 0x10) { return; }
    L_01E798(x);
  };
  C[0x01E7B2] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreenLayer(x);
    if (layerTail(x)) { return; }
    if (!probeC4(x)) { L_01E879(x); return; }
    K.setState(x, 0xE802);
  };
  C[0x01E802] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    moveVertical(x, true, true);
    if (layerTail(x)) { return; }
    if (aPressed()) { L_01EC1F(x); return; }
    if (ahead(x) == 0) { L_01E946(x); return; }
    if (((K.r16(x+0x1A)+0x200) & 0xFFFF) >= 0x2C0) { L_01DF9C(x); }
  };
  C[0x01E882] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreenLayer(x);
    if (layerTail(x)) { return; }
    if (!probeEF(x)) { K.setState(x, 0xE8D2); return; }
    K.setState(x, 0xE7B2);   // L_01E7A9
  };
  C[0x01E8D2] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    moveVertical(x, false, true);
    if (layerTail(x)) { return; }
    if (aPressed()) { L_01EC1F(x); return; }
    if (ahead(x) == 0) { L_01E946(x); return; }
    if (((K.r16(x+0x1A)+0x200) & 0xFFFF) >= 0x2C0) { L_01DF9C(x); }
  };
  /** `L_01E946`: free of the terrain: back to the absolute position, called → return, else by the x */
  var L_01E946 = function (x) {
    K.objectFromScreen(x);
    if (K.r16(x+0x3C) & 1) { L_01EC23(x); return; }
    var px = K.r16(x+0xB);
    if (px < 0x240) { L_01DEB9(x); return; }
    if (px >= 0x2C0) { L_01DFB0(x); return; }
    L_01DF29(x);
  };
  /** `L_01E9DE`: the terrain behind */
  var L_01E9DE = function (x, p) {
    K.w16(0, p);
    K.objectBindLayer(x);
    if (p & 0x10) {
      K.w16(x+0xD, 0x100);
      K.w16(0x174B, 1);
      K.setState(x, 0xEA00);
      return;
    }
    L_01EA4C(x);
  };
  var L_01EA4C = function (x) {
    K.w16(x+0x12, 0x100);
    if (K.r16(x+0x1C) < 0x70) { K.setState(x, 0xEB36); return; }   // L_01EB2D
    K.setState(x, 0xEA66);   // L_01EA5D
  };
  C[0x01EA00] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.moveX(x);
    K.objectScreenLayer(x);
    if (layerTail(x)) { return; }
    if (behind(x) & 0x10) { return; }
    L_01EA4C(x);
  };
  C[0x01EA66] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreenLayer(x);
    if (layerTail(x)) { return; }
    if (!probeC4(x)) { K.setState(x, 0xEAB6); return; }   // L_01EAAD
    K.setState(x, 0xEB36);   // L_01EB2D
  };
  C[0x01EAB6] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    moveVertical(x, true, true);
    if (layerTail(x)) { return; }
    if (aPressed()) { L_01EC1F(x); return; }
    if (behind(x) == 0) { L_01EBFA(x); return; }
    if (((K.r16(x+0x1A)+0x200) & 0xFFFF) >= 0x240) { return; }
    L_01DEA5(x);
  };
  C[0x01EB36] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    K.objectScreenLayer(x);
    if (layerTail(x)) { return; }
    if (!probeEF(x)) { K.setState(x, 0xEA66); return; }   // L_01EA5D
    K.setState(x, 0xEB86);   // L_01EB7D
  };
  C[0x01EB86] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    moveVertical(x, false, true);
    if (layerTail(x)) { return; }
    if (aPressed()) { L_01EC1F(x); return; }
    if (behind(x) == 0) { L_01EBFA(x); return; }
    if (((K.r16(x+0x1A)+0x200) & 0xFFFF) >= 0x240) { return; }
    L_01DEA5(x);
  };
  var L_01EBFA = function (x) {
    K.objectFromScreen(x);
    if (K.r16(x+0x3C) & 1) { L_01EC23(x); return; }
    var px = K.r16(x+0xB);
    if (px < 0x240) { L_01DEB9(x); return; }
    if (px >= 0x2C0) { L_01DFB0(x); return; }
    L_01DF29(x);
  };

  // ------------------------------------------------------------ called
  var L_01EC1F = function (x) {
    K.objectFromScreen(x);
    L_01EC23(x);
  };
  /** `L_01EC23`: called back (or sent away): towards the ship at 1 px a pass on both axes */
  var L_01EC23 = function (x) {
    K.w16(x+0x3C, K.r16(x+0x3C) | 1);
    K.w16(x+0xD, 0x100);
    K.w16(x+0x12, 0x100);
    K.setState(x, 0xEC3E);
  };
  C[0x01EC3E] = function (x) {
    if (over()) { L_01ED3A(x); return; }
    ED72();
    var sy = shipY(), y = K.r16(x+0x10);
    var dir;
    if (sy < y) {
      moveVertical(x, true, false);
      dir = 1;
    } else if (sy == y) {
      dir = sy;   // ★ `LDA $1599; CMP; BEQ`: the ship's y itself goes into $1749
    } else {
      moveVertical(x, false, false);
      dir = 0;
    }
    K.w16(0x1749, dir);
    var sx = shipX(), px = K.r16(x+0xB);
    if (sx < px) {
      // L_01ED04: back towards the ship
      K.moveXBack(x);
      K.objectScreen(x);
      K.w16(0x174B, 0xFFFF);
      H(x);
      box(x);
      fire(x);
      if (touch(x)) { L_01E55E(x); return; }
      var pb = behind(x);
      if (pb) { L_01E9DE(x, pb); }
      return;
    }
    if (sx == px) {
      K.objectScreen(x);
      K.w16(0x174B, 0);
    } else {
      K.moveX(x);
      K.objectScreen(x);
      K.w16(0x174B, 1);
    }
    H(x);
    box(x);
    fire(x);
    if (touch(x)) { L_01E55E(x); return; }
    var pa = ahead(x);
    if (pa) { L_01E72A(x, pa); }
  };

  // --------------------------------------------------------------- the end
  C[0x01ED43] = function (x) {
    if (over()) {
      K.freePaletteSlot(K.r8(x+0x18));
      K.L_01ED62(x);
      return;
    }
    H(x);
    box(x);
  };

  // ----------------------------------------------------------- helpers
  /**
   * `S_01ED72`: the stage's handlers set once (`$1743` bit 7): `$173F` the
   * pass handler, `$1741` the shot launcher, and the stage's init — the
   * three tile groups of the Force into the buffer's slots 4, 6, 8.
   */
  K.forceLevelInit = function () {
    var v = K.r16(0x1743);
    if (v & 0x80) { return; }
    K.w16(0x1743, v | 0x80);
    var lvl = ((v & 0x7F)-1) & 0xFFFF;
    K.w16(0x173F, K.d16(0xB4B5+(lvl << 1)));
    K.w16(0x1741, K.d16(0xB4BB+(lvl << 1)));
    var x = 0x16F9;
    K.w16(x+0x16, 0);
    var tbl = K.forceTileTables(lvl, 0);
    K.forceTiles(0, tbl, true);
  };
  /** the three tile tables of a stage: by the stage and the direction ($174B) for stage 3 */
  K.forceTileTables = function (lvl, dir) {
    if (lvl == 0) { return [0xB3EB, 0xB3F7, 0xB403]; }
    if (lvl == 1) { return [0xB40F, 0xB41B, 0xB427]; }
    if (dir == 1) { return [0xB463, 0xB46B, 0xB473]; }
    if (dir == 0xFFFF) { return [0xB433, 0xB43B, 0xB443]; }
    return [0xB44B, 0xB453, 0xB45B];
  };
  /** the tile groups by index `y` (the phase's high byte, doubled): compared with `$1739`-`$173D`, loaded when they change */
  K.forceTiles = function (y, tbl, init) {
    var slots = [0x1739, 0x173B, 0x173D], buf = [4, 6, 8];
    for (var i = 0; i < 3; i++) {
      var tile = K.d16(tbl[i]+y);
      var cur = init ? 0xFFFF : K.r16(slots[i]);
      if (cur != tile) {
        K.w16(0, buf[i]);
        K.shipTileCopy(tile, true);
      }
      K.w16(slots[i], tile);
    }
  };
  /** `JMP ($173F)`: the stage's pass handler — the phase, the tiles, the sprite */
  K.forceHandler = function (x) {
    var h = K.r16(0x173F);
    var v = K.r16(x+0x16);
    var limit = (h == 0xEF8E) ? 0x400 : 0x600;
    if (K.r16(0x1749) == 0) {
      v = (v+0x20) & 0xFFFF;
      if (v >= limit) { v &= 0xFF; }
    } else {
      v = (v-0x20) & 0xFFFF;
      if (v >= limit) { v = (v & 0xFF) | (limit-0x100); }
    }
    K.w16(x+0x16, v);
    K.w16(0xF2, v);
    var y = ((v >> 8) & 0xFF) << 1;
    if (h == 0xEE7F) {
      K.forceTiles(y, [0xB3EB, 0xB3F7, 0xB403], false);
      K.addSprite(x, 0xB3B9, 1, true);
    } else if (h == 0xEF00) {
      K.forceTiles(y, [0xB40F, 0xB41B, 0xB427], false);
      K.addSprite(x, K.r16(0x1747) == 0 ? 0xB3B9 : 0xB3D2, 1, true);
    } else {
      K.forceTiles(y, K.forceTileTables(2, K.r16(0x174B)), false);
      K.addSprite(x, 0xB3B9, 1, true);
    }
  };
  /** `S_01F0B4`: B pressed with fewer than three shots out: the stage's launcher (`$1741`) spawns them */
  K.forceFire = function (x) {
    if (!(K.r16(0x15CB) & 0x8000)) { return; }
    if (K.r16(x+0x3E) >= 3) { return; }
    var h = K.r16(0x1741);
    var code = (h == 0xF0C9) ? 0x01B61A : (h == 0xF0D0) ? 0x01B627 : 0x01B63D;
    if (K.spawn(x, code, 8) >= 0) {
      K.w16(x+0x3E, K.r16(x+0x3E)+1);
    }
  };
  /**
   * `S_01F0E8` (ahead) / `S_01F134` (behind): four probes of the terrain
   * — 7 and 15 px (ahead) or −8 and −16 (behind) at the same height, and
   * −7 / +8 vertically: bits 1 (near), 2 (far), 8 (above), $10 (below).
   * ★ The near probe ahead sets bit $10 and the far one bit 4 (the
   * statically decoded gaps); behind, the near sets $10?, the far 4.
   */
  K.forceProbe = function (x, aheadOf) {
    var flags = 0;
    K.w16(0x44, 0);
    K.w16(0x42, aheadOf ? 7 : 0xFFF8);
    if (K.terrainHit(x)) { flags |= 0x10; }
    K.w16(0x42, aheadOf ? 0xF : 0xFFF0);
    if (K.terrainHit(x)) { flags |= 4; }
    K.w16(0x44, 0xFFF9);
    if (K.terrainHit(x)) { flags |= 8; }
    K.w16(0x44, 8);
    if (K.terrainHit(x)) { flags |= 2; }
    K.w16(4, flags);
    return flags;
  };
  /** `S_01F180`: free above? (three probes at −7, from −8 to +7 in x) — the carry: a hit */
  K.forceProbeUp = function (x) {
    K.w16(0x44, 0xFFF9);
    K.w16(0x42, 0xFFF8);
    if (K.terrainHit(x)) { return false; }
    K.w16(0x42, 0);
    if (K.terrainHit(x)) { return false; }
    K.w16(0x42, 7);
    return !K.terrainHit(x);
  };
  /** `S_01F1A2`: free below? (at +8) */
  K.forceProbeDown = function (x) {
    K.w16(0x44, 8);
    K.w16(0x42, 0xFFF8);
    if (K.terrainHit(x)) { return false; }
    K.w16(0x42, 0);
    if (K.terrainHit(x)) { return false; }
    K.w16(0x42, 7);
    return !K.terrainHit(x);
  };
  /**
   * `S_01F1C4`: the way up along the wall ahead — the carry set when the
   * near probe (7) hits; clear when the far one (15) misses; else the far
   * probe climbs 16 px at a time until it misses (carry clear) or y+off
   * falls under $200 (carry set).
   */
  K.forceProbeC4 = function (x) {
    K.w16(0x44, 0);
    K.w16(0x42, 7);
    if (K.terrainHit(x)) { return true; }
    for (;;) {
      K.w16(0x42, 0xF);
      if (!K.terrainHit(x)) { return false; }
      var v = (K.r16(0x44)-0x10) & 0xFFFF;
      K.w16(0x44, v);
      if (((v+K.r16(x+0x10)) & 0xFFFF) < 0x200) { return true; }
    }
  };
  /** `S_01F1EF`: the way down along the wall ahead, 16 px at a time down to y+off < $2E0 */
  K.forceProbeEF = function (x) {
    K.w16(0x44, 0);
    K.w16(0x42, 7);
    if (K.terrainHit(x)) { return true; }
    for (;;) {
      K.w16(0x42, 0xF);
      if (!K.terrainHit(x)) { return false; }
      var v = (K.r16(0x44)+0x10) & 0xFFFF;
      K.w16(0x44, v);
      if (((v+K.r16(x+0x10)) & 0xFFFF) >= 0x2E0) { return true; }
    }
  };
  /** the laser spawn handlers of `$04:B487` / `$B49B` by their address — `app/lasers.js` fills them */
  if (!K.laserHandlers) {
    K.laserHandlers = {};
  }
  K.laserHandler = function (x, addr) {
    var fn = K.laserHandlers[addr];
    if (!fn) {
      K.events.push({kind: 'unported', what: 'laser handler $01:'+addr.toString(16)});
      return;
    }
    fn.call(K, x);
  };

  // --------------------------------------------- the Force's own shots
  // L_01B61A / L_01B627 / L_01B63D: the launchers by stage — one straight shot, two diagonal, or four
  var launcher = function (x, shots) {
    for (var i = 0; i < shots.length; i++) {
      K.spawn(x, shots[i], 8);
    }
    // L_01B663: the launcher sits where its parent (the Force) is, and waits for the shots
    var y = K.r16(x+8);
    K.w16(x+0xB, K.r16(y+0x1A)+0x200);
    K.w16(x+0x10, K.r16(y+0x1C)+0x200);
    K.setState(x, 0xB685);
  };
  C[0x01B61A] = function (x) { launcher(x, [0x01B6B0]); };
  C[0x01B627] = function (x) { launcher(x, [0x01B714, 0x01B71C]); };
  C[0x01B63D] = function (x) { launcher(x, [0x01B714, 0x01B71C, 0x01B78B, 0x01B793]); };
  // L_01B714 / L_01B71C: the diagonal shots (y speed ±2), L_01B78B / L_01B793: the vertical ones (±10)
  var shot = function (x, speedY, meta, speedX) {
    K.w16(x+0x12, speedY);
    if (speedX !== undefined) {
      K.w16(x+0xD, speedX);
    }
    K.w16(x+0x30, meta);
    var y = K.r16(x+8);
    K.w16(x+0xB, K.r16(y+0xB));
    K.w16(x+0x10, K.r16(y+0x10));
    K.w16(x+0x20, 0);
    K.w16(x+0x22, 1);
    K.w16(x+0x24, 0);
    K.w16(x+6, K.r16(x+6) & 0xFF7F);
    K.w8(x+0x18, K.acquirePaletteSlot(0x80));
  };
  C[0x01B714] = function (x) { shot(x, 0x200, 0x9D07, 0xA00); K.setState(x, 0xB76A); };
  C[0x01B71C] = function (x) { shot(x, 0xFE00, 0x9D02, 0xA00); K.setState(x, 0xB76A); };
  C[0x01B76A] = function (x) {
    if (K.r16(x+6) & 0x80) { K.setState(x, 0xB85F); return; }
    K.moveXSigned(x);
    if (K.r16(x+0xB) >= 0x320) { K.setState(x, 0xB85F); return; }
    K.moveYSigned(x);
    K.shotFlight(x);   // L_01B7F7
  };
  C[0x01B78B] = function (x) { shot(x, 0xA00, 0x9D11); K.setState(x, 0xB7DB); };
  C[0x01B793] = function (x) { shot(x, 0xF600, 0x9D0C); K.setState(x, 0xB7DB); };
  C[0x01B7DB] = function (x) {
    if (K.r16(x+6) & 0x80) { K.setState(x, 0xB85F); return; }
    K.moveYSigned(x);
    var y = K.r16(x+0x10);
    if (y < 0x1F0 || y >= 0x2F0) { K.setState(x, 0xB85F); return; }
    K.shotFlight(x);
  };
  /** `L_01B7F7`: the flight of a Force shot — the sprite of +$30, the box, the terrain */
  K.shotFlight = function (x) {
    K.objectScreen(x);
    K.addSprite(x, K.r16(x+0x30), 1, false);
    K.w16(0x42, 0);
    K.w16(0x44, 0);
    if (!K.terrainHit(x)) {
      K.shotBox(x, 0x100, 0x9D2B);
      return;
    }
    K.w16(x+0x14, 0x9D16);
    K.w16(x+0x16, 0);
    K.setState(x, 0xB829);
  };
} // installForceCode

if (typeof globalThis !== 'undefined') { globalThis.installForceCode = installForceCode; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installForceCode; }
