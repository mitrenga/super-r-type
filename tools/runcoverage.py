#!/usr/bin/env python3
"""runcoverage — pokrytí kódu z běhu: CDL MesenCE a počítadla přístupů po scénářích.

Podklad pro `dis65816.py` (M0). ★ MesenCE vede u každého bajtu ROM příznaky
**Code `$01`, Data `$02`, JumpTarget `$04`, SubEntryPoint `$08`** a u kódu
šířky, se kterými se instrukce provedla: **`IndexMode8` `$10`** (X = 1)
a **`MemoryMode8` `$20`** (M = 1) — to jsou šířky z běhu, které lineární
disassembly 65C816 nemá. K tomu počítadla čtení / zápisů WRAM a provedení /
čtení ROM (`RAMUse.md`, horká místa).

Scénáře (`SCENARIOS`) jsou deterministické: vstup je ze semínka
(`random_inputs`), cheaty jen tam, kde je napsáno (průzkum, ne `trace*`).
Každý scénář se ukládá zvlášť, takže se dá poznat instrukce provedená
v různých scénářích s různou šířkou (`dis65816.py` ji hlásí jako konflikt).

    ./tools/runcoverage.py                  # všechny scénáře → build/coverage/
    ./tools/runcoverage.py --only attract   # jeden

Výstup: `build/coverage/<scénář>.cdl` (1 MB, příznaky po bajtech ROM),
`<scénář>.access.json`, `samples.json` (co který scénář dělal).
"""
import argparse, json, os, random, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from snesemu import SnesEmu, PROJECT
from scanhw import START_TAPS

OUT = os.path.join(PROJECT, 'build', 'coverage')
STAGE = 0x7E16E5
CHEATS = [(0x7E16E1, 9), (0x7E158F, 0)]
CHEAT_ROM = [(0x01A957, 0x80)]
PLAY = ['up', 'down', 'left', 'right', 'b', 'y', 'a', 'x', 'l', 'r']

# ★ The original's own instant power-up (tables $04:9073 and $04:908D, read by
# the pause task $01:952D / $01:955D / $01:95B7): in the game, pause with START,
# press R, Right, Down, Y, Down, Right, Down, Left, Right, Down, Right, Right
# (every press alone, matched against joypad_pressed), then the laser (A, X,
# B, Y, R = kinds 0-4) and the missile (A, X), then START again. It sets
# $1743 = 3 (the Force, stage 3), $1745 = the laser, $17CD = 2, $16E3 = 1
# (speed), $1689 = 1 or 2 bits — the only way without enemies to run the
# code of the Force, the lasers, the bits and the missiles ($01:BEAC-$01:DD7B
# never runs in a random play). Input, not a poke: the game's own path.
POWER_UP = ['r', 'right', 'down', 'y', 'down', 'right', 'down', 'left', 'right', 'down', 'right', 'right']
LASERS = ['a', 'x', 'b', 'y', 'r']


def power_up_presses(frame, laser, missile):
    """The presses of the instant power-up from `frame` on (the ship must be playing):
    about 150 frames of input, the game unpaused at the end."""
    out = [(frame, frame + 4, 'start')]
    f = frame + 20
    for b in POWER_UP:
        out.append((f, f + 3, b))
        f += 8
    out.append((f + 10, f + 13, laser))
    out.append((f + 24, f + 27, missile))
    out.append((f + 40, f + 43, 'start'))
    return out


def random_inputs(seed, start, end, hold=(6, 40), fire=0.7):
    """Náhodná procházka ze semínka: každých 6–40 snímků jiná kombinace směrů
    a tlačítek; s pravděpodobností `fire` drží i Y a B (střelba / paprsek)."""
    rnd = random.Random(seed)
    out, f = [], start
    while f < end:
        n = rnd.randint(*hold)
        bs = set(rnd.sample(PLAY[:4], rnd.randint(0, 2)))
        if rnd.random() < fire:
            bs |= {'y', 'b'} if rnd.random() < 0.5 else {rnd.choice(['y', 'b'])}
        if rnd.random() < 0.15:
            bs.add(rnd.choice(['a', 'x', 'l', 'r']))
        if bs:
            out.append((f, min(f + n, end), ','.join(sorted(bs))))
        f += n
    return out


