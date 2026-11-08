#!/usr/bin/env python3
"""traceenemies — the original playing with the enemies on, frame by frame, with scripted input.

The reference of `tools/matchenemies.mjs` (M4): `tools/traceship.py` without
its harness patch — every entry of the wave lists spawns what the original
spawns, so the recordings hold the enemies, their shots, the hits, the
explosions, the bosses and the full-screen passes with their lag frames.
Every frame holds the lower 12.5 KB of WRAM at the start of its vertical
blank, the lag flag of its NMI and the timing of the pass (`traceship.py`
for the format; `tools/measurebudget.mjs` refits the lag model from these
too).

Scenarios, by level 1-7:

- `a` — the ship alone in the level's first section (2·(N−1), through
  `$7E:16E5` while the game starts — the original's level select, as M2
  and M3); the seeded random walk flies, shoots, charges the beam, dies on
  the enemies and the terrain and restarts, until the game over;
- `b` — the same with the Force, a laser (`--laser`, default (N−1) mod 5),
  the missiles and the bits through the original's own instant power-up
  (`runcoverage.py` `power_up_presses`);
- `--boss` — the level's boss section (2·N−1) instead: ★ the start-up
  clears bit 0 of `$16E5` (`$01:81BA`), so the poke lasts until frame
  5000 as `tracelevels.py` did for M2 (a decision of the operator, see
  `MILNIKY.md`); the recording is `b<N><scenario>`;
- `--seed` another walk of the same scenario (`l1a2` = seed 2 — the
  recordings a level has are what `tools/scancoverage.mjs` sums up).

    tools/traceenemies.py --level 1 --scenario a            # -> build/m4/enemies/l1a/
    tools/traceenemies.py --level 3 --scenario b --boss      # -> build/m4/enemies/b3b/
    tools/traceenemies.py --all --frames 6000
"""
import argparse, json, os, sys, zlib
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from snesemu import SnesEmu  # noqa: E402
from runcoverage import STAGE, LASERS, power_up_presses  # noqa: E402
from scanhw import START_TAPS  # noqa: E402
from traceship import (walk, joypad_words, WRAM_LO, MAIN_FRAME, MAIN_FRAME_END, NMI, NMI_LAG, NMI_EXIT,  # noqa: E402
                       TASK_CALL, TASK_RET, POWER_UP_FRAME, PLAY_FROM)

OUT = os.path.join(PROJECT, 'build', 'm4', 'enemies')
# ★ a boss section's poke must outlast the start-up that clears bit 0 of $16E5 (tracelevels.py)
BOSS_POKE_UNTIL = 5000


