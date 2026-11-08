#!/usr/bin/env python3
"""dumptexts — the texts of Super R-Type (US) out of the cartridge.

★ A text is a record for `S_008938` (print) / `S_0089B1` (erase the same
record with spaces): bytes ≥ `$10` are BG3 tiles (ASCII, the font sits at
those tile numbers — VRAM word `$5000`, 2 bpp, `$05:9B00`), bytes 0-7 are
commands (`srtlib.py`, "Texts"). Nothing in the ROM lists the records;
the code calls them as `LDY #record / LDA #bank / JSL S_008938`, so this
tool finds every such call **statically in the whole ROM** (the sequence
`A0 lo hi A9 bb 22 38 89 00` or `… 22 B1 89 00`), also in code the
surveys never ran (the ending, the continue screen), and decodes the
record each one names. The caller's address is kept, so M3-M5 can tie a
text to a state of the game.

Output `data/texts.json`.

    ./tools/dumptexts.py
"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import srtlib as L  # noqa: E402

FONT_SRC, FONT_VRAM, FONT_SIZE = 0x059B00, 0x5000, 0x1800
CALL = re.compile(rb'\xa0(..)\xa9(.)\x22(\x38|\xb1)\x89\x00', re.S)


def main():
    rom = L.rom_bytes()
    calls = []
    for m in CALL.finditer(rom):
        lo, hi = m.group(1)
        bank = m.group(2)[0]
        addr = (bank << 16) | (hi << 8) | lo
        if bank > 0x1F or (hi << 8 | lo) < 0x8000:
            continue
        calls.append({'caller': L.cpu_of(m.start()), 'record': addr,
                      'op': 'print' if m.group(3) == b'\x38' else 'erase'})
    records = {}
    for c in calls:
        key = str(c['record'])
        if key not in records:
            items, n = L.text_record(rom, c['record'])
            records[key] = {'address': c['record'], 'bytes': n, 'items': items,
                            'plain': ' '.join(i['text'] for i in items if 'text' in i)}
    out = {
        '_comment': 'Super R-Type (USA): text records (S_008938) found by their calls in the whole ROM, decoded; '
                    'bytes >= $10 are BG3 tiles = ASCII, commands in tools/srtlib.py; tools/dumptexts.py.',
        'font': {'source': FONT_SRC, 'vram': FONT_VRAM, 'bytes': FONT_SIZE, 'bpp': 2},
        'calls': calls,
        'records': records,
    }
    path = os.path.join(PROJECT, 'data', 'texts.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)
    for r in sorted(records.values(), key=lambda r: r['address']):
        print('%s %4d B  %s' % (L.fmt(r['address']), r['bytes'], r['plain'][:70]))
    print('%s: %d calls, %d records' % (os.path.relpath(path, PROJECT), len(calls), len(records)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
