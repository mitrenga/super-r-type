#!/usr/bin/env python3
"""srtlib — the data formats of Super R-Type (US), read straight from the code.

One place for every `dump*.py` of M2 (`MILNIKY.md`), so that the level
dumper, the sprite dumper and the text dumper agree on what a byte means.
Everything here is ★ — read from the disassembly (`sources/asm/main.asm`,
addresses in the comments) and checked against the running original by
`tools/match*.mjs`; what is still a guess is marked `?` in the docstrings
and in `sources/docs/disasm_notes.md` §8.

## Sections

The game is cut into **18 sections** (`$16E5 & $0F` indexes the first 16,
`S_008B4D` is also called with the constants 14 and 15): 0-13 are the seven
levels, each as a level part and a boss part (the music table `$04:8A3F`
alternates level song / boss song), 14 and 15 are the launch from the
mother ship before level 1, 16 and 17 share one record (? ending). Three
tables in bank `$04` are indexed by section, 3-byte LoROM pointers:

- `$04:815D` level record (`S_008B4D`), `$04:8127` background tiles
  (`S_008B18`: 24 KB by DMA to VRAM word `$2000`), and the palette sets
  (`dumppalettes.py`).

## Level record (`S_008B4D`, 30 B, in the level's bank = `$94`)

    +0   flags → $1821  (bit 0 BG1 has collision, bit 1 BG2 has collision — S_0095D8;
                         bit 2 the default layer $46 is BG2 instead of BG1)
    +2   spawn list → $1823 (12 B entries, below)
    +4   scroll end → $1825 (the scroll $1830 never passes it — S_008D6F)
    +6   scroll speed → $1827, 8.8 fixed point per pass of the main loop
    +8   scene table → $1829 (18 B entries, below)
    +10  BG1 layer bytes +8..+$11, +20 BG2 layer bytes +8..+$11:
         +8 map stream, +$A blocks a column, +$C bytes a column,
         +$E ?, +$10 the largest position

## Scene table (`S_008BC3`, 18 B entries, `$FFFF` ends it)

    +0  scroll ($1830) at which the scene starts — the first entry is 0
    +2  BG1 kind (+$12), +4 BG1 x (+$1B), +6 BG1 y (+$1E), +8 BG1 speed / script (+$14)
    +$A BG2 kind, +$C x, +$E y, +$10 speed / script

Positions are 512 more than the scroll register (`- $200` in `L_00909E`).
Kinds (`$04:8193` at init, `$04:81B3` / `$04:81D3` every pass):
0 nothing, 2 fill the map and stand still, 4 scroll by the speed, 6 run a
script; $A-$10 are states the layer moves through on its own.

## Layer script (kind 6; `L_008E69` reads a handler address, the handler
## reads its arguments; the trigger is a scroll value in +$2A)

    $8E8B                    stop
    $8E97 d                  wait until scroll >= scroll_now + d
    $8EC4 vx t               x speed vx (8.8 signed) until scroll >= t
    $8EC9 vx d               the same, t = scroll_now + d
    $8F22 vy t / $8F27 vy d  y speed likewise
    $8F80 vx vy t            both speeds until scroll >= t
    $8F85 ?                  never run in the surveys

## Map stream and metatiles (`map_enqueue_a` `$00:916B`, `S_00924E`)

A column is `blocks a column` words, top to bottom; the stream is columns
left to right, `bytes a column` apart. Each word is the **address of a
metatile record in the level's bank** (bits 3-15) with the flips in bits
0-1 (1 = horizontal, 2 = vertical, `$04:81F3`). A record is 40 B: 16 tile
words (4 rows × 4 tiles, the SNES map format) and 8 B of collision, two
nibbles a byte, the lower one first, row by row — they land in
`$7E:3160 + VRAM address` (BG2 at `+$1000`), flipped with the tiles.
Column `c` of the stream goes to VRAM block column `c & 15` (16 blocks =
512 px = the 64-tile map); the first ten columns are drawn at the start
(`L_008C70`, `L_008D1C`), then column `(scroll >> 5) + 9` whenever the
scroll enters a new 32 px (`L_00909E`); the NMI draws at most 13 queued
blocks a frame (`nmi_draw_metatile`).

## Spawn list (`$08:81D0`, 12 B entries, a scroll word of `$8000` ends it — ★ M3; the level record follows)

    +0 scroll at which it fires   +2 code (word) +4 code bank
    +5 flags: bits 0-1 the lowest difficulty ($16D5) it appears at,
              bit 3 = attach to a layer, bit 4 = BG2 (else BG1), else $46
    +6 +8 +$A three words the object gets (+$B, +$10, +$30)

## Texts (`S_008938` prints, `S_0089B1` erases the same record)

A byte ≥ `$10` is a tile of BG3 (ASCII — the font sits at those tile
numbers); 0-7 are commands (`$04:80D1`): 0 end, 1 word = VRAM address
(or yield a frame when 6 was seen), 2 byte = palette (bits 2-4 → tile word
bits 10-12), 3 byte = the tile's bits 7-9 (bits 0-2 of the byte, `L_008A68`:
`AND #$0700`, `LSR`), 4 priority on, 5 priority off, 6 yield mode on,
7 count + raw tile bytes.

## Metasprites (`draw_object_sprites` `$00:99F3`)

    byte 0 < $80: n parts, then n × (dx, dy signed bytes, tile word)
    byte 0 ≥ $80: layout (byte & $E) / 2 — 0 one 16×16, 1 two in a row,
                  2 three, 3 four, 4 a 2×2 square — then dx, dy and the
                  tile words of the parts (x += 16 along a row)

The tile word carries bit 9 = large sprite; the object's attribute word
supplies the palette bits; the low tile byte may be remapped by the
object's slot table (dynamic sprite tiles, `S_009BF5`).
"""
import os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from snesemu import ROM  # noqa: E402