def scenarios():
    s = []
    s.append(('attract', 'titulka bez vstupu (logo, titulka, ? demo)', 9000, [], [], None))
    taps_menu = [(720 + 40 * i, 724 + 40 * i, b) for i, b in
                 enumerate(['down', 'right', 'right', 'up', 'left', 'select', 'down', 'right'])]
    s.append(('menu', 'titulka: volby šipkami a SELECT, pak START', 3000,
              taps_menu + [(1100, 1104, 'start'), (1140, 1144, 'start'), (1180, 1184, 'start')], [], None))
    for seed in (1, 2, 3):
        s.append(('play%d' % seed, 'partie bez cheatů, náhodný vstup ze semínka %d až do konce hry' % seed,
                  14000, START_TAPS + random_inputs(seed, 900, 14000) +
                  [(f, f + 4, 'start') for f in range(9000, 14000, 300)], [], None))
    # M0: sections 0-6 (levels 1-3 and the boss of 4); M4: sections 7-13 (the bosses of levels 4-7 and
    # levels 5-7), 12 000 frames each so that an even section scrolls to its end — the code of every
    # enemy and boss of the wave lists (`data/waves.json` kinds) runs at least once
    for stage in range(14):
        frames = 9000 if stage < 7 else 12000
        s.append(('stage%d' % stage, '`$16E5` = %d přes cheat, nesmrtelnost a životy, náhodný vstup' % stage,
                  frames, START_TAPS + random_inputs(100 + stage, 900, frames), CHEATS, stage))
    # ★ the five lasers through the original's own instant power-up (M3): the ship plays from
    # about frame 2250 after the launch; the code at 2300-2460, then a random walk
    for kind, laser in enumerate(LASERS):
        s.append(('power%d' % kind, 'laser %s (%d) a střely %s přes vestavěný kód vybavení originálu, pak náhodný vstup'
                  % (laser.upper(), kind, 'A' if kind % 2 == 0 else 'X'), 9000,
                  START_TAPS + power_up_presses(2300, laser, 'a' if kind % 2 == 0 else 'x')
                  + random_inputs(200 + kind, 2470, 9000), [], None))
    return s


def run_one(name, desc, frames, presses, cheats, stage):
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
    e.capture('end', frames, what=('cdl', 'access', 'screen'))
    t = time.time()
    r = e.run(frames=frames, workdir=OUT)
    cdl = r.mem('end', 'cdl')
    open(os.path.join(OUT, name + '.cdl'), 'wb').write(cdl)
    acc = {k: {str(a): n for a, n in v.items()} for (cap, k), v in r.access.items() if cap == 'end'}
    json.dump(acc, open(os.path.join(OUT, name + '.access.json'), 'w'))
    code = sum(1 for b in cdl if b & 1)
    data = sum(1 for b in cdl if b & 2)
    print('%-8s %6d snímků  %5.1f s  kód %6d B  data %6d B  — %s' % (name, frames, time.time() - t, code, data, desc))
    return {'name': name, 'desc': desc, 'frames': frames, 'cheats': bool(cheats), 'stage': stage,
            'presses': len(presses), 'code': code, 'data': data}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', help='jen scénáře s tímto jménem (čárkou)')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'samples.json')
    samples = json.load(open(path)) if os.path.exists(path) else {}
    for sc in scenarios():
        if a.only and sc[0] not in a.only.split(','):
            continue
        samples[sc[0]] = run_one(*sc)
        json.dump(samples, open(path, 'w'), indent=1, ensure_ascii=False)   # po každém scénáři
    return 0


if __name__ == '__main__':
    sys.exit(main())
