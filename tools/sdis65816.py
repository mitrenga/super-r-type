#!/usr/bin/env python3
"""sdis65816 — a static 65C816 disassembly of a ROM range the run never covered.

`tools/dis65816.py` takes its instruction widths from the CDL of the runs
and leaves the bytes no run touched open ("nepokryto"); this reads such a
range linearly, tracking the M / X widths from the REP / SEP it meets
(the start widths are 16/16 unless `m8` / `x8` say otherwise). What it
prints is a reading, not a measurement: M3 used it for the laser objects
of bank $01 that no coverage scenario reached, and the port made from it
was then held against recordings (`matchship.mjs`).

    tools/sdis65816.py BANK START END [m8] [x8]     # hex, e.g. 01 D022 D92A
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op65816 import OPS, SIZE
from snesemu import ROM
rom = open(ROM, 'rb').read()
def dis(bank, start, end, m=False, x=False):
    a = start
    while a < end:
        off = (bank << 15) | (a & 0x7FFF)
        op = rom[off]
        name, mode = OPS[op]
        n = SIZE[mode]
        if n is None:
            n = 1 if (m if mode == 'immM' else x) else 2
        size = 1 + n
        operand = int.from_bytes(rom[off+1:off+size], 'little') if n else None
        text = name + ' '
        if mode in ('rel',):
            text += '$%04X' % ((a + 2 + (operand - 256 if operand >= 128 else operand)) & 0xFFFF)
        elif mode == 'rell':
            text += '$%04X' % ((a + 3 + (operand - 65536 if operand >= 32768 else operand)) & 0xFFFF)
        elif n:
            text += mode.replace('dp', '$%02X' % operand if n == 1 else '').replace('abs', '$%04X' % operand if n == 2 else '').replace('long', '$%06X' % operand if n == 3 else '').replace('immM', '#$%0*X' % (n*2, operand)).replace('immX', '#$%0*X' % (n*2, operand)).replace('imm', '#$%02X' % operand).replace('sig', '#$%02X' % operand).replace('move', '$%02X,$%02X' % (operand & 0xFF, operand >> 8))
        print('  $%02X:%04X  %-12s %s/%s  %s' % (bank, a, ' '.join('%02x' % b for b in rom[off:off+size]), 8 if m else 16, 8 if x else 16, text))
        if name == 'SEP':
            if operand & 0x20: m = True
            if operand & 0x10: x = True
        if name == 'REP':
            if operand & 0x20: m = False
            if operand & 0x10: x = False
        a += size
if __name__ == '__main__':
    bank, s, e = int(sys.argv[1], 16), int(sys.argv[2], 16), int(sys.argv[3], 16)
    dis(bank, s, e, 'm8' in sys.argv, 'x8' in sys.argv)