SECTIONS = 18
LEVEL_TABLE, TILE_TABLE = 0x04815D, 0x048127
BG_PALETTE_SETS, OBJ_PALETTE_SETS = 0x04824B, 0x0482D3
PALETTE_BANK, PALETTE_BASE = 0x05, 0x8000
MUSIC_TABLE = 0x048A3F
METATILE_WORDS, METATILE_SIZE = 16, 40
FIRST_COLUMNS = 10                  # L_008C70: the task draws ten columns at the start
LOOKAHEAD = 9                       # L_00909E: column (scroll >> 5) + 9
QUEUE_PER_FRAME = 13                # nmi_draw_metatile: $00 = 13 (nmi_frame)
BG_TILES_VRAM, BG_TILES_SIZE = 0x2000, 0x6000
COLLISION_BASE = 0x3160

LAYER_KINDS = {0: 'none', 2: 'static', 4: 'scroll', 6: 'script', 8: 'script-running',
               0xA: 'move', 0xC: 'move-wait', 0xE: 'wrap', 0x10: 'stop'}

# script handler address -> (name, argument words)
SCRIPT_HANDLERS = {
    0x8E8B: ('stop', ()),
    0x8E97: ('waitRelative', ('delta',)),
    0x8EC4: ('speedX', ('vx', 'until')),
    0x8EC9: ('speedXRelative', ('vx', 'delta')),
    0x8F22: ('speedY', ('vy', 'until')),
    0x8F27: ('speedYRelative', ('vy', 'delta')),
    0x8F80: ('speedXY', ('vx', 'vy', 'until')),
}

TEXT_COMMANDS = {0: ('end', 0), 1: ('at', 2), 2: ('palette', 1), 3: ('tileHigh', 1),
                 4: ('priorityOn', 0), 5: ('priorityOff', 0), 6: ('yield', 0), 7: ('raw', -1)}


