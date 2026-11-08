#!/usr/bin/env python3
"""traceship — the original playing a level with the ship, frame by frame, with scripted input.

The reference of `tools/matchship.mjs` (M3). Every recorded frame holds the
lower 12.5 KB of WRAM at the start of its vertical blank (`snesemu.py`
`wramlo`: the task pool, the game's variables, the OAM and CGRAM shadows, the
sprite groups — before the NMI of that frame changes anything), whether that
NMI was the **lag** kind (`$00:82C5`: the pass of the main loop had not
finished — `disasm_notes.md` §2), and the **timing** of the pass: the master
clock of `main_frame`, `main_frame_end`, the NMI's entry and exit, and of
every task's dispatch and return, for `tools/measurebudget.mjs` and the lag
model `app/frameBudget.js`.

Scenarios, by level 1-7 (section 2·(N−1), through `$7E:16E5` while the game
starts — the path of the original's level select, as `tracelevels.py` of
M2; the launch from the mother ship plays first, as it always does):

- `a` — the ship alone: **the wave spawner spawns no enemy** — ★ every
  entry of the wave lists whose code is not the sprite-set loader
  `$01:DD7C` is patched in the ROM to `$01:DDA6` (`JML L_008806`: a task
  that dies in its first pass, so the nodes are taken and freed exactly
  as the remake does it with `noEnemies`). The ship flies, shoots,
  charges the beam, dies on the terrain and restarts;
- `b` — the same with **the Force, a laser, the missiles and the bits**
  through the original's own instant power-up (the pause and the presses
  of `$04:9073`, `runcoverage.py`): laser `--laser` 0-4 (A X B Y R),
  missiles A (`--missile x` for the other kind and two bits). One
  recording a laser kind: `l1b` is kind 1 (the default), `l1b0`, `l1b2`,
  `l1b3`, `l1b4` the others (`--out build/m3/ship/l1b<kind>`), each with
  its own seed and a walk long enough for the docked Force to fire.

The input after that is a seeded random walk of the directions, taps and
holds of B, taps of A (the Force) and of X / Y (the autofire), from
`random_inputs` of `runcoverage.py`.

    tools/traceship.py --level 1 --scenario a            # -> build/m3/ship/l1a/
    tools/traceship.py --all --frames 3000
"""
import argparse, json, os, random, struct, sys, zlib
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from snesemu import SnesEmu  # noqa: E402
from runcoverage import STAGE, LASERS, power_up_presses, PLAY  # noqa: E402
from scanhw import START_TAPS  # noqa: E402
import srtlib as L  # noqa: E402

OUT = os.path.join(PROJECT, 'build', 'm3', 'ship')
WRAM_LO = 0x3200
# the addresses the timing hooks sit on
MAIN_FRAME, MAIN_FRAME_END, NMI, NMI_LAG, NMI_EXIT = 0x0081C0, 0x00827D, 0x008286, 0x0082C5, 0x0084D7
TASK_CALL, TASK_RET = 0x008253, 0x008256
LOADER_TASK, LOADER_DIE = 0x01DD7C, 0x01DDA6
# ★ the joypad word of the automatic read ($4219:$4218): B Y Sel St U D L R / A X L R
BUTTON_BITS = {'b': 0x8000, 'y': 0x4000, 'select': 0x2000, 'start': 0x1000, 'up': 0x0800, 'down': 0x0400,
               'left': 0x0200, 'right': 0x0100, 'a': 0x0080, 'x': 0x0040, 'l': 0x0020, 'r': 0x0010}
POWER_UP_FRAME = 2300
PLAY_FROM = {'a': 2140, 'b': 2470}


def enemy_patches(rom):
    """★ Every wave entry of every section whose code is not the sprite-set loader
    becomes the task that dies at once: (ROM address, byte) triples."""
    out = []
    seen = set()
    for section in range(L.SECTIONS):
        ptr = L.ptr3(rom, L.LEVEL_TABLE + 3 * section)
        bank = ptr >> 16
        rec = L.level_header(rom, ptr)
        lst = (bank << 16) | rec['spawnList']
        if lst in seen:
            continue
        seen.add(lst)
        for i, e in enumerate(L.spawn_list(rom, lst)):
            if e['code'] == LOADER_TASK:
                continue
            a = lst + 12 * i + 2
            out += [(a, LOADER_DIE & 0xFF), (a + 1, (LOADER_DIE >> 8) & 0xFF), (a + 2, LOADER_DIE >> 16)]
    return out


def walk(seed, start, end, force=False):
    """A seeded random walk: directions held 6-40 frames, B tapped or held, A and X/Y now and then."""
    rnd = random.Random(seed)
    out, f = [], start
    while f < end:
        n = rnd.randint(6, 40)
        dirs = set(rnd.sample(PLAY[:4], rnd.randint(0, 2)))
        if dirs:
            out.append((f, min(f + n, end), ','.join(sorted(dirs))))
        r = rnd.random()
        if r < 0.35:
            out.append((f, min(f + rnd.randint(1, 4), end), 'b'))                 # a tap: a shot
        elif r < 0.65:
            out.append((f, min(f + rnd.randint(20, 200), end), 'b'))              # a hold: the beam
        elif r < 0.75:
            out.append((f, min(f + rnd.randint(4, 30), end), rnd.choice(['x', 'y'])))   # the autofire
        if force and rnd.random() < 0.12:
            out.append((f + rnd.randint(0, n), min(f + n, end), 'a'))              # the Force
        f += n
    return out


