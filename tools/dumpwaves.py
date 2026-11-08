#!/usr/bin/env python3
"""dumpwaves — the spawn lists of Super R-Type (US): what appears where.

★ Every section has a list of 12-byte entries (`srtlib.py`, "Spawn
list"; walked by `$08:81D0` every pass): when the scroll `$1830` reaches
the entry's value, a task is made from the entry's code with the three
parameter words, provided the difficulty (`$16D5`) is at least the
entry's; bit 3 of the flags ties the object to a layer (bit 4: BG2).
That is the **wave table** — the enemies, the power-ups, the terrain
objects, the boss. The code address names the kind of object; what each
kind does (its path, its aiming) is the code of M5, so here the kinds are
counted and listed by address, with `?` for a name. The same entries are
in `levels.json`; this view is per kind.

Output `data/waves.json`.

    ./tools/dumpwaves.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import srtlib as L  # noqa: E402

DIFFICULTY = ['NOVICE', 'EASY', 'NORMAL', 'HARD']     # ★ manual p. 5; $16D5 (EASY = 1 is the default, disasm_notes §4)


def main():
    rom = L.rom_bytes()
    sections = []
    kinds = {}
    for s, (lv, tl) in enumerate(L.section_pointers(rom)):
        h = L.level_header(rom, lv)
        entries = L.spawn_list(rom, h['spawnList'])
        for e in entries:
            k = kinds.setdefault(str(e['code']), {'code': e['code'], 'name': '?', 'count': 0, 'sections': []})
            k['count'] += 1
            if s not in k['sections']:
                k['sections'].append(s)
        sections.append({'section': s, 'spawnList': h['spawnList'], 'entries': entries,
                         'byDifficulty': [sum(1 for e in entries if e['difficulty'] <= d) for d in range(4)]})
    out = {
        '_comment': 'Super R-Type (USA): spawn lists per section ($08:81D0) — scroll trigger, code of the object, '
                    'lowest difficulty, layer, three parameter words; kinds by code address, names are M5; '
                    'tools/dumpwaves.py.',
        'difficulty': DIFFICULTY,
        'kinds': kinds,
        'sections': sections,
    }
    path = os.path.join(PROJECT, 'data', 'waves.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    for sec in sections:
        print('section %2d: %3d entries, by difficulty %s' % (sec['section'], len(sec['entries']), sec['byDifficulty']))
    print('%s: %d kinds of object' % (os.path.relpath(path, PROJECT), len(kinds)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