def rom_bytes(path=ROM):
    return open(path, 'rb').read()


def off_of(addr):
    """ROM offset of a LoROM CPU address `$BB:AAAA` (banks $00-$7F, upper halves)."""
    bank, a = (addr >> 16) & 0x7F, addr & 0xFFFF
    if a < 0x8000:
        raise ValueError('not a ROM address: $%06X' % addr)
    return (bank << 15) | (a & 0x7FFF)


def cpu_of(off):
    return ((off >> 15) << 16) | 0x8000 | (off & 0x7FFF)


def fmt(addr):
    return '$%02X:%04X' % ((addr >> 16) & 0xFF, addr & 0xFFFF)


def rd(rom, addr, n):
    o = off_of(addr)
    return rom[o:o + n]


def word(rom, addr):
    return struct.unpack('<H', rd(rom, addr, 2))[0]


def ptr3(rom, addr):
    """A 3-byte LoROM pointer (low, high, bank) → 24-bit CPU address."""
    b = rd(rom, addr, 3)
    return (b[2] << 16) | b[1] << 8 | b[0]


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def s8(v):
    return v - 0x100 if v & 0x80 else v


# -- sections ----------------------------------------------------------------

def section_pointers(rom):
    """[(level record, tile set)] for the 18 sections."""
    return [(ptr3(rom, LEVEL_TABLE + 3 * s), ptr3(rom, TILE_TABLE + 3 * s)) for s in range(SECTIONS)]


def level_header(rom, addr):
    """The 30-byte level record at `addr` (bank = the level's bank)."""
    b = rd(rom, addr, 30)
    w = struct.unpack('<15H', b)
    bank = addr & 0xFF0000

    def layer(i):
        return {'stream': bank | w[i], 'blocksPerColumn': w[i + 1], 'bytesPerColumn': w[i + 2],
                'field0E': w[i + 3], 'maxPosition': w[i + 4]}
    return {
        'address': addr, 'bank': bank >> 16,
        'flags': w[0], 'spawnList': bank | w[1], 'scrollEnd': w[2], 'scrollSpeed': w[3],
        'sceneTable': bank | w[4],
        'layers': [layer(5), layer(10)],
    }


def scene_table(rom, addr, limit=64):
    out = []
    for i in range(limit):
        w = struct.unpack('<9H', rd(rom, addr + 18 * i, 18))
        if w[0] == 0xFFFF:
            break
        out.append({'scroll': w[0],
                    'layers': [{'kind': w[1], 'x': w[2], 'y': w[3], 'speed': w[4]},
                               {'kind': w[5], 'x': w[6], 'y': w[7], 'speed': w[8]}]})
    return out


def layer_script(rom, addr, limit=64):
    """The records of a layer script at `addr`; stops at `stop` or at a handler it does not know."""
    out, p = [], addr
    for _ in range(limit):
        h = word(rom, p)
        name, args = SCRIPT_HANDLERS.get(h, ('?', ()))
        rec = {'address': p, 'handler': h, 'op': name}
        p += 2
        for a in args:
            v = word(rom, p)
            rec[a] = s16(v) if a in ('vx', 'vy', 'delta') else v
            p += 2
        out.append(rec)
        if name in ('stop', '?'):
            break
    return out


def spawn_list(rom, addr, limit=2048):
    """★ The list ends with a scroll word of `$8000` (M3 corrected M2's `$FFFF`: the spawner
    `$08:81D3` stops at the first entry whose scroll the global scroll has not reached, and no
    scroll reaches `$8000`); the level record follows the terminator word at once."""
    out = []
    for i in range(limit):
        b = rd(rom, addr + 12 * i, 12)
        trig, code = struct.unpack('<HH', b[:4])
        if trig & 0x8000:
            break
        p1, p2, p3 = struct.unpack('<HHH', b[6:12])
        out.append({'scroll': trig, 'code': (b[4] << 16) | code, 'flags': b[5],
                    'difficulty': b[5] & 3, 'layer': ('bg2' if b[5] & 0x10 else 'bg1') if b[5] & 8 else 'default',
                    'params': [p1, p2, p3]})
    return out


