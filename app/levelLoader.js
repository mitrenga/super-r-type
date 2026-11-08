const { SNESPPU } = await import('./svision/js/platform/canvas2D/snes/snesPPU.js?ver='+window.srcVersion);
// begin code

/**
 * The worker's frame into the library's chip: what the original's NMI
 * writes every frame — the DMA of the OAM shadow and the CGRAM shadow, the
 * ship's tile buffer and the panel line by the `$4C` bits, the queued map
 * blocks or the sprite groups or the NMI job's words (the texts, the map
 * clear), the scroll registers — and what the section's load does in the
 * pass (`S_008B18` the background tiles, the font and the common sprite
 * set, the brightness and the mosaic). `app/gameWorker.js` computes it with
 * the original's code, `WORKER-PROTOCOL.md` carries it. The data are
 * `data/tiles.json` (`tools/dumptiles.py`), every byte of them the ROM's;
 * the palettes come as the CGRAM shadow the game keeps (`$7E:2F60`), so
 * `data/palettes.json` is the worker's.
 *
 * Free of DOM: a tool under Node builds the same chip (R-001). The
 * registers of the picture (mode 1, the map and tile bases, the layers)
 * come from the frame `tools/mkscreen.py` recorded — ★ the values the
 * program writes at reset — through `ScreenLoader.writeRegisters`.
 *
 * The attract mode of the menu (M2) still loads a section's tiles and
 * palettes at once (`loadSection`) and takes the map blocks and the
 * registers of its frames.
 */
export class LevelLoader {

  /** VRAM byte address of the common sprite set's and the dynamic slots' area, where the launch set went too */
  static get OBJ_VRAM() { return 0x6000; }

