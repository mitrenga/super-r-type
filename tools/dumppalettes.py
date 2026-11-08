#!/usr/bin/env python3
"""dumppalettes — the palettes of Super R-Type (US) out of the cartridge.

★ From the code (`sources/docs/disasm_notes.md` §8, M2):

- every palette is **16 colours BGR555 = 32 B in bank `$05`**, number `n`
  at `$05:8000 + n·32` (`S_00A14A` / `S_00A118`, `MVN $05,$7E` of 32 B
  into the CGRAM shadow `$7E:2F60 + row·32`, then `S_00A19B` writes it to
  CGRAM);
- a **section** (`$16E5 & $0F`, the index of the level table — levels, boss
  areas, the launch) has two **palette sets** of 8 bytes in bank `$04`:
  `$04:824B + 8·section` for the background rows 0-7 (`S_00A14A`) and
  `$04:82D3 + 8·section` for the sprite rows 8-15 (`S_00A118`); `$FF` leaves
  the row alone;
- the sprite rows are **also allocated at run time by palette number**
  (`S_00A2E3`: 8 slots `$7E:1982` with a count of users each, a new number
  takes a free slot and loads it with `S_00A29D`), so an enemy's palette
  lands in whichever row is free — the row is a state of the game, the
  palette itself is this data.

Output `data/palettes.json`: `palettes` = every 32 B block 0-255 of the
table in bank `$05` (M2 dumped only those a set or the run-time allocator
of `build/m2/collect` referred to; M4's enemies, bosses and the palette
animation records of `$04:AA07` name theirs by number), as 16 BGR555
words, and `sets` per section. Checked by
`tools/matchlevels.mjs` (CGRAM of the running original = the rows these
sets name) — M2 acceptance.

    ./tools/dumppalettes.py            # data/palettes.json
"""
import json, os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from snesemu import ROM  # noqa: E402

BG_SETS, OBJ_SETS, SECTIONS = 0x04824B, 0x0482D3, 18
PALETTE_BANK, PALETTE_BASE = 0x05, 0x8000


def rom_bytes():
    return open(ROM, "rb").read()


def rd(rom, addr, n):
    """`n` bytes at the LoROM CPU address `$BB:AAAA`."""
    bank, a = (addr >> 16) & 0x7F, addr & 0xFFFF
    o = (bank << 15) | (a & 0x7FFF)
    return rom[o:o + n]


def palette(rom, n):
    return list(struct.unpack('<16H', rd(rom, (PALETTE_BANK << 16) | (PALETTE_BASE + 32 * n), 32)))


def dump(rom, extra=()):
    sets = []
    # ★ M4: every block of the table, 0-255 — the enemies and the bosses allocate theirs by number
    # (`palette_slot_acquire`) and the animation records of `$04:AA07` name their targets by number too;
    # the sets and the run-time survey of M2 are a subset of these
    used = set(range(256)) | set(extra)
    for s in range(SECTIONS):
        bg = list(rd(rom, BG_SETS + 8 * s, 8))
        obj = list(rd(rom, OBJ_SETS + 8 * s, 8))
        sets.append({'section': s, 'bg': [None if b == 0xFF else b for b in bg],
                     'obj': [None if b == 0xFF else b for b in obj]})
        used |= {b for b in bg + obj if b != 0xFF}
    pals = {str(n): palette(rom, n) for n in sorted(used)}
    return {
        '_comment': 'Super R-Type (USA): palettes of bank $05 (16 x BGR555, number n at $05:8000+32n) and the '
                    'sets per section ($04:824B rows 0-7, $04:82D3 rows 8-15; null = row untouched); '
                    'tools/dumppalettes.py, checked by tools/matchlevels.mjs.',
        'bank': PALETTE_BANK, 'base': PALETTE_BASE,
        'sets': sets,
        'palettes': pals,
    }


def runtime_numbers():
    """Palette numbers the run-time allocator asked for (`build/m2/collect/*.json`, hook `palid`)."""
    out = set()
    d = os.path.join(PROJECT, 'build', 'm2', 'collect')
    if not os.path.isdir(d):
        return out
    for f in os.listdir(d):
        if f.endswith('.json'):
            for h in json.load(open(os.path.join(d, f))).get('hits', {}).get('palid', []):
                if (h[2] & 0xFF) != 0xFF:
                    out.add(h[2] & 0xFF)
    return out


def main():
    rom = rom_bytes()
    extra = runtime_numbers()
    out = dump(rom, extra)
    path = os.path.join(PROJECT, 'data', 'palettes.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print('%s: %d sections, %d palettes (%d from the run-time allocator)' % (
        os.path.relpath(path, PROJECT), len(out['sets']), len(out['palettes']), len(extra)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
