#!/usr/bin/env python3
"""matchcart — dumpy cartridge proti No-Intro, hlavička a rozdíly regionů.

Akceptační měřidlo M0 (`../MILNIKY.md`, `../METHODOLOGY.md`): cartridge
nemá loader, takže „obraz" je přímo dump ROM. Ten se doloží třikrát:

1. **hash proti No-Intro** (velikost, CRC32, MD5, SHA-1) — dump, který
   nesedí, se nepoužije;
2. **vnitřní hlavička** (LoROM `$7FC0` / HiROM `$FFC0` / ExHiROM
   `$40FFC0`, vybraná skóre) a **přepočet kontrolního součtu** proti
   hodnotě v hlavičce;
3. **dva dumpy téhož regionu bajt po bajtu** (druhý nezávislý zdroj).

Rozdíly mezi regiony se vypíšou po souvislých úsecích s adresami
`$BB:AAAA`; vysvětlené (`EXPLAINED`) se počítají zvlášť. Nula
**nevysvětlených** rozdílů a nula selhání v bodech 1–3 je to, co milník
požaduje.

    ./tools/matchcart.py                      # všechno v sources/cart/
    ./tools/matchcart.py a.sfc b.smc          # jen tyhle soubory
    ./tools/matchcart.py --verbose            # vypsat všechny neshodné úseky
    ./tools/matchcart.py --markdown           # tabulky pro sources/cart/README.md

Návratový kód: 0 = vše doloženo, 1 = selhal hash / součet / shoda dumpů,
2 = jen nevysvětlené rozdíly regionů.
"""
import argparse, glob, hashlib, os, sys, zlib

# No-Intro, Nintendo - Super Nintendo Entertainment System, DAT 2026.10.07
# (kopie z libretro-database, commit 9a899f5b, staženo 2026-10-18 —
# sources/FILES.md). Revize ani jiné varianty DAT neuvádí. Japonská verze
# (Japan) (En) je jiné sestavení programu a je mimo rozsah — rozhodl
# operátor 2026-10-18; dump JP tu proto neprojde (sources/cart/README.md).
NOINTRO = [
    # (jméno, region hlavičky, velikost, crc32, md5, sha1)
    ('Super R-Type (USA)', 'USA', 1048576, '8B22C830',
     'CFCD1FF3DA5309E5021EFAA58012058D', '44B0A3B66756B04EBC5753F78613FEADB85D6B74'),
    ('Super R-Type (Europe)', 'Europe', 1048576, '1631740D',
     '6DB650D56A9D0FD2AC81838EDF36FEF0', '8E51FFF3B4D065099788BFA69DAF27D41B4BFCF5'),
]

# rozdíly regionů, které jsou vysvětlené — (jméno A, jméno B, od, do, proč);
# od/do jsou offsety v souboru bez kopírovací hlavičky
US, EU = 'Super R-Type (USA)', 'Super R-Type (Europe)'
EXPLAINED = [
    (US, EU, 0x007FCE, 0x007FCE, 'název v hlavičce: „SUPER R-TYPE (A)" / „(E)"'),
    (US, EU, 0x007FD9, 0x007FDA, 'region a licence v hlavičce: $01 USA, $49 Irem / '
                                 '$02 Europe, $01 Nintendo (vydavatel EU)'),
    (US, EU, 0x007FDC, 0x007FDF, 'doplněk a kontrolní součet — důsledek ostatních rozdílů'),
    (US, EU, 0x020EDF, 0x020EE0, 'text na $04:8ED6: „LICENSED BY NINTENDO" / „LICENSED TO NINTENDO"'),
]

COPIER_HEADER = 512

# kandidáti na hlavičku: (offset v souboru, mapování, očekávaná dolní půlka $FFD5)
HEADER_CANDIDATES = [(0x007FC0, 'LoROM', 0x0), (0x00FFC0, 'HiROM', 0x1),
                     (0x40FFC0, 'ExHiROM', 0x5)]

# $FFD9 — cílový region (Fullsnes, „Cartridge Header")
DESTINATION = {
    0x00: ('Japan', 'NTSC'), 0x01: ('USA', 'NTSC'), 0x02: ('Europe', 'PAL'),
    0x03: ('Sweden', 'PAL'), 0x04: ('Finland', 'PAL'), 0x05: ('Denmark', 'PAL'),
    0x06: ('France', 'SECAM'), 0x07: ('Netherlands', 'PAL'), 0x08: ('Spain', 'PAL'),
    0x09: ('Germany', 'PAL'), 0x0A: ('Italy', 'PAL'), 0x0B: ('China', 'PAL'),
    0x0C: ('Indonesia', 'PAL'), 0x0D: ('Korea', 'NTSC'), 0x0E: ('International', '?'),
    0x0F: ('Canada', 'NTSC'), 0x10: ('Brazil', 'PAL-M'), 0x11: ('Australia', 'PAL'),
}

