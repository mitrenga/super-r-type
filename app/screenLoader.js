const { SNESPPU } = await import('./svision/js/platform/canvas2D/snes/snesPPU.js?ver='+window.srcVersion);
// begin code

/**
 * One frame of the original, as `tools/mkscreen.py` recorded it, put into
 * the library's model of the chip: VRAM, CGRAM and OAM as the picture was
 * made of them, the registers as the program had written them at the top
 * of the frame, and the brightness writes the main loop made while the beam
 * ran, as line writes. Nothing here is drawn or made up — every byte comes
 * from the running original.
 *
 * ★ Measured by `tools/matchscreen.mjs`, which composes the frame with this
 * very loader and compares it with MesenCE's picture of it pixel by pixel.
 * In M1 the game screen (`app/levelModel.js`) shows `data/screen.json` this
 * way; from M2 the picture is built from the cartridge's data by the
 * original's code and this loader stays as the pixel-level measurement.
 *
 * ## Deliberately free of DOM
 *
 * The loader takes the parsed JSON, not a URL, so a tool under Node builds
 * the same frame the browser builds (R-001). Fetching is the caller's job.
 */
export class ScreenLoader {

  /**
   * Base64 to bytes, in the browser and under Node alike.
   * @param {string} text - Base64.
   * @returns {Uint8Array} The bytes.
   */
  static bytes(text) {
    var raw = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) {
      out[i] = raw.charCodeAt(i) & 0xFF;
    }
    return out;
  } // bytes

  /**
   * Writes the registers of a record the way the program writes them: one
   * byte a register, the scroll registers twice (low, then high).
   * @param {SNESPPU} ppu - The chip.
   * @param {Object} r - `registers` of the record.
   */
  static writeRegisters(ppu, r) {
    ppu.write(0x2100, r.inidisp);
    ppu.write(0x2101, r.obsel);
    ppu.write(0x2105, r.bgmode);
    ppu.write(0x2106, r.mosaic);
    for (var i = 0; i < 4; i++) {
      ppu.write(0x2107+i, r.bgsc[i]);
    }
    ppu.write(0x210B, r.bg12nba);
    ppu.write(0x210C, r.bg34nba);
    for (var l = 0; l < 4; l++) {
      ppu.write(0x210D+2*l, r.hofs[l] & 0xFF);
      ppu.write(0x210D+2*l, (r.hofs[l] >> 8) & 0x03);
      ppu.write(0x210E+2*l, r.vofs[l] & 0xFF);
      ppu.write(0x210E+2*l, (r.vofs[l] >> 8) & 0x03);
    }
    ppu.write(0x212C, r.tm);
    ppu.write(0x212D, r.ts);
    ppu.write(0x212E, r.tmw || 0);
    ppu.write(0x212F, r.tsw || 0);
    ppu.write(0x2130, r.cgwsel || 0);
    ppu.write(0x2131, r.cgadsub || 0);
    ppu.write(0x2133, r.setini || 0);
    if (r.oamPriority) {
      ppu.write(0x2103, 0x80);
    }
  } // writeRegisters

  /**
   * Puts a record into a chip: memory, registers, line writes.
   * @param {SNESPPU} ppu - The chip.
   * @param {Object} scene - The parsed `data/screen.json`.
   * @returns {SNESPPU} The chip.
   */
  static apply(ppu, scene) {
    ppu.vram.set(ScreenLoader.bytes(scene.vram), 0);
    ppu.cgram.set(ScreenLoader.bytes(scene.cgram), 0);
    ppu.oam.set(ScreenLoader.bytes(scene.oam), 0);
    ScreenLoader.writeRegisters(ppu, scene.registers);
    ppu.setLineWrites(scene.writes || []);
    return ppu.touch();
  } // apply

  /**
   * A fresh chip with the record in it.
   * @param {Object} scene - The parsed `data/screen.json`.
   * @returns {SNESPPU} The chip.
   */
  static build(scene) {
    return ScreenLoader.apply(new SNESPPU(), scene);
  } // build

} // ScreenLoader
