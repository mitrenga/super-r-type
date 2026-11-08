// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The sprites of Super R-Type's objects as OAM, the way the original
 * builds them every pass (`S_0098F2`, `draw_object_sprites` `$00:99F3`,
 * `S_009ACE`, `oam_hide_unused`, `oam_pack_high_table` — names in
 * `sources/docs/disasm_notes.md` §3 and §8; the records in
 * `data/sprites.json` from `tools/dumpsprites.py`).
 *
 * An object carries X, Y, a **metasprite** (a record of parts: dx, dy and
 * a tile word), an attribute word whose high byte gives the palette and
 * priority bits, and — when its tiles were loaded into a dynamic slot —
 * a **slot table** that maps the low tile byte onto the slot the tiles
 * went to. The OAM shadow `$7E:2200` is filled **from the end**: the index
 * starts at 508 and steps down 4 a sprite, so the first object drawn gets
 * the last OAM entry; group 1 (`$28A0`-`$2AE0`) goes first, then group 2
 * (`$2AE0`-`$2F60`), and when the previous frame overflowed (*time over*
 * in `STAT77`) and the pass is odd, group 2 is drawn **backwards** — that
 * is the flicker. A part is skipped when it lies left of −32, right of 256,
 * above −32 or below 224, or when the OAM is full. The high table
 * (`$2420`, one byte a sprite: bit 0 the X sign, bit 1 the size from bit 9
 * of the tile word) is packed four to a byte into `$2400`. Unused entries
 * get X = 1, Y = $FF and the high byte $01 (X ≥ 256: off screen).
 *
 * Measured by `tools/matchsprites.mjs` against the OAM shadow of the
 * running original, byte for byte, from the objects it drew.
 */
class ObjectSprites {

  /**
   * @param {Object} sprites - Parsed `data/sprites.json`.
   */
  constructor(sprites) {
    this.sprites = sprites;
    /** the OAM shadow `$7E:2200` (512 B) and the packed high table `$2400` (32 B) */
    this.oam = new Uint8Array(544);
    /** the unpacked high table `$2420`, one byte a sprite */
    this.high = new Uint8Array(128);
    /** `$7E`: the byte index of the next OAM entry, 508 down to −4 */
    this.index = 0;
  } // constructor

  /** `$00:990A`: the first OAM entry written is the last one, `$7E` = $1FC */
  static get FIRST_INDEX() { return 0x1FC; }

  /**
   * A metasprite record by its address in bank $04.
   * @param {number} address - 24-bit address.
   * @returns {Object|null} The record.
   */
  record(address) {
    return this.sprites.records[String(address)] || null;
  } // record

  /**
   * `S_0098F2` up to the drawing: the high table is filled with $01 (X ≥
   * 256) and the index set.
   */
  begin() {
    this.high.fill(0x01);
    this.index = ObjectSprites.FIRST_INDEX;
  } // begin

  /**
   * `draw_object_sprites`: one object's parts into the OAM.
   * @param {Object} obj - {x, y, metasprite (24-bit address), attr (word), slots (Uint8Array|null)}.
   */
  drawObject(obj) {
    var rec = this.record(obj.metasprite);
    if (!rec) {
      return;
    }
    for (var i = 0; i < rec.parts.length; i++) {
      var p = rec.parts[i];
      this.drawPart((obj.x+p.dx) & 0xFFFF, (obj.y+p.dy) & 0xFFFF, p.tile, obj.attr, obj.slots);
    }
  } // drawObject

  /**
   * `S_009ACE`: one 16×16 (or 8×8) sprite into the next OAM entry, unless
   * it lies off the picture or the OAM is full.
   * @param {number} x - 16-bit x (two's complement).
   * @param {number} y - 16-bit y.
   * @param {number} tile - The tile word of the part.
   * @param {number} attr - The object's attribute word.
   * @param {Uint8Array|null} slots - The object's slot table, or null.
   */
  drawPart(x, y, tile, attr, slots) {
    if (this.index >= 0x200) {
      return;
    }
    var high = 0;
    if (x & 0x8000) {
      if (x < 0xFFE0) {
        return;
      }
      high = 1;
    } else if (x >= 0x100) {
      return;
    }
    if (y & 0x8000) {
      if (y < 0xFFE0) {
        return;
      }
    } else if (y >= 0xE0) {
      return;
    }
    var word = tile;
    if (slots) {
      word = (tile & 0xFF00) | slots[tile & 0xFF];
    }
    high |= (word >> 8) & 0x02;
    var hiByte = ((word >> 8) & 0xF1) | ((attr >> 8) & 0xFF);
    var i = this.index;
    this.oam[i] = x & 0xFF;
    this.oam[i+1] = y & 0xFF;
    this.oam[i+2] = word & 0xFF;
    this.oam[i+3] = hiByte;
    this.high[i >> 2] = high;
    this.index -= 4;
  } // drawPart

  /**
   * `S_0098F2`: a whole pass — group 1 in order, group 2 in order or
   * backwards when the last frame overflowed and the pass is odd, the
   * rest hidden, the high table packed.
   * @param {Array} group1 - Objects of group 1 in list order.
   * @param {Array} group2 - Objects of group 2 in list order.
   * @param {boolean} timeOver - Bit 7 of `STAT77` of the last frame (`$F4`).
   * @param {number} pass - The pass counter `$50`.
   * @returns {boolean} True when objects were drawn (`$7E` set); false for the empty pass.
   */
  drawPass(group1, group2, timeOver, pass) {
    var i;
    if (group1.length+group2.length == 0) {
      // L_0099CF: nothing to draw — every entry's X and Y hidden (the tile bytes stay), the
      // high table all $5555 (X ≥ 256); `$7E` and the unpacked table are not touched
      for (i = 0; i < 0x200; i += 4) {
        this.oam[i] = 0x01;
        this.oam[i+1] = 0xFF;
      }
      for (i = 0; i < 32; i++) {
        this.oam[0x200+i] = 0x55;
      }
      return false;
    }
    this.begin();
    for (i = 0; i < group1.length; i++) {
      this.drawObject(group1[i]);
    }
    if (timeOver && (pass & 1)) {
      for (i = group2.length-1; i >= 0; i--) {
        this.drawObject(group2[i]);
      }
    } else {
      for (i = 0; i < group2.length; i++) {
        this.drawObject(group2[i]);
      }
    }
    this.hideUnused();
    this.pack();
    return true;
  } // drawPass

  /** `oam_hide_unused`: X = 1, Y = $FF for every entry not drawn */
  hideUnused() {
    for (var i = this.index; i >= 0 && i < 0x200; i -= 4) {
      this.oam[i] = 0x01;
      this.oam[i+1] = 0xFF;
    }
  } // hideUnused

  /** `oam_pack_high_table`: four 2-bit entries a byte into `$2400` */
  pack() {
    for (var i = 0; i < 32; i++) {
      this.oam[0x200+i] = (this.high[4*i] & 3) | ((this.high[4*i+1] & 3) << 2)
                          | ((this.high[4*i+2] & 3) << 4) | ((this.high[4*i+3] & 3) << 6);
    }
  } // pack

} // ObjectSprites

if (typeof self !== 'undefined') { self.ObjectSprites = ObjectSprites; }
if (typeof module !== 'undefined' && module.exports) { module.exports = ObjectSprites; }