# $FFD6 — dolní půlka: složení desky, horní: koprocesor (jen pro $x3..$x6)
CART_LAYOUT = {0x0: 'ROM', 0x1: 'ROM+RAM', 0x2: 'ROM+RAM+baterie',
               0x3: 'ROM+koprocesor', 0x4: 'ROM+koprocesor+RAM',
               0x5: 'ROM+koprocesor+RAM+baterie', 0x6: 'ROM+koprocesor+baterie'}
COPROCESSOR = {0x0: 'DSP', 0x1: 'GSU (Super FX)', 0x2: 'OBC1', 0x3: 'SA-1',
               0x4: 'S-DD1', 0x5: 'S-RTC', 0xE: 'jiný', 0xF: 'vlastní'}

# vektory: (offset od začátku hlavičky, jméno)
VECTORS = [(0x24, 'COP'), (0x26, 'BRK'), (0x28, 'ABORT'), (0x2A, 'NMI'), (0x2E, 'IRQ'),
           (0x34, 'COP (E)'), (0x38, 'ABORT (E)'), (0x3A, 'NMI (E)'),
           (0x3C, 'RESET (E)'), (0x3E, 'IRQ/BRK (E)')]


def word(b, o):
    return b[o] | b[o + 1] << 8


def strip_copier(raw):
    """Odřízne 512 B kopírovací hlavičky `.smc`, pokud tam je."""
    if len(raw) % 1024 == COPIER_HEADER:
        return raw[COPIER_HEADER:], raw[:COPIER_HEADER]
    return raw, None


def checksum(rom):
    """Součet bajtů mod $10000; velikost, která není mocnina dvou, se
    doplní zrcadlením zbytku (Fullsnes, „Checksum")."""
    size = len(rom)
    if size & (size - 1) == 0:
        return sum(rom) & 0xFFFF
    base = 1 << (size.bit_length() - 1)
    rest = rom[base:]
    reps = base // len(rest)
    return (sum(rom[:base]) + sum(rest) * reps) & 0xFFFF


def score_header(rom, off, low):
    """Skóre kandidáta na hlavičku — vyšší = věrohodnější."""
    if off + 0x40 > len(rom):
        return -1
    h = rom[off:off + 0x40]
    s = 0
    if word(h, 0x1C) ^ word(h, 0x1E) == 0xFFFF:
        s += 4
    if h[0x15] & 0x0F == low and h[0x15] & 0xE0 == 0x20:
        s += 3
    if word(h, 0x3C) >= 0x8000:
        s += 2
    if all(0x20 <= c < 0x7F for c in h[:21]):
        s += 2
    if (1 << h[0x17]) * 1024 >= len(rom) // 2 and h[0x17] <= 0x0D:
        s += 1
    return s


def find_header(rom):
    best = max(((score_header(rom, off, low), off, kind)
                for off, kind, low in HEADER_CANDIDATES), key=lambda t: t[0])
    return (best[1], best[2]) if best[0] > 0 else (None, None)


def snes_addr(off, kind):
    """Offset v ROM → adresa CPU `$BB:AAAA` (kanonické zrcadlo)."""
    if kind == 'LoROM':
        return '$%02X:%04X' % (off >> 15, (off & 0x7FFF) | 0x8000)
    if kind == 'ExHiROM' and off >= 0x400000:
        return '$%02X:%04X' % (0x40 + ((off - 0x400000) >> 16), off & 0xFFFF)
    return '$%02X:%04X' % (0xC0 + (off >> 16), off & 0xFFFF)


def parse_header(rom):
    off, kind = find_header(rom)
    if off is None:
        return None
    h = rom[off:off + 0x40]
    mode, ctype = h[0x15], h[0x16]
    layout = CART_LAYOUT.get(ctype & 0x0F, '? $%02X' % ctype)
    if 0x3 <= ctype & 0x0F <= 0x6:
        layout += ' (%s)' % COPROCESSOR.get(ctype >> 4, '?')
    region, video = DESTINATION.get(h[0x19], ('? $%02X' % h[0x19], '?'))
    return {
        'offset': off, 'kind': kind,
        'title': h[:21].decode('ascii', 'replace').rstrip(),
        'map_mode': mode, 'fastrom': bool(mode & 0x10),
        'cart_type': ctype, 'layout': layout,
        'rom_kb': (1 << h[0x17]) if h[0x17] else 0,
        'sram_kb': (1 << h[0x18]) if h[0x18] else 0,
        'destination': h[0x19], 'region': region, 'video': video,
        'licensee': h[0x1A], 'version': h[0x1B],
        'complement': word(h, 0x1C), 'checksum': word(h, 0x1E),
        'vectors': [(name, word(h, o)) for o, name in VECTORS],
    }


