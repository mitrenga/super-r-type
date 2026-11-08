#!/usr/bin/env python3
"""dumpglobal — the global tables of Super R-Type (US): the order of the
sections, the difficulties, the lives, the music, the speeds.

★ From the code (addresses in the values' comments):

- **sections** in play order: 14, 15 (the launch from the mother ship,
  `S_008B4D` with the constants at `$01:972C` / `$01:9802`), then 0-13 by
  `$16E5 & $0F`; section 13 is the last (`$01:AA76`: 13 → the ending);
  the even sections carry the level song and the odd ones the boss song
  (`$04:8A3F`), ? so odd = the boss area of the level before;
- **difficulty** `$16D5`: 0 NOVICE, 1 EASY, 2 NORMAL, 3 HARD (manual p. 5
  for the names; the default `$16D7` = 1 at `$01:800B`, EASY — as the
  title shows); the spawn entries carry the lowest difficulty they appear
  at (`dumpwaves.py`); bit 4 of `$16E5` is the PRO round (`$01:8476`);
- **lives** `$16CD` = 3 at `$01:8019` (manual: three R-9s), copied to
  `$16E1` at the start of a play (`$01:8070`);
- **scroll** per section: speed 8.8 a pass of the main loop and the end
  (`levels.json`), ★ 1 px / 3 passes for BG1 of level 1 measured in M0;
- **music** per section from `$04:8A3F` (number for `spc_load_song`);
- the controls ★ by the manual (`disasm_notes.md` §4) — the code of the
  reading is M3.

**Not here, M4-M5**: points for enemies, the charge of the beam, the
speed steps of the ship — `?` until their code is read (`ZADANI.md` §4).

Output `data/global.json`.

    ./tools/dumpglobal.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import srtlib as L  # noqa: E402


def main():
    rom = L.rom_bytes()
    secs = L.section_pointers(rom)
    sections = []
    for s, (lv, tl) in enumerate(secs):
        h = L.level_header(rom, lv)
        sections.append({'section': s, 'bank': h['bank'], 'scrollSpeed': h['scrollSpeed'], 'scrollEnd': h['scrollEnd'],
                         'music': L.rd(rom, L.MUSIC_TABLE + s, 1)[0], 'tileSet': tl,
                         'layerSpeeds': [l['speed'] for l in L.scene_table(rom, h['sceneTable'])[0]['layers']]})
    out = {
        '_comment': 'Super R-Type (USA): global tables — play order of the sections, difficulties, lives, music and '
                    'scroll speeds per section; tools/dumpglobal.py; points and the beam are M4-M5 (?).',
        'playOrder': [14, 15] + list(range(14)),
        'lastSection': 13,
        'levelOfSection': {str(s): {'level': s // 2 + 1, 'part': 'boss?' if s & 1 else 'level'} for s in range(14)},
        'launchSections': [14, 15],
        'difficulty': {'names': ['NOVICE', 'EASY', 'NORMAL', 'HARD'], 'default': 1, 'variable': 0x7E16D5, 'proBit': 0x10},
        'lives': {'start': 3, 'variable': 0x7E16E1},
        'controls': {'fire': 'B', 'autofire': ['X', 'Y'], 'force': ['A', 'R'], 'pause': 'Start', 'source': 'manual p. 6'},
        'sections': sections,
        'open': {'points': '? M4', 'beamCharge': '? M4', 'shipSpeedSteps': '? M3'},
    }
    path = os.path.join(PROJECT, 'data', 'global.json')
    json.dump(out, open(path, 'w'), indent=1)
    print('%s: %d sections, play order %s' % (os.path.relpath(path, PROJECT), len(sections), out['playOrder']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
