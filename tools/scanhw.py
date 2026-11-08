#!/usr/bin/env python3
"""scanhw — statický průzkum bajtů: která místa programu sahají na hardware.

Obdoba `impossiblemission/tools/scanhw.py` pro 65C816. Dvě části:

1. **Statická** (heuristika): ROM se projde lineárně a hledají se instrukce
   s absolutní (`abs`, `abs,X`, `abs,Y`) nebo dlouhou (`long`, `long,X`)
   adresou na I/O registrech — `$2100`–`$21FF` (PPU, APU, WRAM port),
   `$4016`/`$4017`, `$4200`–`$421F`, `$4300`–`$437F` (DMA/HDMA). Délka
   těch instrukcí na M/X nezávisí, ale lineární scan nerozliší kód od dat,
   takže nálezy jsou kandidáti. Navíc hledá triky s direct page
   (`LDA #$2100` / `#$4300` + `TCD`, `PEA` + `PLD`), přes které se na
   registry sahá dvoubajtově a staticky to vidět není.
2. **Za běhu** (★): `snesemu.py` (`watch_io`) zaznamená každý přístup
   CPU na tytéž registry ve všech zrcadlech bank — titulka, start hry
   a začátek úrovně 1. ★ MesenCE hlásí PC už posunuté za operand, takže
   nástroj začátek instrukce dohledá (PC−2/−3/−4 s odpovídajícím
   operandem) a přístup zařadí: **přímo** (`abs`/`long` na ten registr),
   **indexem** (`STA $2100,Y` ze smyčky nad tabulkou), **dp** (direct
   page), **DMA** (přenos spuštěný zápisem `$420B`). Místo, které za běh
   sáhne na víc než `INIT_REGS` registrů, je hromadná smyčka (nulování
   PPU po resetu) a počítá se zvlášť — jinak by „použité" byly všechny
   registry.

    ./tools/scanhw.py                       # statika + běh do snímku 3000
    ./tools/scanhw.py --frames 0            # jen statika
    ./tools/scanhw.py --pc                  # vypsat i adresy instrukcí

Výstup jde na stdout a do `build/scanhw.txt`; rozbor je v
`sources/docs/hw_notes.md`.
"""
import argparse, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op65816 import OPS, FLOW
from snesemu import SnesEmu, ROM, PROJECT

# ★ vstup, který na titulce spustí hru (snesemu.py, 2026-10-18): jeden stisk
# START nestačí, série krátkých ano
START_TAPS = [(720, 724, 'start'), (760, 764, 'start'), (800, 804, 'start'), (840, 844, 'a')]