def hashes(rom):
    return {'size': len(rom), 'crc32': '%08X' % (zlib.crc32(rom) & 0xFFFFFFFF),
            'md5': hashlib.md5(rom).hexdigest().upper(),
            'sha1': hashlib.sha1(rom).hexdigest().upper(),
            'sha256': hashlib.sha256(rom).hexdigest()}


def nointro(hs):
    for name, region, size, crc, md5, sha1 in NOINTRO:
        if (size, crc, md5, sha1) == (hs['size'], hs['crc32'], hs['md5'], hs['sha1']):
            return name, region
    return None, None


def runs_of(a, b):
    """Souvislé úseky offsetů, kde se a a b liší."""
    out, start = [], None
    for i in range(len(a)):
        if a[i] != b[i]:
            if start is None:
                start = i
        elif start is not None:
            out.append((start, i - 1)); start = None
    if start is not None:
        out.append((start, len(a) - 1))
    return out


def explained(na, nb, s, e):
    for xa, xb, lo, hi, why in EXPLAINED:
        if {xa, xb} == {na, nb} and lo <= s and e <= hi:
            return why
    return None


def load(path):
    raw = open(path, 'rb').read()
    rom, copier = strip_copier(raw)
    hs = hashes(rom)
    name, region = nointro(hs)
    return {'path': path, 'rom': rom, 'copier': copier is not None, 'hashes': hs,
            'nointro': name, 'nointro_region': region, 'header': parse_header(rom),
            'computed': checksum(rom)}