def joypad_words(presses, frames):
    """The joypad word of every frame from the press list."""
    words = [0] * (frames + 1)
    for s, e, names in presses:
        bits = 0
        for n in names.split(','):
            bits |= BUTTON_BITS[n]
        for f in range(s, min(e, frames + 1)):
            words[f] |= bits
    return words


def record(level, scenario, frames, seed, laser, missile, out, keep_script=None):
    os.makedirs(out, exist_ok=True)
    rom = L.rom_bytes()
    section = 2 * (level - 1)
    e = SnesEmu()
    presses = list(START_TAPS)
    if scenario == 'b':
        presses += power_up_presses(POWER_UP_FRAME, LASERS[laser], missile)
    presses += walk(seed, PLAY_FROM[scenario], frames, force=(scenario == 'b'))
    for p in presses:
        e.press(*p)
    if section:
        e.poke(STAGE, section, 900, 2700)
    patches = enemy_patches(rom)
    for a, v in patches:
        e.patch_rom(a, v)
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
    # the frames
    blob = bytearray()
    index = []
    by_frame = {fr['frame']: fr for fr in r.frames}
    for f in range(first, frames + 1):
        w = r.mem('f%d' % f, 'wramlo')
        assert len(w) == WRAM_LO
        blob += w
        fr = by_frame.get(f, {})
        # ★ the per-frame counters are read at the start of the vertical blank, before the NMI of that
        # frame runs: the NMI of frame f is counted in frame f + 1 — shifted back here, so that
        # index[f].lag says what the NMI at the vertical blank of frame f did
        nxt = by_frame.get(f + 1, {})
        index.append({'frame': f, 'lag': bool(nxt.get('pc', [0])[0]), 'passes': nxt.get('pc', [0, 0])[1],
                      'timeOver': bool(fr.get('timeOver')), 'rangeOver': bool(fr.get('rangeOver')),
                      'brightness': fr.get('brightness')})
    open(os.path.join(out, 'frames.bin.zz'), 'wb').write(zlib.compress(bytes(blob), 6))
    # the timing: by frame, the clocks of the hooks
    timing = {}
    for name in ('pass', 'passEnd', 'nmi', 'nmiExit', 'taskEnd'):
        for h in r.exec_hits.get(name, []):
            timing.setdefault(h[0], {}).setdefault(name, []).append(h[-1])
    for h in r.exec_hits.get('task', []):
        frame, line, A, X, Y, DB, D, code, bank, node, clock = h
        timing.setdefault(frame, {}).setdefault('task', []).append([((bank & 0xFF) << 16) | code, node, clock])
    words = joypad_words(presses, frames)
    meta = {'level': level, 'section': section, 'scenario': scenario, 'frames': frames, 'first': first,
            'seed': seed, 'laser': laser if scenario == 'b' else None, 'missile': missile if scenario == 'b' else None,
            'powerUpFrame': POWER_UP_FRAME if scenario == 'b' else None,
            'wramBytes': WRAM_LO, 'patches': len(patches),
            'note': 'frames.bin.zz = zlib of the first %d B of WRAM at the start of the vertical blank of every '
                    'frame %d..%d (before its NMI); index[].lag = that NMI took $00:82C5; joypad[f] = the word the '
                    'automatic read gives at frame f; timing[f] = master clocks within frame f of main_frame, '
                    'main_frame_end, the NMI entry/exit, every task dispatch [code, node, clock] and return; '
                    'wave entries patched to $01:DDA6 (no enemies)' % (WRAM_LO, first, frames),
            'presses': presses}
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    json.dump({'index': index, 'joypad': words, 'timing': {str(k): v for k, v in timing.items()}},
              open(os.path.join(out, 'index.json'), 'w'))
    lags = sum(1 for i in index if i['lag'])
    print('%s: level %d section %d, frames %d-%d, %d lag frames, %d wave entries patched -> %s'
          % (os.path.basename(out), level, section, first, frames, lags, len(patches) // 3, os.path.relpath(out, PROJECT)))
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--scenario', default='a', help='a = the ship alone, b = with the power-up')
    ap.add_argument('--all', action='store_true', help='levels 1-7, scenarios a and b')
    ap.add_argument('--frames', type=int, default=4500, help='the last frame recorded')
    ap.add_argument('--seed', type=int, help='the walk\'s seed (default: level * 16 + scenario)')
    ap.add_argument('--laser', type=int, default=1, help='the laser of scenario b (0-4 = A X B Y R)')
    ap.add_argument('--missile', default='a', help='the missile of scenario b (a / x)')
    ap.add_argument('--out', help='the directory (default build/m3/ship/l<level><scenario>)')
    ap.add_argument('--keep-script', help='keep the generated Lua script here')
    a = ap.parse_args()
    runs = []
    if a.all:
        for level in range(1, 8):
            for sc in ('a', 'b'):
                runs.append((level, sc, (level - 1) % 5))
    else:
        runs.append((a.level, a.scenario, a.laser))
    ok = True
    for level, sc, laser in runs:
        seed = a.seed if a.seed is not None else level * 16 + ord(sc) - ord('a')
        out = a.out or os.path.join(OUT, 'l%d%s' % (level, sc))
        ok &= record(level, sc, a.frames, seed, laser, a.missile, out, a.keep_script)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
