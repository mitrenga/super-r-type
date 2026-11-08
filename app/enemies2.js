// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The enemies of Super R-Type, second part — the objects of bank `$02`
 * of levels 3 to 7 (the divers, the walkers, the linked walkers, the
 * turrets of the later levels), carried over state by state onto the
 * kernel of `app/gameKernel.js` exactly as `app/enemies.js` carries the
 * first part; the conventions, the marks and the measure are the same
 * (`tools/matchenemies.mjs`). `installEnemyCode` calls this when it is
 * loaded.
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installEnemyCode2(K) {
  var C = K.code;
  /** `JML task_kill` */
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };
  /** `LDA $2D,X; AND #$FF; CLC; ADC #tbl; TAY; LDA $0,Y`: the frame the script's prefix byte names in table `tbl` */
  var prefixFrame = function (x, tbl) { return K.d16(tbl+K.r8(x+0x2D)); };

  // ============================================================ the diver of level 3 ($02:CA6F)
  // L_02CA6F: follows its script in (+$30 bit 1: the mirrored kind from the right, $CC9B), dives at the ship
  // when it is near — down or up by where the ship is — and leaves by a second script. Hit: tumbles off
  // with the speeds of its frame ($E064/$E074), trailing smoke ($CF0C).
  C[0x02CA6F] = function (x) {
    K.slotsOf(x, 0x1E);
    K.body(x, 1);
    K.pal(x, 0xB0);
    K.scriptStart(x, 0x200, K.d16(0xE090+2*K.r16(x+0x30)));
    K.setState(x, (K.r16(x+0x30) & 2) ? 0xCC9B : 0xCABD);   // ? $02:CAB1 `JMP $CC92`
  };
  /** the scripted flight (states $CABD, $CC39, $CC9B, $CE0B): false when the object is gone */
  var diverScripted = function (x) {
    K.listAdd(x);
    K.scriptStep(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x20, 0x140)) { L_02CF70(x); return false; }
    K.touchesShip(x, 0xE08A, true);
    K.addSprite(x, prefixFrame(x, 0xE04A), 2, true);
    if (probe(x, 0, 0)) { L_02CF65(x); return false; }
    if (K.hit(x, 0xE084)) { L_02CE61(x); return false; }
    return true;
  };
  C[0x02CABD] = function (x) {
    if (!diverScripted(x)) { return; }
    if (((K.r16(x+0x1A)-0x60) & 0xFFFF) >= shipX()) { return; }
    // L_02CB22: the dive
    K.w16(x+0xD, 0x169);
    K.w16(x+0x12, 0x169);
    if (K.r16(x+0x1C) < shipY()) {
      K.w16(x+0x14, 0xDFC9);
      K.w8(x+0x2D, 6);
      K.setState(x, 0xCB4C);
    } else {
      // L_02CBA9
      K.w16(x+0x14, 0xDFAF);
      K.w8(x+0x2D, 0xA);
      K.setState(x, 0xCBBF);
    }
  };
  /** the dive (states $CB4C, $CBBF, $CD24, $CD91): false when the object is gone */
  var diverDive = function (x, forward, down, meta, touchFirst) {
    K.listAdd(x);
    if (forward) { K.moveX(x); } else { K.moveXBack(x); }
    if (down) { K.moveY(x); } else { K.moveYBack(x); }
    K.objectScreenLayer(x);
    if (touchFirst) { K.touchesShip(x, 0xE08A, true); }
    if (K.offRight(x, 0x20, 0x140)) { L_02CF70(x); return false; }
    if (!touchFirst) { K.touchesShip(x, 0xE08A, true); }
    K.addSprite(x, meta, 2, true);
    if (probe(x, 0, 0)) { L_02CF65(x); return false; }
    if (K.hit(x, 0xE084)) { L_02CE61(x); return false; }
    return true;
  };
  C[0x02CB4C] = function (x) {
    if (!diverDive(x, false, true, K.r16(x+0x14), false)) { return; }
    if (K.r16(x+0x1C) >= shipY()) { L_02CC19(x); }
  };
  C[0x02CBBF] = function (x) {
    if (!diverDive(x, false, false, K.r16(x+0x14), true)) { return; }
    if (K.r16(x+0x1C) < shipY()) { L_02CC19(x); }
  };
  var L_02CC19 = function (x) {
    K.scriptStart(x, 0x200, K.r16(x+0x1C) < 0x78 ? 0xAC6C : 0xAC77);
    K.setState(x, 0xCC39);
  };
  C[0x02CC39] = function (x) { diverScripted(x); };
  // ? $02:CC9B-$02:CE60: the mirrored kind, read statically — the same with x and the direction turned
  C[0x02CC9B] = function (x) {
    if (!diverScripted(x)) { return; }
    if (((K.r16(x+0x1A)+0x60) & 0xFFFF) < shipX()) { return; }
    K.w16(x+0xD, 0x169);
    K.w16(x+0x12, 0x169);
    if (K.r16(x+0x1C) < shipY()) {
      K.w8(x+0x2D, 2);
      K.setState(x, 0xCD24);
    } else {
      K.w8(x+0x2D, 0xE);
      K.setState(x, 0xCD91);
    }
  };
  C[0x02CD24] = function (x) {
    if (!diverDive(x, true, true, 0xDFD6, false)) { return; }
    if (K.r16(x+0x1C) >= shipY()) { L_02CDEB(x); }
  };
  C[0x02CD91] = function (x) {
    if (!diverDive(x, true, false, 0xDFBC, true)) { return; }
    if (K.r16(x+0x1C) < shipY()) { L_02CDEB(x); }
  };
  var L_02CDEB = function (x) {
    K.scriptStart(x, 0x200, K.r16(x+0x1C) < 0x78 ? 0xAC86 : 0xAC91);
    K.setState(x, 0xCE0B);
  };
  C[0x02CE0B] = function (x) { diverScripted(x); };
  // L_02CE61: hit — tumbles off with the speeds of its frame (`LDY $2D,X` reads the prefix and the speed's low byte)
  var L_02CE61 = function (x) {
    K.w16(x+6, K.r16(x+6) & 0xFFFE);
    K.scoreAdd(2);
    K.sound(0x28);
    K.w16(x+0x14, prefixFrame(x, 0xE04A));
    var i = K.r16(x+0x2D);
    K.w16(x+0xD, K.d16(0xE064+i));
    K.w16(x+0x12, K.d16(0xE074+i));
    K.w16(x+0x36, 1);
    K.setState(x, 0xCEA7);
  };
  C[0x02CEA7] = function (x) {
    K.moveXSigned(x);
    K.moveYSigned(x);
    K.objectScreenLayer(x);
    if (K.offRight(x, 0x20, 0x140)) { L_02CF70(x); return; }
    K.touchesShip(x, 0xE08A, true);
    K.addSprite(x, K.r16(x+0x14), 2, true);
    K.w16(x+0x36, K.r16(x+0x36)-1);
    if (K.r16(x+0x36) == 0) {
      var y = K.spawn(0x17FB, 0x02CF0C, 16);
      if (y >= 0) {
        K.w16(y+0x1E, K.r16(x+0x1E));
        K.w16(y+0xB, K.r16(x+0xB));
        K.w16(y+0x10, K.r16(x+0x10));
        K.w16(x+0x36, 4);
      }
    }
    if (probe(x, 0, 0)) { L_02CF65(x); }
  };
  // L_02CF0C: a puff of smoke behind the tumbling diver
  C[0x02CF0C] = function (x) {
    K.w16(x+0x14, 0xE05A);
    K.w16(x+0x16, 0);
    K.slotsOf(x, 0x1E);
    K.pal(x, 0xB0);
    K.setState(x, 0xCF36);
  };
  C[0x02CF36] = function (x) {
    K.objectScreenLayer(x);
    K.drawAnim(x, 2, true);
    if (K.phaseEnd(x, 0x60, 0x500)) { L_02CF70(x); }
  };
  var L_02CF65 = function (x) {
    K.explode(x, EXPLODE_BIG, true);
    K.sound(0x16);
    L_02CF70(x);
  };
  var L_02CF70 = function (x) { K.setState(x, 0xCF77); };
  C[0x02CF77] = kill;

  if (typeof installEnemyCode3 === 'function') {
    installEnemyCode3(K);
  }
}

if (typeof globalThis !== 'undefined') { globalThis.installEnemyCode2 = installEnemyCode2; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installEnemyCode2; }
