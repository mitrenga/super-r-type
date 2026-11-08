#!/usr/bin/env python3
"""tracelag — zpožděné snímky: kde a kolik jich originál má (M0, disasm_notes §2).

★ Mechanismus z kódu (`sources/asm/main.asm`): hlavní smyčka (`$00:81B9`)
čeká, až NMI nastaví bit 7 v `$4C`, projde seznam úloh a na konci
(`$00:827D`) bit 7 smaže. NMI (`$00:8286`) po `INC $4E` bit 7 zkontroluje:
je-li pořád nastavený, smyčka předchozí snímek nedodělala a NMI **přeskočí
všechno** (`$00:82C5` → `$00:84D7`) — žádný scroll, OAM, paleta, VRAM ani
čtení ovladače. **Zpožděný snímek = NMI prošlo `$00:82C5`**; řádný snímek
= `$00:82C8`.

Nástroj spustí scénáře z `runcoverage.py` s počítadly na obou adresách
a na začátku smyčky úloh (`$00:81C0`) a vypíše po scénáři počet a podíl
zpožděných snímků, délky jejich sérií a kde ve hře byly.

    ./tools/tracelag.py                     # play1–3 + stage0–6
    ./tools/tracelag.py --only play1 --list # i seznam zpožděných snímků
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from snesemu import SnesEmu, PROJECT
from runcoverage import scenarios, STAGE, CHEAT_ROM

LAG, OK, PASS = 0x0082C5, 0x0082C8, 0x0081C0


def run(sc):
    name, desc, frames, presses, cheats, stage = sc
    e = SnesEmu()
    for p in presses:
        e.press(*p)
    if stage is not None:
        e.poke(STAGE, stage, 900, 2700)
    for addr, val in cheats:
        e.poke(addr, val, 900)
    if cheats:
        for addr, val in CHEAT_ROM:
            e.patch_rom(addr, val)
    e.count_pc(LAG, OK, PASS)
    r = e.run(frames=frames, workdir=os.path.join(PROJECT, 'build', 'lag'))
    return r.frames


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', default='play1,play2,play3,stage0,stage1,stage2,stage3,stage4,stage5,stage6')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    want = a.only.split(',')
    out = []
    p = lambda *x: (print(*x), out.append(' '.join(str(y) for y in x)))
    p('scénář     snímků  NMI  řádných  zpožděných   podíl  série (délka × počet)                  nejdelší')
    for sc in scenarios():
        if sc[0] not in want:
            continue
        fr = run(sc)
        play = [f for f in fr if f['frame'] >= 900]          # od titulky dál
        lag = [f['frame'] for f in play if f['pc'][0]]
        ok = sum(1 for f in play if f['pc'][1])
        nmi = sum(f['nmi'] for f in play)
        runs, cur, prev = {}, 0, None
        for f in lag:
            cur = cur + 1 if prev is not None and f == prev + 1 else 1
            if prev is not None and f != prev + 1:
                runs[last] = runs.get(last, 0) + 1
            prev, last = f, cur
        if lag:
            runs[last] = runs.get(last, 0) + 1
        both = sum(1 for f in play if f['pc'][0] and f['pc'][1])
        p('%-8s %8d %5d %8d %10d %6.1f %%  %-38s %d%s' % (
            sc[0], len(play), nmi, ok, len(lag), 100 * len(lag) / max(1, len(play)),
            ', '.join('%d×%d' % kv for kv in sorted(runs.items()))[:38], max(runs) if runs else 0,
            ('  (obojí v jednom snímku %d×)' % both) if both else ''))
        if a.list and lag:
            p('   ' + ' '.join(map(str, lag[:200])) + (' …' if len(lag) > 200 else ''))
    path = os.path.join(PROJECT, 'build', 'lag', 'tracelag.txt')
    open(path, 'w').write('\n'.join(out) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
