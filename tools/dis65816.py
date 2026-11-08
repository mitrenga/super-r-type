#!/usr/bin/env python3
"""dis65816 — disassembly 65C816 se šířkami M/X z běhu (Super R-Type, LoROM).

Krok M0 (`MILNIKY.md`). 65C816 se nedá rozložit lineárně: délka operandu
`#imm` u instrukcí s akumulátorem a indexy závisí na příznacích M a X
(`op65816.py`). Šířky proto bere z **CDL MesenCE** (`runcoverage.py`):
u každého provedeného bajtu ROM příznak Code a k němu `MemoryMode8` /
`IndexMode8`, se kterými se instrukce provedla. Tři druhy řádků:

- **z běhu** — instrukce, kterou běh provedl, šířky z CDL (autorita ★);
- **staticky** — cíl skoku nebo větve z pokrytého kódu, který běh
  nenavštívil, rozložený se šířkami odvozenými od zdroje skoku a od
  `REP`/`SEP` po cestě; řádek nese `?` a šířka je hypotéza. Po `PLP`,
  `RTI` a nepřímém skoku se statika zastaví — šířka „?";
- **data a nepokryté** — rozsahy bez kódu; data (příznak Data = ROM se
  četla jako data) a nepokryté se v `main.asm` jen ohraničí, bajty jsou
  v ROM a vytahují je nástroje `dump*`.

Kontroly (`coverage.txt`): **konflikt šířek** = instrukce provedená
v různých scénářích s jinou šířkou (v jednom scénáři CDL šířky ORuje,
proto je navíc `--verify`: trace vybraných snímků proti CDL); **nevyřešeno
v pokrytém** = instrukce, která by přesahovala do bajtů bez příznaku Code,
nebo cíl skoku uprostřed rozložené instrukce.

    ./tools/dis65816.py                 # → sources/asm/
    ./tools/dis65816.py --verify        # + trace vybraných snímků proti CDL

Vstupy: ROM, `build/coverage/*.cdl` a `*.access.json`, `sources/asm/hints.json`
(vstupní body, jména RAM a rutin, datové bloky).
"""
import argparse, glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op65816 import OPS, SIZE
from snesemu import ROM, PROJECT
from scanhw import reg_of, reg_name

COV = os.path.join(PROJECT, 'build', 'coverage')
ASM = os.path.join(PROJECT, 'sources', 'asm')
CODE, DATA, JT, SUB, X8, M8 = 0x01, 0x02, 0x04, 0x08, 0x10, 0x20
STOP = {'RTS', 'RTL', 'RTI', 'JMP', 'JML', 'BRA', 'BRL', 'STP', 'WAI_never'}
BRANCH = {'BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ', 'BRA', 'BRL'}


def cpu(off):
    return ((off >> 15) << 16) | 0x8000 | (off & 0x7FFF)


def off_of(addr):
    bank, a = (addr >> 16) & 0x7F, addr & 0xFFFF
    if a < 0x8000 or bank > 0x7D:
        return None
    return (bank << 15) | (a & 0x7FFF)


def fmt_addr(a):
    return '$%02X:%04X' % (a >> 16, a & 0xFFFF)


def parse_addr(s):
    s = s.replace('$', '')
    if ':' in s:
        b, a = s.split(':')
        return int(b, 16) << 16 | int(a, 16)
    return int(s, 16)


