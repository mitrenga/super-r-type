#!/usr/bin/env python3
"""disspc700 — zvuk Super R-Type: co hra posílá do SPC700, mapa ARAM a vstupní body.

Krok M0 (`MILNIKY.md`, „SPC700"; plný rozbor ovladače je M6). ★ Z kódu
65C816 (`sources/asm/main.asm`):

- `S_00A3D1` (při resetu) nahraje protokolem IPL dva řetězy bloků:
  **`$0D:8000`** a **`$0E:8000`**; blok = `[velikost 16 b][adresa ARAM
  16 b][data]`, řetěz končí blokem s velikostí 0, jehož adresa je skok;
  mezi řetězy pošle povel `$F8` / `$FF` (porty `$2140` / `$2141`).
- `S_00A4AE` (A = číslo skladby, např. z `$04:8A3F` podle úrovně) vezme
  ukazatel z tabulky **`$04:837B`** (3 bajty: adresa, banka) a nahraje
  stejným protokolem data skladby; potom pošle `$15DD`.

Nástroj bloky rozebere z ROM, složí mapu ARAM, **porovná ji s ARAM
z běhu** (`snesemu.py`, snímek po nahrání) a od vstupního bodu ovladače
rozloží kód SPC700 staticky (větve, `CALL`, `PCALL`; `TCALL` a nepřímé
skoky ne). Výstup `sources/asm/spc/`.

    ./tools/disspc700.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from snesemu import SnesEmu, ROM, PROJECT

OUT = os.path.join(PROJECT, 'sources', 'asm', 'spc')
DRIVER_CHAINS = [0x0D8000, 0x0E8000]
SONG_TABLE = 0x04837B

# SPC700: (mnemonika, formát operandu). Formáty: '' žádný, 'd' přímá stránka,
# 'a' absolutní 16 b, 'i' #imm, 'r' relativní, 'dr' d + rel, 'dd' d,d (zdroj první
# v kódu: dd = cíl, ds = zdroj), 'di' d,#imm, 'mb' m.b (13 b + 3 b), 'u' PCALL
_T = {}
def _row(lo, items):
    for hi, (mn, f) in enumerate(items):
        _T[(hi << 4) | lo] = (mn, f)
_row(0x0, [('NOP', ''), ('BPL', 'r'), ('CLRP', ''), ('BMI', 'r'), ('SETP', ''), ('BVC', 'r'), ('CLRC', ''), ('BVS', 'r'),
           ('SETC', ''), ('BCC', 'r'), ('EI', ''), ('BCS', 'r'), ('DI', ''), ('BNE', 'r'), ('CLRV', ''), ('BEQ', 'r')])
_row(0x1, [('TCALL %d' % i, '') for i in range(16)])
_row(0x2, [('SET1 d.%d' % (i // 2), 'd') if i % 2 == 0 else ('CLR1 d.%d' % (i // 2), 'd') for i in range(16)])
_row(0x3, [('BBS d.%d' % (i // 2), 'dr') if i % 2 == 0 else ('BBC d.%d' % (i // 2), 'dr') for i in range(16)])
_ALU = ['OR', 'AND', 'EOR', 'CMP', 'ADC', 'SBC']
_row(0x4, [(m, 'd') for a in _ALU for m in (a + ' A,d', a + ' A,d+X')] + [('MOV d,A', 'd'), ('MOV d+X,A', 'd'), ('MOV A,d', 'd'), ('MOV A,d+X', 'd')])
_row(0x5, [(m, 'a') for a in _ALU for m in (a + ' A,!a', a + ' A,!a+X')] + [('MOV !a,A', 'a'), ('MOV !a+X,A', 'a'), ('MOV A,!a', 'a'), ('MOV A,!a+X', 'a')])
_row(0x6, [x for a in _ALU for x in ((a + ' A,(X)', ''), (a + ' A,!a+Y', 'a'))] + [('MOV (X),A', ''), ('MOV !a+Y,A', 'a'), ('MOV A,(X)', ''), ('MOV A,!a+Y', 'a')])
_row(0x7, [(m, 'd') for a in _ALU for m in (a + ' A,[d+X]', a + ' A,[d]+Y')] + [('MOV [d+X],A', 'd'), ('MOV [d]+Y,A', 'd'), ('MOV A,[d+X]', 'd'), ('MOV A,[d]+Y', 'd')])
_row(0x8, [x for a in _ALU for x in ((a + ' A,#i', 'i'), (a + ' d,#i', 'di'))] + [('CMP X,#i', 'i'), ('MOV d,X', 'd'), ('MOV A,#i', 'i'), ('MOV X,d', 'd')])
_row(0x9, [x for a in _ALU for x in ((a + ' dd,ds', 'dd'), (a + ' (X),(Y)', ''))] + [('MOV !a,X', 'a'), ('MOV d+Y,X', 'd'), ('MOV X,!a', 'a'), ('MOV X,d+Y', 'd')])
_row(0xA, [('OR1 C,m.b', 'mb'), ('DECW d', 'd'), ('OR1 C,/m.b', 'mb'), ('INCW d', 'd'), ('AND1 C,m.b', 'mb'), ('CMPW YA,d', 'd'),
           ('AND1 C,/m.b', 'mb'), ('ADDW YA,d', 'd'), ('EOR1 C,m.b', 'mb'), ('SUBW YA,d', 'd'), ('MOV1 C,m.b', 'mb'), ('MOVW YA,d', 'd'),
           ('MOV1 m.b,C', 'mb'), ('MOVW d,YA', 'd'), ('NOT1 m.b', 'mb'), ('MOV dd,ds', 'dd')])
_row(0xB, [(m + s, 'd') for m in ('ASL', 'ROL', 'LSR', 'ROR', 'DEC', 'INC') for s in (' d', ' d+X')] +
     [('MOV d,Y', 'd'), ('MOV d+X,Y', 'd'), ('MOV Y,d', 'd'), ('MOV Y,d+X', 'd')])
_row(0xC, [x for m in ('ASL', 'ROL', 'LSR', 'ROR', 'DEC', 'INC') for x in ((m + ' !a', 'a'), (m + ' A', ''))] +
     [('MOV !a,Y', 'a'), ('DEC Y', ''), ('MOV Y,!a', 'a'), ('INC Y', '')])
_row(0xD, [('PUSH PSW', ''), ('DEC X', ''), ('PUSH A', ''), ('INC X', ''), ('PUSH X', ''), ('MOV X,A', ''), ('PUSH Y', ''), ('MOV A,X', ''),
           ('MOV Y,#i', 'i'), ('MOV X,SP', ''), ('CMP Y,#i', 'i'), ('MOV SP,X', ''), ('MOV X,#i', 'i'), ('MOV A,Y', ''), ('NOTC', ''), ('MOV Y,A', '')])
_row(0xE, [('TSET1 !a', 'a'), ('CMP X,!a', 'a'), ('CBNE d', 'dr'), ('CMP X,d', 'd'), ('TCLR1 !a', 'a'), ('CMP Y,!a', 'a'), ('DBNZ d', 'dr'), ('CMP Y,d', 'd'),
           ('POP PSW', ''), ('DIV YA,X', ''), ('POP A', ''), ('DAS', ''), ('POP X', ''), ('CBNE d+X', 'dr'), ('POP Y', ''), ('DBNZ Y', 'r')])
_row(0xF, [('BRK', ''), ('JMP [!a+X]', 'a'), ('BRA', 'r'), ('CALL', 'a'), ('PCALL', 'u'), ('JMP', 'a'), ('RET', ''), ('RETI', ''),
           ('MOV d,#i', 'di'), ('XCN A', ''), ('MOV (X)+,A', ''), ('MOV A,(X)+', ''), ('MUL YA', ''), ('DAA', ''), ('SLEEP', ''), ('STOP', '')])
assert len(_T) == 256
SIZE = {'': 1, 'd': 2, 'a': 3, 'i': 2, 'r': 2, 'dr': 3, 'dd': 3, 'di': 3, 'mb': 3, 'u': 2}
STOPS = {'JMP', 'JMP [!a+X]', 'BRA', 'RET', 'RETI', 'STOP', 'SLEEP', 'BRK'}


def lorom(addr):
    return (((addr >> 16) & 0x7F) << 15) | (addr & 0x7FFF)


def chain(rom, addr):
    """Řetěz bloků IPL od adresy CPU → [(ARAM adresa, data, odkud)], skok."""
    o = lorom(addr)
    blocks = []
    for _ in range(256):
        size = rom[o] | rom[o + 1] << 8
        dest = rom[o + 2] | rom[o + 3] << 8
        if size == 0:
            return blocks, dest, o + 4
        src = o + 4
        data = rom[src:src + size]
        blocks.append((dest, data, src))
        o = src + size
    raise ValueError('řetěz bez konce na $%06X' % addr)


def disasm(aram, entries):
    seen, out, todo, labels = {}, [], list(entries), set(entries)
    while todo:
        pc = todo.pop()
        while 0 <= pc < 0x10000 and pc not in seen:
            op = aram[pc]
            mn, f = _T[op]
            n = SIZE[f]
            b = aram[pc:pc + n]
            arg, target = '', None
            if f == 'd':
                arg = '$%02X' % b[1]
            elif f == 'a':
                arg = '$%04X' % (b[1] | b[2] << 8)
                if mn in ('JMP', 'CALL'):
                    target = b[1] | b[2] << 8
            elif f == 'i':
                arg = '#$%02X' % b[1]
            elif f == 'r':
                target = (pc + 2 + (b[1] - 256 if b[1] >= 128 else b[1])) & 0xFFFF
                arg = '$%04X' % target
            elif f == 'dr':
                target = (pc + 3 + (b[2] - 256 if b[2] >= 128 else b[2])) & 0xFFFF
                arg = '$%02X,$%04X' % (b[1], target)
            elif f == 'dd':
                arg = '$%02X,$%02X' % (b[2], b[1])
            elif f == 'di':
                arg = '$%02X,#$%02X' % (b[2], b[1])
            elif f == 'mb':
                v = b[1] | b[2] << 8
                arg = '$%04X.%d' % (v & 0x1FFF, v >> 13)
            elif f == 'u':
                target = 0xFF00 | b[1]
                arg = '$%02X' % b[1]
            seen[pc] = (b, mn, arg)
            if target is not None:
                labels.add(target)
                todo.append(target)
            if mn in STOPS:
                break
            pc += n
    return seen, labels


def render(mn, b, pc):
    """Šablona mnemoniky (d, !a, #i, r, m.b, dd/ds) → text s hodnotami."""
    import re
    mn, f = mn, None
    for op, (m, ff) in _T.items():
        if op == b[0]:
            f = ff
    t = mn
    if f == 'dd':
        t = t.replace('dd,ds', '$%02X,$%02X' % (b[2], b[1]))
    elif f == 'di':
        t = t.replace('#i', '#$%02X' % b[1])
        t = re.sub(r'\bd\b', '$%02X' % b[2], t)
    elif f == 'mb':
        v = b[1] | b[2] << 8
        t = t.replace('m.b', '$%04X.%d' % (v & 0x1FFF, v >> 13))
    elif f in ('r', 'dr'):
        k = len(b) - 1
        tgt = (pc + len(b) + (b[k] - 256 if b[k] >= 128 else b[k])) & 0xFFFF
        if f == 'dr':
            t = re.sub(r'\bd\b', '$%02X' % b[1], t, count=1) + ',$%04X' % tgt
        else:
            t = t + ' $%04X' % tgt
    elif f == 'i':
        t = t.replace('#i', '#$%02X' % b[1])
    elif f == 'a':
        v = '$%04X' % (b[1] | b[2] << 8)
        t = t.replace('!a', '!' + v) if '!a' in t else t + ' ' + v
    elif f == 'd':
        t = re.sub(r'\bd\b', '$%02X' % b[1], t, count=1)
    elif f == 'u':
        t = t + ' $FF%02X' % b[1]
    return t


def main():
    rom = open(ROM, 'rb').read()
    os.makedirs(OUT, exist_ok=True)
    aram = bytearray(0x10000)
    owner = {}
    md = ['# spc — co hra posílá do SPC700 (tools/disspc700.py)', '',
          '★ z kódu 65C816 a z ROM; ARAM porovnaná s během (`snesemu.py`). Plný rozbor ovladače je M6.', '',
          '## Ovladač (při resetu, `S_00A3D1`)', '',
          '| řetěz | blok | ROM | ARAM | velikost |', '|---|---|---|---|---|']
    jumps = []
    for c in DRIVER_CHAINS:
        blocks, jump, end = chain(rom, c)
        for i, (dest, data, src) in enumerate(blocks):
            aram[dest:dest + len(data)] = data
            for j in range(len(data)):
                owner[dest + j] = c
            md.append('| `$%02X:%04X` | %d | `$%06X` | `$%04X`–`$%04X` | %d B |' % (
                c >> 16, c & 0xFFFF, i, src, dest, dest + len(data) - 1, len(data)))
        md.append('| `$%02X:%04X` | konec | `$%06X` | skok `$%04X` | — |' % (c >> 16, c & 0xFFFF, end - 4, jump))
        jumps.append(jump)

    # skladby: tabulka $04:837B, dokud ukazatel míří do ROM a řetěz dává smysl
    md += ['', '## Skladby (`S_00A4AE`, tabulka `$04:837B`)', '',
           '| č. | ukazatel | bloky (ARAM, velikost) | skok |', '|---|---|---|---|']
    t = lorom(SONG_TABLE)
    songs = []
    for k in range(64):
        addr = rom[t + 3 * k] | rom[t + 3 * k + 1] << 8 | rom[t + 3 * k + 2] << 16
        if addr & 0xFFFF < 0x8000 or (addr >> 16) > 0x1F:
            break
        try:
            blocks, jump, _ = chain(rom, addr)
        except (ValueError, IndexError):
            break
        if not blocks or any(len(d) == 0 for _, d, _ in blocks):
            break
        songs.append((k, addr, blocks, jump))
        md.append('| %d | `$%02X:%04X` | %s | `$%04X` |' % (
            k, addr >> 16, addr & 0xFFFF,
            ', '.join('`$%04X` %d B' % (d, len(x)) for d, x, _ in blocks), jump))

    # kontrola proti běhu: ARAM po nahrání ovladače (snímek 120) a po startu úrovně
    e = SnesEmu()
    e.capture('boot', 120, what=('aram',))
    r = e.run(frames=120)
    run_aram = r.mem('boot', 'aram')
    diff = [a for a in owner if aram[a] != run_aram[a]]
    md += ['', '## Kontrola proti běhu', '',
           'ARAM ze `snesemu.py` na snímku 120 (po nahrání ovladače): z %d bajtů nahraných bloků '
           'se **liší %d**%s.' % (len(owner), len(diff),
                                  (' — první `$%04X`' % min(diff)) if diff else ' — mapa sedí bajt po bajtu')]
    if diff:
        md.append('(Rozdíl = ovladač si po startu data přepsal; rozsahy: %s)' % ', '.join(
            '`$%04X`' % a for a in sorted(diff)[:12]))

    # ★ jen první řetěz skáče do kódu (vstup ovladače); vzorky a skladby přijímá
    # už běžící ovladač a jejich koncový blok má adresu 0 = „bez skoku"
    entry = jumps[0]
    seen, labels = disasm(aram, [entry])
    md += ['', '## Vstupní body', '',
           '- **vstup ovladače `$%04X`** (skok po řetězu `$0D:8000`); řetěz `$0E:8000` (vzorky) a skladby '
           'končí adresou `$%04X` = bez skoku — přijímá je už běžící ovladač' % tuple(jumps),
           '- staticky rozloženo od vstupu: %d instrukcí, %d návěští (`driver.asm`); `TCALL` '
           'a `JMP [!a+X]` se nesledují' % (len(seen), len(labels)),
           '- porty: CPU `$2140`–`$2143` = SPC700 `$F4`–`$F7`; povely hry `$F8`, `$FF` (návrat do '
           'zavaděče — ? podle protokolu výš) a číslo z `$15DD` po skladbě; rozbor M6', '']
    asm = ['; ovladač SPC700 Super R-Type — statické rozložení od vstupu $%04X (tools/disspc700.py)' % entry,
           '; ARAM složená z bloků $0D:8000 a $0E:8000; jen dosažitelný kód, plný rozbor M6', '']
    for pc in sorted(seen):
        b, mn, arg = seen[pc]
        if pc in labels:
            asm.append('')
            asm.append('L_%04X:' % pc)
        asm.append('  $%04X  %-9s %s' % (pc, ' '.join('%02x' % x for x in b), render(mn, b, pc)))
    open(os.path.join(OUT, 'driver.asm'), 'w').write('\n'.join(asm) + '\n')
    open(os.path.join(OUT, 'README.md'), 'w').write('\n'.join(md) + '\n')
    print('\n'.join(md[-8:]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