PPU = {
    0x2100: 'INIDISP jas, forced blank', 0x2101: 'OBSEL velikost a adresa sprajtů',
    0x2102: 'OAMADDL', 0x2103: 'OAMADDH', 0x2104: 'OAMDATA', 0x2105: 'BGMODE režim, velikost dlaždic',
    0x2106: 'MOSAIC', 0x2107: 'BG1SC mapa BG1', 0x2108: 'BG2SC mapa BG2', 0x2109: 'BG3SC mapa BG3',
    0x210A: 'BG4SC mapa BG4', 0x210B: 'BG12NBA dlaždice BG1/2', 0x210C: 'BG34NBA dlaždice BG3/4',
    0x210D: 'BG1HOFS (M7HOFS)', 0x210E: 'BG1VOFS (M7VOFS)', 0x210F: 'BG2HOFS', 0x2110: 'BG2VOFS',
    0x2111: 'BG3HOFS', 0x2112: 'BG3VOFS', 0x2113: 'BG4HOFS', 0x2114: 'BG4VOFS',
    0x2115: 'VMAIN přírůstek VRAM', 0x2116: 'VMADDL', 0x2117: 'VMADDH', 0x2118: 'VMDATAL', 0x2119: 'VMDATAH',
    0x211A: 'M7SEL', 0x211B: 'M7A (násobička)', 0x211C: 'M7B (násobička)', 0x211D: 'M7C', 0x211E: 'M7D',
    0x211F: 'M7X', 0x2120: 'M7Y', 0x2121: 'CGADD', 0x2122: 'CGDATA',
    0x2123: 'W12SEL okna BG1/2', 0x2124: 'W34SEL okna BG3/4', 0x2125: 'WOBJSEL okna OBJ/barva',
    0x2126: 'WH0 okno 1 vlevo', 0x2127: 'WH1 okno 1 vpravo', 0x2128: 'WH2 okno 2 vlevo', 0x2129: 'WH3 okno 2 vpravo',
    0x212A: 'WBGLOG', 0x212B: 'WOBJLOG', 0x212C: 'TM hlavní obraz', 0x212D: 'TS vedlejší obraz',
    0x212E: 'TMW okna hlavního', 0x212F: 'TSW okna vedlejšího', 0x2130: 'CGWSEL barevná matematika',
    0x2131: 'CGADSUB barevná matematika', 0x2132: 'COLDATA pevná barva', 0x2133: 'SETINI (interlace, overscan)',
    0x2134: 'MPYL', 0x2135: 'MPYM', 0x2136: 'MPYH', 0x2137: 'SLHV zachytí H/V čítač',
    0x2138: 'RDOAM', 0x2139: 'RDVRAML', 0x213A: 'RDVRAMH', 0x213B: 'RDCGRAM',
    0x213C: 'OPHCT H čítač', 0x213D: 'OPVCT V čítač', 0x213E: 'STAT77', 0x213F: 'STAT78 (PAL bit, latch)',
    0x2140: 'APUIO0 port zvuku', 0x2141: 'APUIO1 port zvuku', 0x2142: 'APUIO2 port zvuku', 0x2143: 'APUIO3 port zvuku',
    0x2180: 'WMDATA port WRAM', 0x2181: 'WMADDL', 0x2182: 'WMADDM', 0x2183: 'WMADDH',
}
CPU = {
    0x4016: 'JOYSER0 ruční čtení ovladače', 0x4017: 'JOYSER1',
    0x4200: 'NMITIMEN NMI, IRQ, autočtení', 0x4201: 'WRIO', 0x4202: 'WRMPYA', 0x4203: 'WRMPYB',
    0x4204: 'WRDIVL', 0x4205: 'WRDIVH', 0x4206: 'WRDIVB', 0x4207: 'HTIMEL', 0x4208: 'HTIMEH',
    0x4209: 'VTIMEL', 0x420A: 'VTIMEH', 0x420B: 'MDMAEN spustí DMA', 0x420C: 'HDMAEN kanály HDMA',
    0x420D: 'MEMSEL FastROM', 0x4210: 'RDNMI příznak NMI', 0x4211: 'TIMEUP příznak IRQ',
    0x4212: 'HVBJOY vblank, hblank, autočtení', 0x4213: 'RDIO', 0x4214: 'RDDIVL', 0x4215: 'RDDIVH',
    0x4216: 'RDMPYL', 0x4217: 'RDMPYH', 0x4218: 'JOY1L ovladač 1', 0x4219: 'JOY1H ovladač 1',
    0x421A: 'JOY2L', 0x421B: 'JOY2H', 0x421C: 'JOY3L', 0x421D: 'JOY3H', 0x421E: 'JOY4L', 0x421F: 'JOY4H',
}
DMA = ['DMAP režim', 'BBAD cíl', 'A1TL zdroj', 'A1TH zdroj', 'A1B banka', 'DASL velikost / nepřímá',
       'DASH', 'DASB banka nepřímé HDMA', 'A2AL tabulka HDMA', 'A2AH', 'NLTR čítač řádků', '(nepoužito)']