class Rom:
    def __init__(self, rom, cdls, hints):
        self.rom = rom
        self.n = len(rom)
        self.flags = bytearray(self.n)
        self.widths = {}                 # offset -> set of (m8, x8) across scenarios
        for name, c in cdls.items():
            for i, f in enumerate(c):
                if f:
                    self.flags[i] |= f & 0x0F
                    if f & CODE:
                        self.widths.setdefault(i, set()).add((bool(f & M8), bool(f & X8)))
        self.hints = hints
        self.ins = {}                    # offset -> instruction dict
        self.owner = {}                  # offset of any byte -> offset of instruction start
        self.unresolved = []
        self.static_starts = []

    def decode(self, o, m8, x8):
        op = self.rom[o]
        mn, mode = OPS[op]
        n = SIZE[mode]
        if n is None:
            n = 1 if (m8 if mode == 'immM' else x8) else 2
        return mn, mode, n

    def operand(self, o, mn, mode, n, m8, x8):
        b = self.rom[o + 1:o + 1 + n]
        v = int.from_bytes(b, 'little') if n else None
        pc = cpu(o)
        target = None
        if mode == 'rel':
            target = (pc & 0xFF0000) | ((pc + 2 + (v - 256 if v >= 128 else v)) & 0xFFFF)
            text = fmt_addr(target)
        elif mode == 'rell':
            target = (pc & 0xFF0000) | ((pc + 3 + (v - 65536 if v >= 32768 else v)) & 0xFFFF)
            text = fmt_addr(target)
        elif mode in ('imm', 'immM', 'immX'):
            text = '#$%0*X' % (2 * n, v)
        elif mode == 'move':
            text = '$%02X,$%02X' % (b[1], b[0])
        elif mode in ('imp', 'acc'):
            text = 'A' if mode == 'acc' else ''
        elif mode == 'sig':
            text = '#$%02X' % v
        else:
            if mode.startswith('long'):
                inner = '$%06X' % v
            elif 'dp' in mode or mode.startswith('sr') or mode.startswith('(sr'):
                inner = '$%02X' % v
            else:
                inner = '$%04X' % v
            text = mode.replace('long', inner).replace('abs', inner).replace('dp', inner).replace('sr', inner)
            if mn in ('JMP', 'JSR') and mode == 'abs':
                target = (pc & 0xFF0000) | v
            if mn in ('JML', 'JSL') and mode == 'long':
                target = v
        return text, target, v

    # -- covered code ---------------------------------------------------------

    def walk_covered(self):
        i = 0
        while i < self.n:
            if not (self.flags[i] & CODE) or i in self.owner:
                i += 1
                continue
            ws = self.widths.get(i, {(False, False)})
            m8, x8 = sorted(ws)[0] if len(ws) == 1 else (min(w[0] for w in ws), min(w[1] for w in ws))
            mn, mode, n = self.decode(i, m8, x8)
            if any(not (self.flags[j] & CODE) for j in range(i, min(i + 1 + n, self.n))):
                self.unresolved.append((i, 'instrukce přesahuje do bajtů bez Code'))
            self.add(i, mn, mode, n, m8, x8, 'run', conflict=len(ws) > 1)
            i += 1 + n

    def add(self, o, mn, mode, n, m8, x8, kind, conflict=False):
        text, target, v = self.operand(o, mn, mode, n, m8, x8)
        self.ins[o] = {'mn': mn, 'mode': mode, 'n': n, 'm8': m8, 'x8': x8, 'kind': kind,
                       'text': text, 'target': target, 'v': v, 'conflict': conflict}
        for j in range(o, o + 1 + n):
            self.owner.setdefault(j, o)

    # -- static extension -------------------------------------------------------

    def walk_static(self):
        todo = []
        for o, ins in list(self.ins.items()):
            t = ins['target']
            if t is None:
                continue
            to = off_of(t)
            if to is None or to in self.owner:
                if to is not None and to in self.owner and self.owner[to] != to:
                    self.unresolved.append((o, 'cíl %s uprostřed instrukce' % fmt_addr(t)))
                continue
            m8, x8 = ins['m8'], ins['x8']
            todo.append((to, m8, x8))
        for e in self.hints.get('entry', []):
            to = off_of(parse_addr(e['addr']))
            if to is not None and to not in self.owner:
                todo.append((to, e.get('m', 8) == 8, e.get('x', 8) == 8))
        seen = set()
        while todo:
            o, m8, x8 = todo.pop()
            first = True
            while 0 <= o < self.n and o not in self.owner and (o, m8, x8) not in seen:
                if self.flags[o] & DATA:
                    break
                seen.add((o, m8, x8))
                mn, mode, n = self.decode(o, m8, x8)
                if o + n >= self.n or any(j in self.owner for j in range(o, o + 1 + n)):
                    break
                if first:
                    self.static_starts.append(o)
                    first = False
                self.add(o, mn, mode, n, m8, x8, 'static')
                ins = self.ins[o]
                if mn == 'REP':
                    m8 = m8 and not (ins['v'] & 0x20)
                    x8 = x8 and not (ins['v'] & 0x10)
                elif mn == 'SEP':
                    m8 = m8 or bool(ins['v'] & 0x20)
                    x8 = x8 or bool(ins['v'] & 0x10)
                if ins['target'] is not None:
                    to = off_of(ins['target'])
                    if to is not None and to not in self.owner:
                        todo.append((to, m8, x8))
                if mn in STOP or mn in ('PLP', 'XCE') or mode in ('(abs)', '(abs,X)', '[abs]'):
                    break
                o += 1 + n

    # -- output -------------------------------------------------------------------

    def label(self, addr):
        lab = self.hints.get('labels', {})
        k = '%06X' % addr
        return lab.get(k)

    def comment(self, ins, o):
        c = []
        mode, v = ins['mode'], ins['v']
        if mode in ('abs', 'abs,X', 'abs,Y', 'long', 'long,X') and v is not None:
            a = v & 0xFFFF
            if not mode.startswith('long') or ((v >> 16) & 0x7F) < 0x40:
                r = reg_of(a)
                if r is not None:
                    c.append(reg_name(r))
            if mode.startswith('long') and (v >> 16) in (0x7E, 0x7F):
                n = self.label(v)
                if n:
                    c.append(n)
            elif a < 0x2000:
                n = self.label(0x7E0000 | a)
                if n:
                    c.append(n)
        if mode.startswith('dp') or mode.startswith('(dp') or mode.startswith('[dp'):
            n = self.label(0x7E0000 | v)
            if n:
                c.append('%s (D=0)' % n)
        if ins['target'] is not None:
            n = self.label(ins['target'])
            if n:
                c.append(n)
        if ins['conflict']:
            c.append('KONFLIKT šířek mezi scénáři: %s' % sorted(self.widths[o]))
        return c

    def write(self, path):
        jt_names = {}
        for o in range(self.n):
            if self.flags[o] & (JT | SUB) and o in self.ins:
                jt_names[o] = ('S_' if self.flags[o] & SUB else 'L_') + '%06X' % cpu(o)
        for o, ins in self.ins.items():
            t = ins['target']
            if t is not None:
                to = off_of(t)
                if to in self.ins and to not in jt_names:
                    jt_names[to] = ('S_' if ins['mn'] in ('JSR', 'JSL') else 'L_') + '%06X' % t
        out = []
        out.append('; Super R-Type (USA) — disassembly 65C816 (tools/dis65816.py). LoROM, banky $00-$1F.')
        out.append(';   sloupce: adresa  bajty  šířka (M/X: 8/16, ? = odvozeno staticky)  instrukce  ; komentář')
        out.append(';   řádky bez `?` provedl běh (CDL MesenCE, build/coverage), s `?` jsou statické')
        out.append('')
        o, bank = 0, -1
        prev_w = None
        while o < self.n:
            if (o >> 15) != bank:
                bank = o >> 15
                out.append('')
                out.append('; ' + '=' * 70)
                out.append('; banka $%02X  (ROM $%06X-$%06X)' % (bank, bank << 15, (bank << 15) | 0x7FFF))
                out.append('; ' + '=' * 70)
                prev_w = None
            if o in self.ins:
                ins = self.ins[o]
                name = self.label(cpu(o)) or jt_names.get(o)
                if name:
                    out.append('')
                    out.append('%s:' % name)
                w = '%s%s%s' % ('8' if ins['m8'] else '16', '/' + ('8' if ins['x8'] else '16'),
                                '?' if ins['kind'] == 'static' else '')
                b = ' '.join('%02x' % x for x in self.rom[o:o + 1 + ins['n']])
                text = ins['text']
                t = ins['target']
                if t is not None and off_of(t) in jt_names and ins['mode'] in ('rel', 'rell', 'abs', 'long'):
                    text = jt_names[off_of(t)]
                if t is not None and self.label(t):
                    text = self.label(t)
                cm = self.comment(ins, o)
                out.append('  %s  %-12s %-6s %s %s%s' % (
                    fmt_addr(cpu(o)), b, w, ins['mn'], text,
                    ('  ; ' + '; '.join(cm)) if cm else ''))
                o += 1 + ins['n']
                continue
            # run of non-code bytes
            start, kind = o, ('data' if self.flags[o] & DATA else 'nepokryto')
            while o < self.n and o not in self.ins and (o >> 15) == bank and \
                    (('data' if self.flags[o] & DATA else 'nepokryto') == kind):
                o += 1
            name = self.label(cpu(start))
            out.append('  ; %s %s-%s  (%d B)%s' % (kind, fmt_addr(cpu(start)), fmt_addr(cpu(o - 1)), o - start,
                                                  ('  ' + name) if name else ''))
        open(path, 'w').write('\n'.join(out) + '\n')

    def stats(self):
        per = []
        for bank in range(self.n >> 15):
            lo, hi = bank << 15, (bank + 1) << 15
            run = sum(1 + self.ins[o]['n'] for o in self.ins if lo <= o < hi and self.ins[o]['kind'] == 'run')
            st = sum(1 + self.ins[o]['n'] for o in self.ins if lo <= o < hi and self.ins[o]['kind'] == 'static')
            data = sum(1 for o in range(lo, hi) if (self.flags[o] & DATA) and o not in self.owner)
            per.append((bank, run, st, data, 0x8000 - run - st - data))
        return per


