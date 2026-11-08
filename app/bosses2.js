// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The bosses of Super R-Type, second part — the bosses of levels 3 and 4 (bank `$08`: `$96DF` family, `$9FBB`, `$A049`, `$A128`, `$A207`; `$ACBF`).
 * Carried over state by state onto the kernel of `app/gameKernel.js` with
 * the conventions, the marks and the measure of `app/enemies.js`
 * (`tools/matchenemies.mjs`).
 *
 * @param {Ship} K - The game (installs into its code table).
 */
function installBossCode2(K) {
  var C = K.code;
  /** `JML task_kill` */
  var kill = function (x) { K.kill(x); };
  var EXPLODE = 0x03D0E4, EXPLODE_BIG = 0x03D1A4, EXPLODE_AT = 0x03D08F, EXPLODE_SMALL = 0x03D144;
  var SHIP = 0x1589;
  var shipX = function () { return K.r16(0x15A3); };
  var shipY = function () { return K.r16(0x15A5); };
  var probe = function (x, dx, dy) { K.w16(0x42, dx & 0xFFFF); K.w16(0x44, dy & 0xFFFF); return K.terrainHit(x); };

  // (the objects go here)

  if (typeof installBossCode3 === 'function') {
    installBossCode3(K);
  }
}

if (typeof globalThis !== 'undefined') { globalThis.installBossCode2 = installBossCode2; }
if (typeof module !== 'undefined' && module.exports) { module.exports = installBossCode2; }