# skupiny podle otázek M0 (MILNIKY.md, statický průzkum)
GROUPS = [
    ('vstup', [0x4016, 0x4017] + list(range(0x4218, 0x4220))),
    ('H/V čítač (entropie)', [0x2137, 0x213C, 0x213D, 0x213F]),
    ('NMI, IRQ, vblank (zpomalení)', [0x4200, 0x4207, 0x4208, 0x4209, 0x420A, 0x4210, 0x4211, 0x4212]),
    ('režim a obraz', [0x2100, 0x2105, 0x2106, 0x2133, 0x212C, 0x212D]),
    ('mapy a dlaždice', list(range(0x2107, 0x210D))),
    ('scroll', list(range(0x210D, 0x2115))),
    ('Mode 7', list(range(0x211A, 0x2121))),
    ('okna a barevná matematika', list(range(0x2123, 0x212C)) + [0x212E, 0x212F, 0x2130, 0x2131, 0x2132]),
    ('sprajty (OAM)', [0x2101, 0x2102, 0x2103, 0x2104, 0x2138]),
    ('VRAM a CGRAM', [0x2115, 0x2116, 0x2117, 0x2118, 0x2119, 0x2139, 0x213A, 0x2121, 0x2122, 0x213B]),
    ('DMA a HDMA', [0x420B, 0x420C] + list(range(0x4300, 0x4380))),
    ('zvuk (porty SPC700)', [0x2140, 0x2141, 0x2142, 0x2143]),
    ('násobička a dělička', [0x2134, 0x2135, 0x2136] + list(range(0x4202, 0x4207)) + list(range(0x4214, 0x4218))),
    ('WRAM port a ostatní', [0x2180, 0x2181, 0x2182, 0x2183, 0x4201, 0x4213, 0x420D, 0x213E]),
]


def reg_of(a):
    """16bitová adresa → kanonický registr (porty APU se zrcadlí do $217F)."""
    if 0x2140 <= a <= 0x217F:
        return 0x2140 + (a & 3)
    if 0x2100 <= a <= 0x21FF or 0x4016 <= a <= 0x4017 or 0x4200 <= a <= 0x421F or 0x4300 <= a <= 0x437F:
        return a
    return None


def reg_name(r):
    if r in PPU:
        return PPU[r]
    if r in CPU:
        return CPU[r]
    if 0x4300 <= r <= 0x437F:
        return 'DMA%d %s' % ((r >> 4) & 7, DMA[r & 0x0F] if (r & 0x0F) < len(DMA) else '(nepoužito)')
    return '?'


INIT_REGS = 16


def resolve(rom, pc, reg):
    """PC za instrukcí (jak ho hlásí MesenCE) → (začátek, druh přístupu).

    ★ přímo: `abs`/`long` na registr, nebo o jeden níž (16bitový přístup
    zapíše i registr+1); DMA: přenos se hlásí s PC o 1 za instrukcí, která
    zapsala `$420B` (zjištěno 2026-10-18); tabulka: `STA $0000,X` s adresou
    registru v indexu (inicializace z tabulek `$04:8020`…); indexem:
    `abs,X`/`abs,Y` s bází na registru; dp: direct page."""
    after = rom_off(pc)
    if after is None:
        return pc, '?'
    for n in (4, 3):
        o = after - n
        mn, mode = OPS[rom[o]]
        if mode == 'abs' and mn in ('STA', 'STX', 'STY', 'STZ') and \
                (rom[o + 1] | rom[o + 2] << 8) in (0x420B, 0x420C) and reg not in (0x420B, 0x420C):
            return pc - n, 'DMA'
    for n in (3, 4, 2):
        o = after - n
        if o < 0:
            continue
        mn, mode = OPS[rom[o]]
        if (n == 3 and mode in ('abs', 'abs,X', 'abs,Y')) or (n == 4 and mode in ('long', 'long,X')):
            base = rom[o + 1] | rom[o + 2] << 8
            if mode in ('abs', 'long'):
                if reg_of(base) == reg:
                    return pc - n, 'přímo'
                if reg_of(base) is not None and base + 1 == reg:
                    return pc - n, 'přímo 16 b'
            elif base < 0x2100:
                return pc - n, 'tabulka'
            elif reg_of(base) is not None:
                return pc - n, 'indexem'
        elif n == 2 and mode in ('dp', 'dp,X', 'dp,Y', '(dp)', '(dp),Y', '(dp,X)', '[dp]', '[dp],Y'):
            return pc - n, 'dp'
    return pc, '?'


def cpu_addr(off):
    return ((off >> 15) << 16) | 0x8000 | (off & 0x7FFF)


