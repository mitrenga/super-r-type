#!/usr/bin/env python3
"""tracelevels — the running original in every section, at many scroll
positions: VRAM, CGRAM, OAM, the registers and the layer objects.

The reference of `tools/matchlevels.mjs`, `matchtiles.mjs` and
`matchsprites.mjs` (M2). Every capture is one frame at the start of the
vertical blank (`snesemu.py`: before the NMI of that frame changes the
memory): VRAM 64 KB, CGRAM, OAM, the lower 32 KB of WRAM (the layer
objects `$1832` / `$1862`, the scroll `$1830`, the map queue `$2E`, the
object lists, the OAM shadow) and the PPU registers at scanline 0, as
`mkscreen.py` records them.

Two kinds of run:

- `play` — the plain play `play1` of `runcoverage.py` (no cheat): the
  launch (sections 14 and 15) and level 1, frames 1000-14000;
- `secN` — section N through the **section select**: `$7E:16E5` = N while
  the game starts (frames 900-2700), which is the path of the original's
  own level-select code (`S_008B4D` reads `$16E5 & $0F`), plus the
  invincibility of the surveys so that the scroll gets far (`CHEATS`,
  `CHEAT_ROM` of `runcoverage.py`). The picture of the level does not
  depend on the ship; whether this counts as a faithful play is the
  operator's call (`MILNIKY.md` M2).

    ./tools/tracelevels.py                  # everything → build/m2/levels/
    ./tools/tracelevels.py --only sec0,play
"""
import argparse, base64, json, os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from snesemu import SnesEmu  # noqa: E402
from runcoverage import scenarios, random_inputs, STAGE, CHEATS, CHEAT_ROM  # noqa: E402
from scanhw import START_TAPS  # noqa: E402
from mkscreen import registers  # noqa: E402

OUT = os.path.join(PROJECT, 'build', 'm2', 'levels')
WRAM_KEEP = 0x8000


def b64(b):
    return base64.b64encode(bytes(b)).decode('ascii')


def layer(w, base):
    W = lambda a: struct.unpack('<H', w[a:a + 2])[0]
    return {'base': base, 'mapBase': W(base), 'hscroll': W(base + 4), 'vscroll': W(base + 6),
            'stream': W(base + 8), 'blocks': W(base + 0xA), 'stride': W(base + 0xC), 'maxPosition': W(base + 0x10),
            'kind': W(base + 0x12), 'speedX': W(base + 0x14), 'lastColumn': W(base + 0x16), 'lastRow': W(base + 0x18),
            'xFrac': w[base + 0x1A], 'x': W(base + 0x1B), 'xHigh': w[base + 0x1C] if False else w[base + 0x1D],
            'y': W(base + 0x1E), 'yFrac': w[base + 0x1D], 'streamNext': W(base + 0x20), 'collisionBase': W(base + 0x22),
            'speedY': W(base + 0x24), 'script': W(base + 0x26), 'scriptStep': W(base + 0x28), 'trigger': W(base + 0x2A),
            'wraps': W(base + 0x2C), 'stop': W(base + 0x2E)}