def ram_use(hints):
    """RAMUse.md: použité bajty WRAM ze všech scénářů (čtení, nebo víc než jeden zápis
    — jeden zápis je nulování při resetu), sloučené do rozsahů, se jmény z hints."""
    reads, writes = {}, {}
    files = sorted(glob.glob(os.path.join(COV, '*.access.json')))
    nscen = len(files)
    for p in files:
        acc = json.load(open(p))
        for k, d in (('wramR', reads), ('wramW', writes)):
            for a, n in acc.get(k, {}).items():
                d[int(a)] = d.get(int(a), 0) + n
    used = sorted(a for a in set(reads) | set(writes) if reads.get(a, 0) or writes.get(a, 0) > nscen)
    ranges, start, prev = [], None, None
    for a in used:
        if start is None or a > prev + 4:
            if start is not None:
                ranges.append((start, prev))
            start = a
        prev = a
    if start is not None:
        ranges.append((start, prev))
    labels = {int(k, 16): v for k, v in hints.get('labels', {}).items() if k.startswith('7E') or k.startswith('7F')}
    out = ['# RAMUse — použití WRAM (tools/dis65816.py)', '',
           'Z počítadel přístupů MesenCE ve všech scénářích `build/coverage` (%d scénářů). Použitý bajt = '
           'čtený, nebo zapsaný víckrát než v %d scénářích po jednom (nulování `$7E:0000`–`$FFFF` při '
           'resetu); rozsahy sloučené přes mezery do 4 B. Jména z `hints.json` (★ / ?), rozbor v '
           '`../docs/disasm_notes.md`.' % (nscen, nscen), '',
           '★ **Horních 64 KB (`$7F:0000`–`$FFFF`) hra nepoužívá** — %s.' % (
               'žádný použitý bajt' if not any(a >= 0x10000 for a in used) else
               '%d použitých bajtů' % sum(1 for a in used if a >= 0x10000)), '',
           '| rozsah | B | čtení | zápisy | jména |', '|---|---|---|---|---|']
    for a, b in ranges:
        names = ', '.join('`$%04X` %s' % (x & 0xFFFF, n) for x, n in sorted(labels.items())
                          if a <= (x - 0x7E0000) <= b)
        out.append('| `$7E:%04X`–`$%04X` | %d | %d | %d | %s |' % (
            a, b, b - a + 1, sum(reads.get(x, 0) for x in range(a, b + 1)),
            sum(writes.get(x, 0) for x in range(a, b + 1)), names))
    out.append('')
    out.append('celkem použitých bajtů %d v %d rozsazích' % (len(used), len(ranges)))
    open(os.path.join(ASM, 'RAMUse.md'), 'w').write('\n'.join(out) + '\n')