  static bytes(text) {
    var raw = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) {
      out[i] = raw.charCodeAt(i) & 0xFF;
    }
    return out;
  } // bytes

  /**
   * A 32-byte palette of bank $05 into a CGRAM row.
   * @param {SNESPPU} ppu - The chip.
   * @param {number} row - 0-15.
   * @param {Array} colours - 16 BGR555 words.
   */
  static writePalette(ppu, row, colours) {
    for (var c = 0; c < 16; c++) {
      ppu.cgram[row*32+2*c] = colours[c] & 0xFF;
      ppu.cgram[row*32+2*c+1] = (colours[c] >> 8) & 0xFF;
    }
  } // writePalette

  /**
   * ★ `S_008B18` part 1: a section's background tile set into VRAM.
   * @param {SNESPPU} ppu - The chip.
   * @param {number|string} tileSet - The set (a key of `tiles.bg`).
   * @param {Object} tiles - Parsed `data/tiles.json`.
   */
  static loadBgTiles(ppu, tileSet, tiles) {
    var bg = tiles.bg[String(tileSet)];
    if (bg) {
      ppu.vram.set(LevelLoader.bytes(bg.data), bg.vram*2);
    }
  } // loadBgTiles

  /**
   * ★ `S_008B18` part 2: the font and the common sprite set into VRAM.
   * @param {SNESPPU} ppu - The chip.
   * @param {Object} tiles - Parsed `data/tiles.json`.
   */
  static loadCommonTiles(ppu, tiles) {
    ppu.vram.set(LevelLoader.bytes(tiles.font.data), tiles.font.vram*2);
    ppu.vram.set(LevelLoader.bytes(tiles.obj.common.data), tiles.obj.common.vram*2);
  } // loadCommonTiles

  /**
   * The start of a section in the attract mode: its background tiles, the
   * font, the common sprite set and its palette sets. The maps are left as
   * they are — the original does not clear them either; the fill of the
   * first columns comes through the frames.
   * @param {SNESPPU} ppu - The chip.
   * @param {Object} start - The worker's `sectionStart`: {section, tileSet, paletteSets}.
   * @param {Object} tiles - Parsed `data/tiles.json`.
   * @param {Object} palettes - Parsed `data/palettes.json`.
   */
  static loadSection(ppu, start, tiles, palettes) {
    LevelLoader.loadBgTiles(ppu, start.tileSet, tiles);
    LevelLoader.loadCommonTiles(ppu, tiles);
    var sets = start.paletteSets;
    var row;
    for (row = 0; row < 8; row++) {
      if (sets.bg[row] !== null && palettes.palettes[String(sets.bg[row])]) {
        LevelLoader.writePalette(ppu, row, palettes.palettes[String(sets.bg[row])]);
      }
      if (sets.obj[row] !== null && palettes.palettes[String(sets.obj[row])]) {
        LevelLoader.writePalette(ppu, 8+row, palettes.palettes[String(sets.obj[row])]);
      }
    }
  } // loadSection

  /**
   * Words into VRAM at a word address.
   * @param {SNESPPU} ppu - The chip.
   * @param {number} vaddr - The word address.
   * @param {Array|Uint16Array} words - The words.
   * @param {number} [from] - The first word of `words` to take.
   * @param {number} [count] - How many.
   */
  static writeWords(ppu, vaddr, words, from, count) {
    from = from || 0;
    count = count === undefined ? words.length-from : count;
    for (var i = 0; i < count; i++) {
      var a = ((vaddr+i) & 0x7FFF)*2;
      ppu.vram[a] = words[from+i] & 0xFF;
      ppu.vram[a+1] = (words[from+i] >> 8) & 0xFF;
    }
  } // writeWords

  /**
   * One frame's writes of the NMI (and of the pass before it). A lag frame
   * wrote nothing — the picture stands.
   * @param {SNESPPU} ppu - The chip.
   * @param {Object} frame - The worker's frame (`WORKER-PROTOCOL.md`).
   * @param {Object} [tiles] - Parsed `data/tiles.json`, for the `bgTiles` / `commonTiles` events.
   */
  static applyFrame(ppu, frame, tiles) {
    if (frame.lag) {
      return;
    }
    var i;
    var events = frame.events || [];
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.kind) {
        case 'bgTiles':
          if (tiles && e.tileSet !== null) {
            LevelLoader.loadBgTiles(ppu, e.tileSet, tiles);
          }
          break;
        case 'commonTiles':
          if (tiles) {
            LevelLoader.loadCommonTiles(ppu, tiles);
          }
          break;
        case 'inidisp':
          ppu.write(0x2100, e.value);
          break;
        case 'mosaic':
          ppu.write(0x2106, e.value);
          break;
      }
    }
    var writes = frame.writes || [];
    for (i = 0; i < writes.length; i++) {
      var w = writes[i];
      if (w.text) {
        // an NMI job's text: single words at their addresses
        for (var t = 0; t < w.text.length; t++) {
          LevelLoader.writeWords(ppu, w.text[t].vaddr, [w.text[t].word]);
        }
      } else if (w.fill !== undefined) {
        // the map clear: `count` words of `fill`
        for (var f = 0; f < w.count; f++) {
          LevelLoader.writeWords(ppu, w.vaddr+f, [w.fill]);
        }
      } else {
        // a map block: 4 rows of 4 words, 32 words a row
        for (var r = 0; r < 4; r++) {
          LevelLoader.writeWords(ppu, w.vaddr+r*32, w.words, r*4, 4);
        }
      }
    }
    var groups = frame.groups || [];
    for (i = 0; i < groups.length; i++) {
      // ★ `nmi_upload_sprite_groups`: the two rows of a 16×16 group, 32 words at the address and 32 at +$100
      LevelLoader.writeWords(ppu, groups[i].vaddr, groups[i].words, 0, 32);
      LevelLoader.writeWords(ppu, groups[i].vaddr+0x100, groups[i].words, 32, 32);
    }
    if (frame.shipTiles) {
      ppu.vram.set(frame.shipTiles, frame.shipTilesVram*2);
    }
    if (frame.panelLine) {
      ppu.vram.set(frame.panelLine, frame.panelVram*2);
    }
    if (frame.oam) {
      ppu.oam.set(frame.oam);
    }
    if (frame.cgram) {
      ppu.cgram.set(frame.cgram);
    }
    if (frame.regs) {
      for (var l = 0; l < 2; l++) {
        ppu.write(0x210D+2*l, frame.regs.hofs[l] & 0xFF);
        ppu.write(0x210D+2*l, (frame.regs.hofs[l] >> 8) & 0x03);
        ppu.write(0x210E+2*l, frame.regs.vofs[l] & 0xFF);
        ppu.write(0x210E+2*l, (frame.regs.vofs[l] >> 8) & 0x03);
      }
    }
  } // applyFrame

  /**
   * No sprites: every OAM entry hidden the way `oam_hide_unused` and the
   * high table's $01 hide them (X = 1 with the ninth bit, Y = $FF).
   * @param {SNESPPU} ppu - The chip.
   */
  static hideSprites(ppu) {
    for (var i = 0; i < 128; i++) {
      ppu.oam[4*i] = 0x01;
      ppu.oam[4*i+1] = 0xFF;
      ppu.oam[4*i+2] = 0;
      ppu.oam[4*i+3] = 0;
    }
    for (var h = 0; h < 32; h++) {
      ppu.oam[0x200+h] = 0x55;
    }
  } // hideSprites

} // LevelLoader