def record(name, e_run, frames, out_dir):
    results = []
    # executions of map_enqueue_b / map_enqueue_c since the last section load, per frame
    since_load = {}
    n = 0
    for fr in e_run.frames:
        if fr['pc'] and fr['pc'][0]:
            n = 0
        if fr['pc']:
            n += fr['pc'][1] + fr['pc'][2]
        since_load[fr['frame']] = n
    for f in frames:
        vbl = e_run.state('vbl%d' % f)
        # (a long run may miss a scanline-0 capture — the registers then come from the vertical blank, flagged)
        top = e_run.states.get('top%d' % f, vbl)
        w = e_run.mem('vbl%d' % f, 'wram')
        W = lambda a: struct.unpack('<H', w[a:a + 2])[0]
        rec = {
            'scenario': name, 'frame': f,
            'registers': registers(top),
            'registersAtVblank': ('top%d' % f) not in e_run.states,
            'flags': {'rangeOver': bool(vbl['ppu.rangeOver']), 'timeOver': bool(vbl['ppu.timeOver'])},
            'game': {'section': w[0x16E5], 'difficulty': w[0x16D5], 'passes': W(0x50), 'nmis': W(0x4E),
                     'scroll': W(0x1830), 'scrollFrac': w[0x182F], 'scrollEnd': W(0x1825), 'scrollSpeed': W(0x1827),
                     'spawnNext': W(0x182B), 'levelFlags': W(0x1821), 'queue': W(0x2E), 'frameFlags': W(0x4C),
                     'lives': w[0x16E1], 'defaultLayer': W(0x46), 'levelBank': w[0x94],
                     'objectMapWrites': since_load.get(f, 0)},
            'layers': [layer(w, 0x1832), layer(w, 0x1862), layer(w, 0x1892)],
            'vram': b64(e_run.mem('vbl%d' % f, 'vram')),
            'cgram': b64(e_run.mem('vbl%d' % f, 'cgram')),
            'oam': b64(e_run.mem('vbl%d' % f, 'oam')),
            'wram': b64(w[:WRAM_KEEP]),
        }
        path = os.path.join(out_dir, '%s_f%05d.json' % (name, f))
        json.dump(rec, open(path, 'w'))
        results.append(path)
        g = rec['game']
        print('  %s f%5d section %2d scroll %4d passes %5d queue %2d BG1 x %4d col %3d kind %2d | BG2 x %4d col %3d kind %2d' % (
            name, f, g['section'], g['scroll'], g['passes'], g['queue'],
            rec['layers'][0]['x'], rec['layers'][0]['lastColumn'], rec['layers'][0]['kind'],
            rec['layers'][1]['x'], rec['layers'][1]['lastColumn'], rec['layers'][1]['kind']))
    return results


def run(name, presses, cheats, stage, frames, out_dir, poke_until=2700):
    e = SnesEmu()
    for p in presses:
        e.press(*p)
    if stage is not None:
        e.poke(STAGE, stage, 900, poke_until)
    for a, v in cheats:
        e.poke(a, v, 900)
    if cheats:
        for a, v in CHEAT_ROM:
            e.patch_rom(a, v)
    for f in frames:
        e.capture('top%d' % f, f, line=0, what=('state',))
        e.capture('vbl%d' % f, f, what=('vram', 'cgram', 'oam', 'wram', 'state'))
    # ★ per frame: section loads (S_008B4D) and the object code's map writes (map_enqueue_b / map_enqueue_c)
    e.count_pc(0x008B4D, 0x0091A2, 0x0091F2)
    r = e.run(frames=max(frames) + 1)
    return record(name, r, frames, out_dir)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', help='scenario names, comma-separated (play, sec0..sec15)')
    ap.add_argument('-o', default=OUT)
    a = ap.parse_args()
    only = a.only.split(',') if a.only else None
    os.makedirs(a.o, exist_ok=True)
    if not only or 'play' in only:
        sc = [s for s in scenarios() if s[0] == 'play1'][0]
        run('play', sc[3], [], None, list(range(1000, 14000, 250)), a.o)
    if only and 'end12' in only:
        # the end of level 7 (section 12) and, after it, the last boss (section 13), which no select reaches
        run('end12', START_TAPS + random_inputs(112, 900, 16000), CHEATS, 12, list(range(2900, 16000, 200)), a.o)
    for sec in range(16):
        name = 'sec%d' % sec
        if only and name not in only:
            continue
        if sec & 1 and sec < 14:
            # ★ a boss section: the start-up clears bit 0 of $16E5 ($01:81BA), so the poke must outlast it
            # (until frame 5000 — the launch takes a different time with every walk, and the poke after the load is harmless); the ship meets the boss within a few hundred frames
            run(name, START_TAPS + random_inputs(100 + sec, 900, 5100), CHEATS, sec, list(range(3425, 5100, 25)), a.o, 5000)
        else:
            run(name, START_TAPS + random_inputs(100 + sec, 900, 6100), CHEATS, sec, list(range(2900, 6100, 100)), a.o)
    return 0


if __name__ == '__main__':
    sys.exit(main())