def metatile(rom, addr):
    """{'tiles': 16 words, 'collision': 16 nibbles} of the record at `addr` (bits 0-2 must be clear)."""
    b = rd(rom, addr, METATILE_SIZE)
    tiles = list(struct.unpack('<16H', b[:32]))
    coll = []
    for i in range(8):
        coll.append(b[32 + i] & 0x0F)
        coll.append(b[32 + i] >> 4)
    return {'tiles': tiles, 'collision': coll}


def stream_columns(rom, stream, blocks, stride, columns):
    """`columns` columns of `blocks` words each, `stride` bytes apart."""
    out = []
    for c in range(columns):
        out.append(list(struct.unpack('<%dH' % blocks, rd(rom, stream + c * stride, 2 * blocks))))
    return out


# -- texts -------------------------------------------------------------------

def text_record(rom, addr, limit=4096):
    """The commands and strings of a text record as a list; `bytes` is its raw length."""
    out, p, run = [], addr, []

    def flush():
        if run:
            out.append({'text': ''.join(chr(c) if 32 <= c < 127 else '\\x%02X' % c for c in run)})
            run.clear()
    for _ in range(limit):
        c = rd(rom, p, 1)[0]
        if c >= 0x10:
            run.append(c)
            p += 1
            continue
        flush()
        name, n = TEXT_COMMANDS.get(c & 7, ('?', 0))
        if name == 'end':
            p += 1
            out.append({'op': 'end'})
            break
        if name == 'at':
            out.append({'op': 'at', 'vram': word(rom, p + 1)})
            p += 3
        elif name == 'palette':
            out.append({'op': 'palette', 'value': (rd(rom, p + 1, 1)[0] >> 2) & 7})
            p += 2
        elif name == 'tileHigh':
            out.append({'op': 'tileHigh', 'value': rd(rom, p + 1, 1)[0] & 7})
            p += 2
        elif name == 'raw':
            n = rd(rom, p + 1, 1)[0]
            out.append({'op': 'raw', 'tiles': list(rd(rom, p + 2, n))})
            p += 2 + n
        else:
            out.append({'op': name})
            p += 1
    return out, p - addr


# -- metasprites -------------------------------------------------------------

SPECIAL_LAYOUTS = {0: 1, 2: 2, 4: 3, 6: 4, 8: 4, 0xA: 1, 0xC: 1, 0xE: 1}   # $04:81FB, parts


def metasprite(rom, addr):
    """{'layout', 'parts': [{'dx','dy','tile'}], 'bytes'} of the record at `addr`."""
    head = rd(rom, addr, 1)[0]
    if head & 0x80:
        lay = head & 0x0E
        n = SPECIAL_LAYOUTS[lay]
        dx, dy = s8(rd(rom, addr + 1, 1)[0]), s8(rd(rom, addr + 2, 1)[0])
        words = struct.unpack('<%dH' % n, rd(rom, addr + 3, 2 * n))
        parts = []
        for i, t in enumerate(words):
            if lay == 8:
                parts.append({'dx': dx + 16 * (i & 1), 'dy': dy + 16 * (i >> 1), 'tile': t})
            else:
                parts.append({'dx': dx + 16 * i, 'dy': dy, 'tile': t})
        return {'layout': lay >> 1, 'parts': parts, 'bytes': 3 + 2 * n}
    n = head & 0x7F
    parts = []
    for i in range(n):
        b = rd(rom, addr + 1 + 4 * i, 4)
        parts.append({'dx': s8(b[0]), 'dy': s8(b[1]), 'tile': b[2] | (b[3] << 8)})
    return {'layout': None, 'parts': parts, 'bytes': 1 + 4 * n}