def samples_txt(cdls):
    path = os.path.join(COV, 'samples.json')
    sm = json.load(open(path)) if os.path.exists(path) else {}
    from runcoverage import scenarios
    for name, desc, frames, presses, cheats, stage in scenarios():
        sm.setdefault(name, {'desc': desc, 'frames': frames, 'cheats': bool(cheats)})
    out = ['# coverage_samples — scénáře pokrytí (tools/runcoverage.py)', '',
           'scénář    snímků  cheat  kód B  data B  jen tady kód B  popis']
    code = {n: {i for i, b in enumerate(c) if b & CODE} for n, c in cdls.items()}
    for n in cdls:
        others = set().union(*(v for k, v in code.items() if k != n))
        info = sm.get(n, {})
        out.append('%-8s %7s  %5s %6d %7d %15d  %s' % (
            n, info.get('frames', '?'), 'ano' if info.get('cheats') else 'ne', len(code[n]),
            sum(1 for b in cdls[n] if b & DATA), len(code[n] - others), info.get('desc', '')))
    open(os.path.join(ASM, 'coverage_samples.txt'), 'w').write('\n'.join(out) + '\n')


def verify(r, scenarios):
    """Trace vybraných snímků proti CDL: provedená instrukce a její šířky."""
    from snesemu import SnesEmu
    from runcoverage import scenarios as all_sc
    sc = {s[0]: s for s in all_sc()}
    total = bad = missing = 0
    rows, poly, length = [], set(), set()
    for name, frames in scenarios:
        s = sc[name]
        e = SnesEmu()
        for p in s[3]:
            e.press(*p)
        if s[5] is not None:
            e.poke(0x7E16E5, s[5], 900, 2700)
        for addr, val in s[4]:
            e.poke(addr, val, 900)
        if s[4]:
            e.patch_rom(0x01A957, 0x80)
        path = os.path.join(COV, 'verify_%s.txt' % name)
        e.trace(frames[0], frames[1], path)
        e.run(frames=frames[1], workdir=COV)
        n = b = mi = 0
        for line in open(path):
            if line.startswith('#'):
                continue
            p = line.split()
            bank, a = p[3].split(':')
            o = off_of(int(bank, 16) << 16 | int(a, 16))
            if o is None:
                continue
            P = int(p[8], 16)
            n += 1
            ins = r.ins.get(o)
            if ins is None or ins['kind'] != 'run':
                mi += 1
                continue
            if ins['m8'] != bool(P & 0x20) or ins['x8'] != bool(P & 0x10):
                b += 1
                poly.add(o)
                if (ins['mode'] == 'immM' and ins['m8'] != bool(P & 0x20)) or \
                        (ins['mode'] == 'immX' and ins['x8'] != bool(P & 0x10)):
                    length.add(o)
        rows.append((name, frames, n, b, mi))
        total += n
        bad += b
        missing += mi
    return rows, total, bad, missing, poly, length


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--verify', action='store_true')
    a = ap.parse_args()
    rom = open(ROM, 'rb').read()
    cdls = {os.path.basename(p)[:-4]: open(p, 'rb').read() for p in sorted(glob.glob(os.path.join(COV, '*.cdl')))}
    if not cdls:
        sys.exit('chybí build/coverage/*.cdl — nejdřív tools/runcoverage.py')
    hints_path = os.path.join(ASM, 'hints.json')
    hints = json.load(open(hints_path)) if os.path.exists(hints_path) else {}
    r = Rom(rom, cdls, hints)
    r.walk_covered()
    r.walk_static()
    os.makedirs(ASM, exist_ok=True)
    r.write(os.path.join(ASM, 'main.asm'))

    per = r.stats()
    run = sum(p[1] for p in per)
    st = sum(p[2] for p in per)
    data = sum(p[3] for p in per)
    conflicts = sum(1 for i in r.ins.values() if i['conflict'])
    run_ins = sum(1 for i in r.ins.values() if i['kind'] == 'run')
    cov = []
    cov.append('# coverage — pokrytí disassembly (tools/dis65816.py)')
    cov.append('')
    cov.append('scénáře: %s (build/coverage, viz coverage_samples.txt)' % ', '.join(cdls))
    cov.append('')
    cov.append('banka   z běhu  staticky     data  nepokryto')
    for bank, ru, s_, d, u in per:
        cov.append('  $%02X  %7d  %7d  %7d  %7d' % (bank, ru, s_, d, u))
    cov.append('')
    N = len(rom)
    cov.append('celkem %d B: kód z běhu %d B (%.1f %%), kód staticky %d B (%.1f %%), data %d B (%.1f %%), '
               'nepokryto %d B (%.1f %%)' % (N, run, 100 * run / N, st, 100 * st / N, data, 100 * data / N,
                                              N - run - st - data, 100 * (N - run - st - data) / N))
    cov.append('instrukcí z běhu %d (šířka z CDL 100 %%), statických %d (šířka odvozená)' % (
        run_ins, len(r.ins) - run_ins))
    cov.append('konflikty šířek mezi scénáři: %d' % conflicts)
    cov.append('nevyřešeno v pokrytém: %d' % len([u for u in r.unresolved]))
    for o, why in r.unresolved[:40]:
        cov.append('  %s  %s' % (fmt_addr(cpu(o)), why))
    if a.verify:
        rows, total, bad, missing, poly, length = verify(r, [('attract', (400, 403)), ('play1', (3000, 3003)),
                                               ('stage5', (5000, 5003)), ('stage6', (4400, 4403))])
        cov.append('')
        cov.append('kontrola trace proti CDL (šířka každé provedené instrukce):')
        for name, fr, n, b, mi in rows:
            cov.append('  %-8s snímky %d–%d: %6d instrukcí, šířka jinak %d, mimo pokrytí %d' % (
                name, fr[0], fr[1] - 1, n, b, mi))
        cov.append('  celkem %d instrukcí, šířka jinak %d provedení na %d adresách, mimo pokrytí %d' % (
            total, bad, len(poly), missing))
        cov.append('  adresy provedené s oběma šířkami (CDL je v rámci scénáře sloučí): %s' % ', '.join(
            '%s %s' % (fmt_addr(cpu(o)), r.ins[o]['mn']) for o in sorted(poly)))
        cov.append('  **z toho mění délku instrukce (#imm podle M/X): %d** — rozklad tím není dotčen' % len(length)
                   if not length else '  **MĚNÍ DÉLKU: %s**' % ', '.join(fmt_addr(cpu(o)) for o in sorted(length)))
    open(os.path.join(ASM, 'coverage.txt'), 'w').write('\n'.join(cov) + '\n')
    ram_use(hints)
    samples_txt(cdls)
    print('\n'.join(cov[-12:]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