def report_file(c):
    hs, hd = c['hashes'], c['header']
    fails = []
    print('%s' % c['path'])
    print('  velikost %d B%s' % (hs['size'], ', odříznuta kopírovací hlavička 512 B'
                                 if c['copier'] else ''))
    print('  CRC32 %s  SHA-1 %s' % (hs['crc32'], hs['sha1']))
    print('  SHA-256 %s' % hs['sha256'])
    if c['nointro']:
        print('  No-Intro: %s — shoda' % c['nointro'])
    else:
        print('  No-Intro: *** NESHODA *** (žádná položka v NOINTRO)')
        fails.append('hash')
    if hd is None:
        print('  hlavička: *** NENALEZENA ***')
        return fails + ['hlavička']
    print('  hlavička %s na $%06X: „%s"' % (hd['kind'], hd['offset'], hd['title']))
    print('    mapování $%02X (%s, %s), deska $%02X (%s)' % (
        hd['map_mode'], hd['kind'], 'FastROM 3,58 MHz' if hd['fastrom'] else 'SlowROM 2,68 MHz',
        hd['cart_type'], hd['layout']))
    print('    ROM %d KB, SRAM %d KB, region $%02X (%s, %s), licence $%02X, verze %d' % (
        hd['rom_kb'], hd['sram_kb'], hd['destination'], hd['region'], hd['video'],
        hd['licensee'], hd['version']))
    ok_sum = hd['checksum'] == c['computed']
    ok_cpl = hd['checksum'] ^ hd['complement'] == 0xFFFF
    print('    součet v hlavičce $%04X, spočítaný $%04X — %s; doplněk $%04X — %s' % (
        hd['checksum'], c['computed'], 'sedí' if ok_sum else '*** NESEDÍ ***',
        hd['complement'], 'sedí' if ok_cpl else '*** NESEDÍ ***'))
    if not ok_sum or not ok_cpl:
        fails.append('součet')
    if hd['rom_kb'] * 1024 != hs['size']:
        print('    pozor: hlavička uvádí %d KB, soubor má %d KB' % (hd['rom_kb'], hs['size'] // 1024))
    if c['nointro_region'] and c['nointro_region'] != hd['region']:
        print('    pozor: No-Intro říká %s, hlavička %s' % (c['nointro_region'], hd['region']))
    print('    vektory: ' + ', '.join('%s $%04X' % v for v in hd['vectors']))
    return fails


def markdown(carts):
    print('| soubor | velikost | CRC32 | SHA-1 | SHA-256 | No-Intro |')
    print('|---|---|---|---|---|---|')
    for c in carts:
        hs = c['hashes']
        print('| `%s` | %d | `%s` | `%s` | `%s` | %s |' % (
            os.path.basename(c['path']), hs['size'], hs['crc32'], hs['sha1'], hs['sha256'],
            c['nointro'] or '**neshoda**'))
    print()
    print('| soubor | mapování | rychlost | deska | ROM / SRAM | region | verze | součet | RESET | NMI | IRQ |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for c in carts:
        hd = c['header']
        if hd is None:
            continue
        v = dict(hd['vectors'])
        print('| `%s` | %s $%02X | %s | %s | %d / %d KB | %s (%s) | %d | `$%04X` %s | `$%04X` | `$%04X` | `$%04X` |' % (
            os.path.basename(c['path']), hd['kind'], hd['map_mode'],
            'FastROM' if hd['fastrom'] else 'SlowROM', hd['layout'], hd['rom_kb'], hd['sram_kb'],
            hd['region'], hd['video'], hd['version'], hd['checksum'],
            '✓' if hd['checksum'] == c['computed'] else '✗',
            v['RESET (E)'], v['NMI'], v['IRQ']))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('files', nargs='*', help='dumpy (výchozí sources/cart/*.sfc|smc|bin)')
    ap.add_argument('--verbose', action='store_true', help='vypsat všechny neshodné úseky')
    ap.add_argument('--markdown', action='store_true', help='tabulky pro sources/cart/README.md')
    a = ap.parse_args()

    files = a.files or sorted(f for ext in ('sfc', 'smc', 'bin')
                              for f in glob.glob('sources/cart/*.' + ext))
    if not files:
        sys.exit('žádné dumpy — patří do sources/cart/ (sources/README.md blok 1)')
    carts = [load(f) for f in files]

    if a.markdown:
        markdown(carts)
        return 0

    fails = 0
    for c in carts:
        f = report_file(c)
        fails += len(f)
        print()

    # dva dumpy téhož obsahu: shoda bajt po bajtu
    # (sdružuje se podle regionu z hlavičky, takže neověřený dump se srovná
    # s ověřeným a je vidět, kde se liší; ověřený jde ve skupině první)
    groups = {}
    for c in sorted(carts, key=lambda c: c['nointro'] is None):
        groups.setdefault(c['header']['region'] if c['header'] else '?', []).append(c)
    print('shoda dumpů téhož regionu:')
    for key, cs in groups.items():
        if len(cs) < 2:
            print('  %-28s 1 dump — druhý nezávislý chybí' % key)
            continue
        for other in cs[1:]:
            same = other['rom'] == cs[0]['rom']
            print('  %-28s %s = %s — %s' % (key, os.path.basename(cs[0]['path']),
                  os.path.basename(other['path']), 'bajt po bajtu' if same else '*** LIŠÍ SE ***'))
            if not same and len(other['rom']) == len(cs[0]['rom']):
                for s, e in runs_of(cs[0]['rom'], other['rom'])[:20]:
                    print('    $%06X-$%06X (%5d B)' % (s, e, e - s + 1))
            fails += 0 if same else 1

    # rozdíly regionů: jeden zástupce za No-Intro položku
    reps = [cs[0] for cs in groups.values() if cs[0]['nointro']]
    total = unexplained = 0
    print('\nrozdíly regionů:')
    if len(reps) < 2:
        print('  méně než dva ověřené regiony — není co srovnat')
    for i in range(len(reps)):
        for j in range(i + 1, len(reps)):
            ca, cb = reps[i], reps[j]
            na, nb = ca['nointro'], cb['nointro']
            if len(ca['rom']) != len(cb['rom']):
                print('  %s × %s: jiná velikost, srovnává se jen společná část' % (na, nb))
            n = min(len(ca['rom']), len(cb['rom']))
            runs = runs_of(ca['rom'][:n], cb['rom'][:n])
            nbytes = sum(e - s + 1 for s, e in runs)
            bad = [(s, e) for s, e in runs if not explained(na, nb, s, e)]
            total += nbytes
            unexplained += sum(e - s + 1 for s, e in bad)
            print('  %s × %s: %d B v %d úsecích, nevysvětlených %d úseků' % (
                na, nb, nbytes, len(runs), len(bad)))
            kind = ca['header']['kind']
            shown = runs if a.verbose else bad[:20]
            for s, e in shown:
                why = explained(na, nb, s, e)
                print('    $%06X-$%06X %s (%5d B)  %s' % (
                    s, e, snes_addr(s, kind), e - s + 1,
                    ('vysvětleno: ' + why) if why else '*** NEVYSVĚTLENO ***'))
            if not a.verbose and len(bad) > 20:
                print('    … a %d dalších (--verbose)' % (len(bad) - 20))

    print('\ndumpů: %d   selhání (hash / součet / shoda): %d   rozdílů regionů: %d B   '
          '**nevysvětlených: %d B**' % (len(carts), fails, total, unexplained))
    if fails:
        return 1
    return 2 if unexplained else 0


if __name__ == '__main__':
    sys.exit(main())
