#!/usr/bin/env python3
"""dumplevels — the 18 sections of Super R-Type (US) out of the cartridge.

★ Formats in `srtlib.py` (read from `S_008B4D`, `S_008BC3`, `L_008C70`,
`L_008E69`, `map_enqueue_a`, `S_00924E`, `$08:81D0`). For every section:
the level record, the scene table with the layers' kinds, start positions
and scripts, the two **map streams** (columns of metatile references), the
**metatiles** the streams use (16 tile words and 16 collision nibbles each,
by address in the level's bank), the spawn list (the waves — `waves.json`
is `dumpwaves.py`'s view of the same list with the code names), the tile
set and the palette sets.

How long is a stream? The record does not say. A layer's position never
passes its `maxPosition` (`L_008E30`), so the last column the original can
draw is `((maxPosition - 512) >> 5) + 9` (`L_00909E`) — `columnsNeeded`
(BG2 of a level is two short of it, BG2 of section 9 exactly it — what the
scroll really reaches is for `matchlevels` to show); the stream is
dumped up to the next data block of the bank (`columnsAvailable`) or up to
`columnsNeeded` where that is more (★ section 3's BG1 stream is 12 columns
and the scroll draws 14: the original reads on into the data that follows,
so those columns are the bytes there), and `tools/matchlevels.mjs` is what
proves the picture, not this count.

Output `data/levels.json` (compact: ~400 KB). `app/levelScroll.js` builds
the VRAM map from it with the original's routines.

    ./tools/dumplevels.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import srtlib as L  # noqa: E402


def known_pointers(rom, sections):
    """Every data address this dumper knows per bank — to bound the streams."""
    ptrs = {}
    for s, (lv, tl) in enumerate(sections):
        h = L.level_header(rom, lv)
        bank = h['bank']
        add = ptrs.setdefault(bank, set())
        add.update((lv, h['spawnList'], h['sceneTable'], h['layers'][0]['stream'], h['layers'][1]['stream']))
        add.add(h['sceneTable'] + 18 * (len(L.scene_table(rom, h['sceneTable'])) + 1))
        for e in L.scene_table(rom, h['sceneTable']):
            for l in e['layers']:
                if l['kind'] == 6:
                    add.add((bank << 16) | l['speed'])
        if (tl >> 16) == bank:
            add.add(tl)
    return ptrs


def section(rom, s, lv, tl, ptrs):
    h = L.level_header(rom, lv)
    bank = h['bank']
    scenes = L.scene_table(rom, h['sceneTable'])
    scripts = {}
    for e in scenes:
        for l in e['layers']:
            if l['kind'] == 6:
                a = (bank << 16) | l['speed']
                scripts[str(a)] = L.layer_script(rom, a)
    layers = []
    metatiles = {}
    for li, lay in enumerate(h['layers']):
        needed = ((lay['maxPosition'] - 0x200) >> 5) + L.LOOKAHEAD + 1 if lay['maxPosition'] >= 0x200 else 0
        if lay['bytesPerColumn'] == 0:
            layers.append(dict(lay, columns=[], columnsNeeded=needed, columnsAvailable=0))
            continue
        above = [p for p in ptrs[bank] if p > lay['stream']]
        end = min(above) if above else (bank << 16) | 0x10000
        available = (end - lay['stream']) // lay['bytesPerColumn']
        # ★ a boss section's stream is shorter than the columns its scroll draws (section 3: 12 of 14) and
        # the original reads on into the data that follows — the columns past the stream are dumped as the
        # bytes there, and their metatiles too (whatever 40 bytes the garbage word points at)
        in_bank = (0x10000 - (lay['stream'] & 0xFFFF)) // lay['bytesPerColumn']
        cols = L.stream_columns(rom, lay['stream'], lay['blocksPerColumn'], lay['bytesPerColumn'], min(max(available, needed), in_bank))
        for col in cols:
            for w in col:
                a = (bank << 16) | (w & 0xFFF8)
                if str(a) not in metatiles and 0x8000 <= (a & 0xFFFF) and (a & 0xFFFF) + L.METATILE_SIZE <= 0x10000:  # the ROM half of the bank
                    metatiles[str(a)] = L.metatile(rom, a)
        layers.append(dict(lay, columns=cols, columnsNeeded=needed, columnsAvailable=available))
    # ★ the metatiles are one table of 40-byte records from the lowest one the streams reference up to the
    # next known pointer of the bank; the code of objects and bosses (`map_enqueue_b`, M4) references records
    # the streams never do (a door's frames, a boss's wall), so the whole table is dumped
    if metatiles:
        lo = min(int(k) for k in metatiles)
        above = [p for p in ptrs[bank] if p > lo]
        end = min(above) if above else (bank << 16) | 0x10000
        a = lo
        while a + L.METATILE_SIZE <= end:
            if str(a) not in metatiles:
                metatiles[str(a)] = L.metatile(rom, a)
            a += L.METATILE_SIZE
    return {
        'section': s, 'bank': bank, 'record': lv, 'tileSet': tl,
        'flags': h['flags'], 'scrollEnd': h['scrollEnd'], 'scrollSpeed': h['scrollSpeed'],
        'spawnList': h['spawnList'], 'sceneTable': h['sceneTable'],
        'scenes': scenes, 'scripts': scripts,
        'layers': layers,
        'metatiles': metatiles,
        'spawns': L.spawn_list(rom, h['spawnList']),
        'paletteSets': {'bg': [None if b == 0xFF else b for b in L.rd(rom, L.BG_PALETTE_SETS + 8 * s, 8)],
                        'obj': [None if b == 0xFF else b for b in L.rd(rom, L.OBJ_PALETTE_SETS + 8 * s, 8)]},
        'music': L.rd(rom, L.MUSIC_TABLE + s, 1)[0] if s < 32 else None,
    }


def main():
    rom = L.rom_bytes()
    secs = L.section_pointers(rom)
    ptrs = known_pointers(rom, secs)
    out = {
        '_comment': 'Super R-Type (USA): the 18 sections of the game out of the cartridge — level records, scene tables, '
                    'layer scripts, map streams as metatile references, metatiles (16 tile words + 16 collision nibbles), '
                    'spawn lists, palette sets; formats in tools/srtlib.py; tools/dumplevels.py, checked by '
                    'tools/matchlevels.mjs against the VRAM of the running original.',
        'constants': {'firstColumns': L.FIRST_COLUMNS, 'lookahead': L.LOOKAHEAD, 'queuePerFrame': L.QUEUE_PER_FRAME,
                      'bgTilesVram': L.BG_TILES_VRAM, 'collisionBase': L.COLLISION_BASE, 'layerKinds': L.LAYER_KINDS},
        'sections': [section(rom, s, lv, tl, ptrs) for s, (lv, tl) in enumerate(secs)],
    }
    path = os.path.join(PROJECT, 'data', 'levels.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    for sec in out['sections']:
        print('section %2d bank $%02X  scrollEnd $%04X  BG1 %3d/%3d columns  BG2 %3d/%3d  metatiles %4d  spawns %3d  scripts %d' % (
            sec['section'], sec['bank'], sec['scrollEnd'],
            sec['layers'][0]['columnsAvailable'], sec['layers'][0]['columnsNeeded'],
            sec['layers'][1]['columnsAvailable'], sec['layers'][1]['columnsNeeded'],
            len(sec['metatiles']), len(sec['spawns']), len(sec['scripts'])))
    print('%s: %d B' % (os.path.relpath(path, PROJECT), os.path.getsize(path)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