def record(level, scenario, boss, frames, seed, laser, missile, out, keep_script=None):
    os.makedirs(out, exist_ok=True)
    section = 2 * (level - 1) + (1 if boss else 0)
    e = SnesEmu()
    presses = list(START_TAPS)
    if scenario == 'b':
        presses += power_up_presses(POWER_UP_FRAME, LASERS[laser], missile)
    if scenario == 'c':
        # ★ the hold: the ship stays where the section put it and only fires — the random walk flies into the
        # terrain of a boss section within a few hundred frames and never meets the boss (b2a: game over at f3258)
        presses += [p for p in walk(seed, PLAY_FROM['a'], frames) if p[2] in ('b', 'x', 'y')]
    else:
        presses += walk(seed, PLAY_FROM[scenario], frames, force=(scenario == 'b'))
    for p in presses:
        e.press(*p)
    if section:
        e.poke(STAGE, section, 900, BOSS_POKE_UNTIL if boss else 2700)
    first = 900
    for f in range(first, frames + 1):
        e.capture('f%d' % f, f, what=('wramlo',))
    e.count_pc(NMI_LAG, MAIN_FRAME)
    e.watch_exec(MAIN_FRAME, 'pass', start=first, clock=True)
    e.watch_exec(MAIN_FRAME_END, 'passEnd', start=first, clock=True)
    e.watch_exec(NMI, 'nmi', start=first, clock=True)
    e.watch_exec(NMI_EXIT, 'nmiExit', start=first, clock=True)
    e.watch_exec(TASK_CALL, 'task', reads=(('dp', 0x10), ('dp', 0x12), ('abs', 0x18)), start=first, clock=True)
    e.watch_exec(TASK_RET, 'taskEnd', start=first, clock=True)
    r = e.run(frames=frames + 1, workdir=out, keep_script=keep_script,
              timeout=max(120, frames // 10 + 120))
    blob = bytearray()
    index = []
    by_frame = {fr['frame']: fr for fr in r.frames}
    for f in range(first, frames + 1):
        w = r.mem('f%d' % f, 'wramlo')
        assert len(w) == WRAM_LO
        blob += w
        fr = by_frame.get(f, {})
        # ★ the NMI of frame f is counted in frame f + 1 (the counters are read before the NMI) — shifted back
        nxt = by_frame.get(f + 1, {})
        index.append({'frame': f, 'lag': bool(nxt.get('pc', [0])[0]), 'passes': nxt.get('pc', [0, 0])[1],
                      'timeOver': bool(fr.get('timeOver')), 'rangeOver': bool(fr.get('rangeOver')),
                      'brightness': fr.get('brightness')})
    open(os.path.join(out, 'frames.bin.zz'), 'wb').write(zlib.compress(bytes(blob), 6))
    timing = {}
    for name in ('pass', 'passEnd', 'nmi', 'nmiExit', 'taskEnd'):
        for h in r.exec_hits.get(name, []):
            timing.setdefault(h[0], {}).setdefault(name, []).append(h[-1])
    for h in r.exec_hits.get('task', []):
        frame, line, A, X, Y, DB, D, code, bank, node, clock = h
        timing.setdefault(frame, {}).setdefault('task', []).append([((bank & 0xFF) << 16) | code, node, clock])
    words = joypad_words(presses, frames)
    meta = {'level': level, 'section': section, 'boss': boss, 'scenario': scenario, 'frames': frames, 'first': first,
            'seed': seed, 'laser': laser if scenario == 'b' else None, 'missile': missile if scenario == 'b' else None,
            'powerUpFrame': POWER_UP_FRAME if scenario == 'b' else None,
            'wramBytes': WRAM_LO, 'patches': 0,
            'note': 'frames.bin.zz = zlib of the first %d B of WRAM at the start of the vertical blank of every '
                    'frame %d..%d (before its NMI); index[].lag = that NMI took $00:82C5; joypad[f] = the word the '
                    'automatic read gives at frame f; timing[f] = master clocks within frame f of main_frame, '
                    'main_frame_end, the NMI entry/exit, every task dispatch [code, node, clock] and return; '
                    'enemies on (no patch)' % (WRAM_LO, first, frames),
            'presses': presses}
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    json.dump({'index': index, 'joypad': words, 'timing': {str(k): v for k, v in timing.items()}},
              open(os.path.join(out, 'index.json'), 'w'))
    lags = sum(1 for i in index if i['lag'])
    print('%s: level %d section %d%s, frames %d-%d, %d lag frames -> %s'
          % (os.path.basename(out), level, section, ' (boss)' if boss else '', first, frames, lags, os.path.relpath(out, PROJECT)))
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--scenario', default='a', help='a = the ship alone, b = with the power-up, c = the ship holds its place and fires (boss coverage)')
    ap.add_argument('--boss', action='store_true', help='the boss section of the level (2N-1)')
    ap.add_argument('--all', action='store_true', help='levels 1-7, scenarios a and b, levels and bosses')
    ap.add_argument('--frames', type=int, default=6000, help='the last frame recorded')
    ap.add_argument('--seed', type=int, help='the walk\'s seed (default: level * 16 + scenario [+ 128 boss]); names the recording l1a<seed>')
    ap.add_argument('--laser', type=int, help='the laser of scenario b (0-4 = A X B Y R; default (level-1) mod 5)')
    ap.add_argument('--missile', default='a', help='the missile of scenario b (a / x)')
    ap.add_argument('--out', help='the directory (default build/m4/enemies/<name>)')
    ap.add_argument('--keep-script', help='keep the generated Lua script here')
    a = ap.parse_args()
    runs = []
    if a.all:
        for level in range(1, 8):
            for boss in (False, True):
                for sc in ('a', 'b'):
                    runs.append((level, sc, boss))
    else:
        runs.append((a.level, a.scenario, a.boss))
    ok = True
    for level, sc, boss in runs:
        laser = a.laser if a.laser is not None else (level - 1) % 5
        seed = a.seed if a.seed is not None else level * 16 + ord(sc) - ord('a') + (128 if boss else 0)
        name = '%s%d%s' % ('b' if boss else 'l', level, sc) + ('%d' % a.seed if a.seed is not None else '')
        out = a.out or os.path.join(OUT, name)
        ok &= record(level, sc, boss, a.frames, seed, laser, a.missile, out, a.keep_script)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
