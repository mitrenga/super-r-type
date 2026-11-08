#!/usr/bin/env python3
"""dumptiles — the tile graphics of Super R-Type (US) out of the cartridge.

★ **Nothing is compressed**: every tile the PPU shows is a run of bytes
in the ROM that the program DMAs or copies into VRAM as it is
(`sources/docs/disasm_notes.md` §8). This tool lists those runs with the
VRAM address each one lands at, so `matchtiles.mjs` can hold them against
the VRAM of the running original byte by byte, and the application can put
them into `SNESPPU`.

1. **Background tiles of a section** — `S_008B18`: 24 KB (4 bpp, 768
   tiles) from the table `$04:8127` by DMA to VRAM word `$2000`. ★ Seven
   of the sets start so late in their bank that the 24 KB **run past its
   end**: the DMA's A-bus address wraps within the bank, and `$xx:0000`
   on in a LoROM bank is the mirror of WRAM `$7E:0000` — so the last tiles
   of those sets are whatever the low WRAM held at the moment (found by
   `matchlevels`: 527 B of level 1's set differ from the ROM). Only
   `bytesInBank` are data; the rest is not dumped and not compared.
2. **Font of BG3** — `$05:9B00`, 6 KB (2 bpp, 384 tiles) to `$5000`; the
   tile numbers are ASCII (`dumptexts.py`).
3. **Sprite tiles**: the title's set `$0B:B580` and the launch's set
   `$0B:8D80` (16 KB to `$6000`, `S_00977D`); the common set `$05:E300`
   (7 KB to `$6200`, `S_0097F5`); the ship's **animation buffer**
   `$7E:24A0` (1 KB, DMA to `$6000` every frame) filled 32 B a tile from
   `$05:B300` (`S_009B66`) — dumped as the whole run `$05:B300`-`$05:E2FF`;
   and the **dynamic sets** of the enemies: records in bank `$01`
   (`S_009BF5`: id word, 3-byte source, then the 16×16 slots `b` the set
   takes, `$FF` ends; slot `b` = VRAM word `$7000 + 16·b`, 128 B each from
   the source in turn, uploaded by the NMI four a frame, `L_00851D`).
   The records lie one after another in bank `$04` (`$04:AC25` on);
   the run-time survey (`build/m2/collect`, hook `sprtiles`, DB:Y) gives
   the ones met, the sequence is then followed to its end so the sets the
   surveys never met are in too.
4. **The panel row** — 54 B from `$00:18CC` to `$5F40` each frame: that
   is WRAM, the HUD of M3, not a tile.

Output `data/tiles.json` with the runs base64; ~1 MB.

    ./tools/dumptiles.py
"""
import base64, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import srtlib as L  # noqa: E402

FONT = (0x059B00, 0x1800, 0x5000)
OBJ_FIXED = [('title', 0x0BB580, 0x4000, 0x6000), ('launch', 0x0B8D80, 0x4000, 0x6000),
             ('common', 0x05E300, 0x1C00, 0x6200)]
SHIP = (0x05B300, 0x05E300 - 0x05B300)
SPRITE_SLOT_VRAM, SPRITE_SLOT_BYTES = 0x7000, 128


def b64(b):
    return base64.b64encode(bytes(b)).decode('ascii')


def sprite_record(rom, addr):
    b = L.rd(rom, addr, 3 + 2 + 64)
    rec = {'address': addr, 'id': b[0] | (b[1] << 8), 'source': (b[4] << 16) | (b[3] << 8) | b[2], 'slots': []}
    p = 5
    while b[p] != 0xFF:
        rec['slots'].append(b[p])
        p += 1
    rec['bytes'] = p + 1
    rec['data'] = b64(L.rd(rom, rec['source'], SPRITE_SLOT_BYTES * len(rec['slots'])))
    return rec


def runtime_records():
    out = set()
    d = os.path.join(PROJECT, 'build', 'm2', 'collect')
    if os.path.isdir(d):
        for f in os.listdir(d):
            if f.endswith('.json'):
                for h in json.load(open(os.path.join(d, f))).get('hits', {}).get('sprtiles', []):
                    out.add(((h[5] & 0xFF) << 16) | h[4])      # DB:Y — the record (bank $04)
    return out


def static_records(rom, first):
    """The records lie one after another in bank $04 from the lowest one the
    survey met; the run is followed record by record while it parses."""
    out, a = set(), first
    while True:
        try:
            r = sprite_record(rom, a)
        except (IndexError, ValueError):
            break
        if not r['slots'] or (r['source'] >> 16) > 0x1F or (r['source'] & 0xFFFF) < 0x8000 or len(r['slots']) > 64:
            break
        out.add(a)
        a += r['bytes']
    return out


def main():
    rom = L.rom_bytes()
    secs = L.section_pointers(rom)
    bg = {}
    for s, (lv, tl) in enumerate(secs):
        in_bank = min(L.BG_TILES_SIZE, 0x10000 - (tl & 0xFFFF))
        bg.setdefault(str(tl), {'address': tl, 'vram': L.BG_TILES_VRAM, 'bytes': L.BG_TILES_SIZE, 'bytesInBank': in_bank,
                                'bpp': 4, 'sections': [], 'data': b64(L.rd(rom, tl, in_bank))})['sections'].append(s)
    records = {}
    seen = runtime_records()
    for a in sorted(seen | (static_records(rom, min(seen)) if seen else set())):
        try:
            r = sprite_record(rom, a)
        except (IndexError, ValueError):
            continue
        if r['slots'] and r['source'] >> 16 <= 0x1F and len(r['slots']) <= 64:
            r['seenRunning'] = a in seen
            records[str(a)] = r
    out = {
        '_comment': 'Super R-Type (USA): every run of tile bytes the program puts into VRAM, as it lies in the ROM '
                    '(no compression), with the VRAM word address; base64; tools/dumptiles.py, checked by '
                    'tools/matchtiles.mjs against the VRAM of the running original.',
        'bg': bg,
        'font': {'address': FONT[0], 'bytes': FONT[1], 'vram': FONT[2], 'bpp': 2, 'data': b64(L.rd(rom, FONT[0], FONT[1]))},
        'obj': {name: {'address': a, 'bytes': n, 'vram': v, 'bpp': 4, 'data': b64(L.rd(rom, a, n))} for name, a, n, v in OBJ_FIXED},
        'ship': {'address': SHIP[0], 'bytes': SHIP[1], 'bpp': 4, 'tileBytes': 32, 'buffer': 0x7E24A0, 'bufferVram': 0x6000,
                 'data': b64(L.rd(rom, SHIP[0], SHIP[1]))},
        'spriteSets': {'slotVram': SPRITE_SLOT_VRAM, 'slotBytes': SPRITE_SLOT_BYTES, 'records': records},
    }
    path = os.path.join(PROJECT, 'data', 'tiles.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print('%s: %d background sets (%d run past their bank), font, %d fixed sprite sets, ship %d B, %d dynamic sprite sets (%d seen running); %d B' % (
        os.path.relpath(path, PROJECT), len(bg), sum(1 for b in bg.values() if b['bytesInBank'] < b['bytes']), len(OBJ_FIXED), SHIP[1], len(records),
        sum(1 for r in records.values() if r['seenRunning']), os.path.getsize(path)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
