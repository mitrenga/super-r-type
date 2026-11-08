#!/usr/bin/env python3
"""dumpship — the data bank of the game's code: bank `$04` and the tables the ship, its
weapons, the Force and the level manager read from it (M3).

★ The program runs with the data bank register set to `$04` (reset: `LDA #$04 /
PHA / PLB`, `$00:8033`), so every absolute `LDA $xxxx,Y` of the game code that
is not a WRAM mirror reads **bank `$04`**: the ship's hit box `$04:9C3E`, its
speeds `$04:9C44`, the tile animations `$04:9C5B` / `$9C65`, the metasprite
and explosion tables `$04:9CC3`-`$04:9F20`, the beam kinds' jump table
`$04:9EFE`, the death animation `$04:F9C5`, the sprite set lists per section
`$04:B362` / `$B3AA`, the difficulty records `$04:8A5F` / `$8AA5`, the palette
animation records `$04:835B`, the cheat tables `$04:9073` / `$908D` / `$90A3`
… The bank is a patchwork of small tables without delimiters (`main.asm`
marks 8 861 B as data the surveys read), so this dump keeps **the whole bank
as it is** (32 KB) and an index of the tables the code names, with their
format where the code shows it. `app/ship.js` reads the bytes by address, as
the original does; the index documents what lies where.

Output `data/ship.json`. Measured by `tools/matchship.mjs` through what the
code does with the bytes.

    ./tools/dumpship.py
"""
import base64, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import srtlib as L  # noqa: E402

DATA_BANK = 0x04

# address: (name, size in bytes, format) — ★ from the code that reads them
TABLES = {
    0x048020: ('ppu_init_table_1', 0x62, 'register, value pairs (reset)'),
    0x0480D1: ('text_op_table', 16, 'words: handlers of text commands 0-7'),
    0x0480E1: ('text_erase_op_table', 16, 'words: handlers of the erase commands 0-7'),
    0x0480F1: ('panel_initial', 0x36, 'words: the panel line $18CC-$1901 at a level start (S_0088FC)'),
    0x048127: ('bg_tiles_table', 18 * 3, '3-byte pointers by section (S_008B18)'),
    0x04815D: ('level_table', 18 * 3, '3-byte pointers by section (S_008B4D)'),
    0x048193: ('layer_init_table', 32, 'words: layer init handlers by kind (S_008C35)'),
    0x0481B3: ('layer_move_table', 32, 'words: layer move handlers by kind'),
    0x0481D3: ('layer_draw_table', 32, 'words: layer draw handlers by kind'),
    0x0481F3: ('metatile_flip_table', 24, ''),
    0x04820B: ('hit_handler_table_a', 32, 'words: handlers by (flags & $18) | kind (S_009D3F, M4)'),
    0x04822B: ('hit_handler_table_b', 32, 'words: the second handler of the same (S_009D3F, M4)'),
    0x04824B: ('bg_palette_sets', 18 * 8, '8 palette numbers by section, $FF = keep (S_00A14A)'),
    0x0482D3: ('obj_palette_sets', 18 * 8, '8 palette numbers by section (S_00A118)'),
    0x04835B: ('palette_anim_steps', 32, 'words: the step of a palette animation by its kind (S_00A29D)'),
    0x04837B: ('song_table', 15 * 3, '3-byte pointers of the 13 songs (spc_load_song)'),
    0x0483DF: ('direction_table', 33, 'bytes: a direction of 16 from the octant and the ratio (S_00A67E)'),
    0x04841F: ('sequence_table', 14, 'bytes: S_00A71E hands them out one by one ($1CA8)'),
    0x048A3F: ('stage_music_table', 32, 'bytes: song by section'),
    0x048A5F: ('difficulty_speeds', 16, 'words by difficulty (+ $10 bit for PRO): $84 of the level'),
    0x048A7F: ('demo_records', 8, 'words: pointers of the demo records ($15D7 picks)'),
    0x048AA5: ('difficulty_panel', 16, 'words: pointers of the 5-word panel texts by difficulty ($18CE)'),
    0x048AE1: ('pause_panel', 10, 'words: the 5-word panel text in pause'),
    0x048AEB: ('ship_flame_tiles_a', 24, 'words: tile numbers of the engine flame by $17F3 >> 8 (S_018855)'),
    0x048B03: ('ship_flame_tiles_b', 24, 'words: tile numbers of the second flame by $17F7 >> 8'),
    0x048E14: ('ship_metasprite_table', 70 * 2, 'words: metasprite records of the ship and its weapons'),
    0x049073: ('cheat_power_up', 26, 'words: the in-game instant power-up presses, 0 ends ($01:952D)'),
    0x04908D: ('cheat_title', 22, 'words: the title presses, 0 ends ($01:9639)'),
    0x0490A3: ('cheat_level_select', 22, 'words: R and nine Ups, 0 ends ($01:9687)'),
    0x049C3E: ('ship_hitbox', 6, 'x0, y0 (words, signed), w, h (bytes) — S_009E39'),
    0x049C44: ('ship_speeds', 14, 'words: speed 8.8 by $16E3 & $7F (S_01B1CB)'),
    0x049C52: ('ship_sprite_attr', 9, 'the attribute word of the ship sprite (S_00984B)'),
    0x049C5B: ('ship_tilt_tiles_a', 10, 'words: the ship tile by tilt $16,X >> 8, $FFFF = none (S_01B148)'),
    0x049C65: ('ship_tilt_tiles_b', 10, 'words: the second tile by tilt'),
    0x049CC3: ('spark_anim_small', 16, 'words: metasprites of the small hit spark ($01:B863)'),
    0x049CD3: ('spark_anim_medium', 16, 'words: metasprites of the medium hit spark ($01:B86E)'),
    0x049CE3: ('spark_anim_large', 16, 'words: metasprites of the large hit spark ($01:B879)'),
    0x049CF3: ('muzzle_metasprite', 5, 'the muzzle flash metasprite word ($01:B476)'),
    0x049CF8: ('shot_metasprite', 5, 'the basic shot ($01:B4EB)'),
    0x049CFD: ('shot_metasprite_b', 25, 'the shot of $01:B6B0'),
    0x049D16: ('shot_hit_anim', 21, 'words: the shot hitting the terrain ($01:B50B)'),
    0x049D2B: ('shot_hitbox', 6, 'x0, y0, w, h of the shot (S_009C95)'),
    0x049D31: ('beam_charge_anim', 0xD2, 'words: the charging beam by $16,X >> 8 ($01:B8F6), two columns by the pass parity'),
    0x049E03: ('beam_anim_0', 14, 'words: beam kind 0 ($01:BAC7)'),
    0x049E11: ('beam_tail_anim', 6, 'words ($01:BA47)'),
    0x049E17: ('beam_part_a', 5, 'metasprite word ($01:BDD4)'),
    0x049E1C: ('beam_part_b', 5, 'metasprite word ($01:BE91)'),
    0x049E21: ('beam_anim_2', 18, 'words ($01:BB0E)'),
    0x049E33: ('beam_anim_3', 22, 'words ($01:BB31)'),
    0x049E49: ('beam_anim_4', 26, 'words ($01:BB54)'),
    0x049E63: ('beam_hit_anim', 0x5A, 'words: the beam hitting the terrain ($01:BBF7)'),
    0x049EBD: ('wave_head_anim', 6, 'words: the spiral gun head ($01:BC3B)'),
    0x049EC3: ('wave_head_anim_b', 29, 'words ($01:BCFD)'),
    0x049EE0: ('beam_hitbox_0', 6, 'x0, y0, w, h'),
    0x049EE6: ('beam_hitbox_1', 6, ''),
    0x049EEC: ('beam_hitbox_2', 6, ''),
    0x049EF2: ('beam_hitbox_3', 6, ''),
    0x049EF8: ('wave_hitbox', 6, ''),
    0x049EFE: ('beam_kind_table', 16, 'words: the beam handler by charge ($30,X & $1E0) >> 4 ($01:BAAE)'),
    0x049F0E: ('wave_part_scripts', 12, 'words: the object scripts of the six spiral parts ($01:BCBD)'),
    0x04AA07: ('palette_anim_records', 0x20, 'bytes: records of $04:AAF2'),
    0x04AC25: ('sprite_set_records', 0x700, 'id, 3-byte source, slots to $FF (S_009BF5, tiles.json)'),
    0x04B362: ('section_sprite_sets', 0x48, 'words: pointers to the lists of sprite sets by section ($01:DDAA)'),
    0x04B3AA: ('section_slot_masks', 0x24, 'words: the slot bits a section frees ($01:DD7C)'),
    0x04B47B: ('force_hitbox_a', 6, 'x0, y0, w, h ($01:DEF6)'),
    0x04B481: ('force_hitbox_b', 6, '($01:DEEC)'),
    0x04B5DE: ('enemy_hp_by_difficulty', 20, 'words by $88 ($08:8286, M4)'),
    0x04B5F2: ('enemy_shots_by_difficulty', 10, 'bytes by $86 ($08:829C, M4)'),
    0x04F9C5: ('ship_death_anim', 0x3B, 'words: metasprites of the exploding ship ($01:A994), $16,X >> 8 steps of $40'),
}