def scan(rom):
    """Lineární scan: {registr: [(pc, mnemonika+režim)]}, triky s direct page."""
    hits, dp = {}, []
    for off in range(len(rom) - 3):
        op = rom[off]
        mn, mode = OPS[op]
        if mn in FLOW:
            continue
        if mode in ('abs', 'abs,X', 'abs,Y'):
            r = reg_of(rom[off + 1] | rom[off + 2] << 8)
            if r is not None:
                hits.setdefault(r, []).append((cpu_addr(off), '%s %s' % (mn, mode)))
        elif mode in ('long', 'long,X'):
            bank = rom[off + 3]
            if bank < 0x40 or 0x80 <= bank < 0xC0:
                r = reg_of(rom[off + 1] | rom[off + 2] << 8)
                if r is not None:
                    hits.setdefault(r, []).append((cpu_addr(off), '%s %s' % (mn, mode)))
        # direct page na registry: LDA #$2100/#$4300 + TCD, PEA $2100/$4300 + PLD
        if op == 0xA9 and rom[off + 1] == 0x00 and rom[off + 2] in (0x21, 0x42, 0x43) and rom[off + 3] == 0x5B:
            dp.append((cpu_addr(off), 'LDA #$%02X00 / TCD' % rom[off + 2]))
        if op == 0xF4 and rom[off + 1] == 0x00 and rom[off + 2] in (0x21, 0x42, 0x43) and rom[off + 3] == 0x2B:
            dp.append((cpu_addr(off), 'PEA $%02X00 / PLD' % rom[off + 2]))
    return hits, dp


