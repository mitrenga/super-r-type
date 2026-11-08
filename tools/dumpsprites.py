#!/usr/bin/env python3
"""dumpsprites — the metasprites of Super R-Type (US) out of the cartridge.

★ An object (12 B in the two sprite groups, `disasm_notes.md` §3) points
with +4 at a **metasprite record in bank `$04`** (`draw_object_sprites`
`$00:99F3`, format in `srtlib.py`): a count and then dx, dy and a tile
word per part, or a layout byte for a row / square of 16×16 sprites. The
tile word's bit 9 is the size bit, the object's attribute word (+8)
supplies the palette bits, and when the object has a slot table (+$A) the
low tile byte is looked up in it (dynamic sprite tiles, `dumptiles.py`).

Nothing in the ROM lists the records. They are gathered from the
run-time survey (`build/m2/collect`, hook `metasprite`: every record the
original drew in the title, the demo, a play and every section) and from
the pointer table `$04:8E14` (70 records of the ship and its weapons).
What an object *is* (ship, Force, which enemy) is M3-M5; here a record is
its address, its parts and the attribute words it was seen with.

Output `data/sprites.json`. Checked by `tools/matchsprites.mjs`: the OAM
the original built from these records, byte for byte.

    ./tools/dumpsprites.py
"""
import json, os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import srtlib as L  # noqa: E402

METASPRITE_BANK = 0x04
POINTER_TABLE, POINTER_COUNT = 0x048E14, 70


def runtime_records():
    """{address: {attrs seen}}"""
    out = {}
    d = os.path.join(PROJECT, 'build', 'm2', 'collect')
    if os.path.isdir(d):
        for f in os.listdir(d):
            if f.endswith('.json'):
                for h in json.load(open(os.path.join(d, f))).get('hits', {}).get('metasprite', []):
                    bank = h[11] & 0xFF
                    out.setdefault((bank << 16) | h[7], set()).add(h[9])
    return out


def main():
    rom = L.rom_bytes()
    seen = runtime_records()
    addrs = dict(seen)
    for i in range(POINTER_COUNT):
        a = (METASPRITE_BANK << 16) | L.word(rom, POINTER_TABLE + 2 * i)
        addrs.setdefault(a, set())
    records = {}
    for a in sorted(addrs):
        if (a >> 16) != METASPRITE_BANK or (a & 0xFFFF) < 0x8000:
            continue
        m = L.metasprite(rom, a)
        m['address'] = a
        m['seenAttrs'] = sorted(addrs[a])
        m['seenRunning'] = a in seen
        records[str(a)] = m
    out = {
        '_comment': 'Super R-Type (USA): metasprite records of bank $04 (draw_object_sprites $00:99F3) — parts as '
                    '{dx, dy, tile word}; gathered from the run-time survey and the pointer table $04:8E14; '
                    'tools/dumpsprites.py, checked by tools/matchsprites.mjs.',
        'bank': METASPRITE_BANK, 'pointerTable': POINTER_TABLE,
        'records': records,
    }
    path = os.path.join(PROJECT, 'data', 'sprites.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    parts = sum(len(r['parts']) for r in records.values())
    print('%s: %d metasprites (%d seen running), %d parts' % (
        os.path.relpath(path, PROJECT), len(records), sum(1 for r in records.values() if r['seenRunning']), parts))
    return 0


if __name__ == '__main__':
    sys.exit(main())