def main():
    rom = L.rom_bytes()
    off = DATA_BANK << 15
    bank = rom[off:off + 0x8000]
    index = {}
    for addr in sorted(TABLES):
        name, size, fmt = TABLES[addr]
        index[name] = {'address': addr, 'size': size, 'format': fmt,
                       'bytes': list(bank[(addr & 0x7FFF):(addr & 0x7FFF) + size])}
    # ★ bank $06 holds the object scripts (`S_009FA0` reads them with DB = $06): the spiral
    # gun's six parts run six of them in M3 ($04:9F0E), the enemies theirs in M4
    bank06 = rom[0x06 << 15:(0x06 << 15) + 0x8000]
    out = {
        '_comment': 'Super R-Type (USA): bank $04, the data bank of the game code (DB = $04 from reset) — the '
                    'whole bank as the cartridge holds it, and an index of the tables the ship, the weapons, the '
                    'Force and the level manager read (format where the code shows it); bank $06 = the object '
                    'scripts (S_009FA0); tools/dumpship.py, measured by tools/matchship.mjs.',
        'bank': DATA_BANK, 'base': 0x8000, 'bytes': len(bank),
        'tables': index,
        'data': base64.b64encode(bank).decode('ascii'),
        'bank06': base64.b64encode(bank06).decode('ascii'),
    }
    path = os.path.join(PROJECT, 'data', 'ship.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print('%s: bank $%02X, %d B, %d tables indexed' % (os.path.relpath(path, PROJECT), DATA_BANK, len(bank), len(index)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