def rom_off(pc):
    """24bitová adresa v ROM (LoROM, banky $00-$7D / $80-$FF) → offset, jinak None."""
    bank, a = (pc >> 16) & 0x7F, pc & 0xFFFF
    if a < 0x8000 or bank > 0x7D:
        return None
    return (bank << 15) | (a & 0x7FFF)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--rom', default=ROM)
    ap.add_argument('--frames', type=int, default=3000, help='běh do snímku (0 = jen statika)')
    ap.add_argument('--pc', action='store_true', help='vypsat adresy instrukcí')
    ap.add_argument('--out', default=os.path.join(PROJECT, 'build', 'scanhw.txt'))
    a = ap.parse_args()

    rom = open(a.rom, 'rb').read()
    out = io.StringIO()
    def p(*args):
        print(*args)
        print(*args, file=out)

    hits, dp = scan(rom)
    io_ = {}
    if a.frames:
        e = SnesEmu(a.rom)
        for t in START_TAPS:
            e.press(*t)
        e.watch_io()
        e.capture('end', a.frames, what=('screen',))
        r = e.run(frames=a.frames)
        # hromadné smyčky: místa, která za běhu sáhla na víc než INIT_REGS registrů
        regs_by_pc = {}
        for (reg, kind, pc) in r.io:
            regs_by_pc.setdefault(pc, set()).add(reg_of(reg))
        bulk = {pc for pc, rs in regs_by_pc.items() if len(rs) > INIT_REGS}
        for (reg, kind, pc), (n, first, last) in r.io.items():
            rr = reg_of(reg)
            if rr is None:
                continue
            d = io_.setdefault(rr, {'R': 0, 'W': 0, 'pcs': {}, 'how': {}, 'bulk': 0,
                                    'first': None, 'last': None})
            if pc in bulk:
                d['bulk'] += n
                continue
            start, how = resolve(rom, pc, rr)
            if how == 'tabulka':
                d['bulk'] += n
                continue
            d[kind] += n
            d['pcs'][start] = d['pcs'].get(start, 0) + n
            d['how'][start] = how
            d['first'] = first if d['first'] is None else min(d['first'], first)
            d['last'] = last if d['last'] is None else max(d['last'], last)

    p('ROM: %s, %d B' % (os.path.basename(a.rom), len(rom)))
    p('statika: lineární scan (heuristika — data, která vypadají jako kód, dávají falešné nálezy)')
    p('běh: %s' % (('snesemu.py, snímky 0–%d, START na titulce (%s), watch_io ve všech zrcadlech bank'
                    % (a.frames, ', '.join('%d' % t[0] for t in START_TAPS))) if a.frames else 'ne'))
    p()
    vec = rom[0x7FE0:0x8000]
    w = lambda o: vec[o] | vec[o + 1] << 8
    p('vektory: RESET (E) $%04X, NMI $%04X, IRQ $%04X, BRK $%04X, COP $%04X; NMI (E) $%04X, IRQ/BRK (E) $%04X'
      % (w(0x1C), w(0x0A), w(0x0E), w(0x06), w(0x04), w(0x1A), w(0x1E)))
    for name, v in (('RESET', w(0x1C)), ('NMI', w(0x0A)), ('IRQ', w(0x0E))):
        o = rom_off(v)
        p('  %-5s $00:%04X  %s' % (name, v, ' '.join('%02x' % b for b in rom[o:o + 16])))
    p()

    seen = set()
    total_static = total_confirmed = 0
    for title, regs in GROUPS:
        rows = []
        for reg in regs:
            seen.add(reg)
            st = hits.get(reg, [])
            dy = io_.get(reg)
            if not st and not dy:
                continue
            dpcs = {pc & 0x7FFFFF for pc in dy['pcs']} if dy else set()
            conf = [h for h in st if (h[0] & 0x7FFFFF) in dpcs]
            total_static += len(st)
            total_confirmed += len(conf)
            static_pcs = {h[0] & 0x7FFFFF for h in st}
            other = sorted(pc for pc in (dy['pcs'] if dy else {})
                           if (pc & 0x7FFFFF) not in static_pcs and dy['how'][pc] != 'přímo 16 b')
            rows.append((reg, st, conf, dy, other))
        if not rows:
            p('## %s — nic' % title)
            p()
            continue
        p('## %s' % title)
        p('  registr  %-34s %5s %5s %9s %9s %6s  %s' % ('', 'míst', '★běh', 'čtení', 'zápisů', 'init', 'snímky, jak'))
        for reg, st, conf, dy, other in rows:
            used = dy and (dy['R'] or dy['W'])
            hows = sorted({dy['how'][pc] for pc in dy['pcs']}) if used else []
            p('  $%04X    %-34s %5d %5d %9s %9s %6s  %s' % (
                reg, reg_name(reg)[:34], len(st), len(conf),
                dy['R'] if dy else '-', dy['W'] if dy else '-', dy['bulk'] if dy else '-',
                ('%d–%d, %s' % (dy['first'], dy['last'], '/'.join(hows))) if used else
                ('jen inicializace' if dy else '')))
            indirect = other
            if a.pc:
                if st:
                    p('           statika: ' + ' '.join(('$%02X:%04X%s' % (pc >> 16, pc & 0xFFFF, '★' if (pc, m) in conf else ''))
                                                      for pc, m in st[:16]) + (' …' if len(st) > 16 else ''))
                if indirect:
                    desc = []
                    for pc in indirect[:12]:
                        o = rom_off(pc)
                        desc.append('$%02X:%04X %s (%s)' % (pc >> 16, pc & 0xFFFF,
                                    ('%s %s' % OPS[rom[o]]) if o is not None else 'mimo ROM', dy['how'][pc]))
                    p('           jen za běhu: ' + ', '.join(desc) + (' …' if len(indirect) > 12 else ''))
        p()

    other = sorted(set(hits) | set(io_))
    other = [r for r in other if r not in seen]
    if other:
        p('## ostatní adresy v I/O oblasti')
        for reg in other:
            st, dy = hits.get(reg, []), io_.get(reg)
            p('  $%04X  %-34s míst %3d  běh %s' % (reg, reg_name(reg)[:34], len(st),
                                                  ('čtení %d zápisů %d' % (dy['R'], dy['W'])) if dy else '-'))
        p()

    p('## direct page na registrech (staticky)')
    for pc, what in dp:
        p('  $%02X:%04X  %s' % (pc >> 16, pc & 0xFFFF, what))
    if not dp:
        p('  nic')
    p()
    used = [r for r, d in io_.items() if d['R'] or d['W']]
    p('statických míst %d, z toho potvrzených během %d; registrů sahaných za běhu %d '
      '(mimo hromadné smyčky %d)' % (total_static, total_confirmed, len(io_), len(used)))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    open(a.out, 'w').write(out.getvalue())
    return 0


if __name__ == '__main__':
    sys.exit(main())
