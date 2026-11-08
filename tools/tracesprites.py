#!/usr/bin/env python3
"""tracesprites — every object the original drew into OAM, frame by frame,
and the OAM it made of them.

The reference of `tools/matchsprites.mjs` (M2). On the chosen frames of
a scenario it logs every call of `draw_object_sprites` (`$00:99F3`) with
the object's X, Y, metasprite address, attribute word and slot table
(`snesemu.py` `watch_exec`, in the order the original drew them — group
1, then group 2 forwards or backwards), the pass counter and the `STAT77`
copy, and at the vertical blank of the same frame the OAM shadow
`$7E:2200`-`$2420`, the slot tables `$7E:1CBC`, and the OAM itself.
Frames whose NMI was skipped (lag: the shadow then belongs to a pass the
log of the frame does not hold) are marked by the NMI counter.

    ./tools/tracesprites.py                       # play1 1000-3000 and sections 0, 4, 8, 12 → build/m2/sprites/
    ./tools/tracesprites.py --only sec4
"""
import argparse, base64, json, os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from snesemu import SnesEmu  # noqa: E402
from runcoverage import scenarios, random_inputs, STAGE, CHEATS, CHEAT_ROM  # noqa: E402
from scanhw import START_TAPS  # noqa: E402

OUT = os.path.join(PROJECT, 'build', 'm2', 'sprites')
DRAW = 0x0099F3
SLOT_TABLES, SLOT_TABLE_BYTES, SLOTS = 0x1CBC, 32, 8


def b64(b):
    return base64.b64encode(bytes(b)).decode('ascii')


def run(name, presses, cheats, stage, frames, out_dir):
    e = SnesEmu()
    for p in presses:
        e.press(*p)
    if stage is not None:
        e.poke(STAGE, stage, 900, 2700)
    for a, v in cheats:
        e.poke(a, v, 900)
    if cheats:
        for a, v in CHEAT_ROM:
            e.patch_rom(a, v)
    for f in frames:
        # the pass that made the shadow at the vertical blank of f may have started in f-1 (a pass straddles
        # frames), so the calls of both frames are logged; matchsprites takes the last run that began at $1FC
        e.watch_exec(DRAW, 'draw%d' % f, (('X', 0), ('X', 2), ('X', 4), ('X', 8), ('X', 0xA), ('dp', 0x50), ('dp', 0xF4), ('dp', 0x7E), ('dp', 0x4E)), f - 1, f + 1)
        e.capture('vbl%d' % f, f, what=('wram', 'oam', 'state'))
    r = e.run(frames=max(frames) + 1)
    out = []
    for f in frames:
        w = r.mem('vbl%d' % f, 'wram')
        W = lambda a: struct.unpack('<H', w[a:a + 2])[0]
        calls = []
        for h in r.exec_hits.get('draw%d' % f, []):
            # (frame, line, A, X, Y, DB, D, X+0, X+2, X+4, X+8, X+A, $50, $F4, $7E, $4E)
            # (frame, line, A, X, Y, DB, D, X+0, X+2, X+4, X+8, X+A, $50, $F4, $7E, $4E)
            calls.append({'frame': h[0], 'line': h[1], 'object': h[3], 'x': h[7], 'y': h[8],
                          'metasprite': 0x040000 | h[9],      # S_0098F2: $12 = 4 — the metasprites' bank
                          'attr': h[10], 'slots': h[11], 'pass': h[12], 'stat77': h[13] & 0xFF, 'oamIndex': h[14], 'nmis': h[15]})
        rec = {
            'scenario': name, 'frame': f,
            'calls': calls,
            'game': {'passes': W(0x50), 'nmis': W(0x4E), 'stat77': w[0xF4], 'group1Count': W(0x6C), 'group2Count': W(0x72),
                     'frameFlags': W(0x4C), 'section': w[0x16E5], 'metaspriteBank': 0x04},
            'slotTables': b64(w[SLOT_TABLES:SLOT_TABLES + SLOT_TABLE_BYTES * SLOTS]),
            'oamShadow': b64(w[0x2200:0x2420]),
            'oam': b64(r.mem('vbl%d' % f, 'oam')),
            'flags': {'timeOver': bool(r.state('vbl%d' % f)['ppu.timeOver']), 'rangeOver': bool(r.state('vbl%d' % f)['ppu.rangeOver'])},
        }
        path = os.path.join(out_dir, '%s_f%05d.json' % (name, f))
        json.dump(rec, open(path, 'w'))
        out.append(path)
        print('  %s f%5d: %3d objects drawn, pass %5d, stat77 $%02X' % (name, f, len(calls), rec['game']['passes'], rec['game']['stat77']))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only')
    ap.add_argument('-o', default=OUT)
    a = ap.parse_args()
    only = a.only.split(',') if a.only else None
    os.makedirs(a.o, exist_ok=True)
    if not only or 'play' in only:
        sc = [s for s in scenarios() if s[0] == 'play1'][0]
        run('play', sc[3], [], None, list(range(1000, 3000, 50)), a.o)
    for sec in (0, 4, 8, 12):
        name = 'sec%d' % sec
        if only and name not in only:
            continue
        run(name, START_TAPS + random_inputs(100 + sec, 900, 5000), CHEATS, sec, list(range(3000, 5000, 50)), a.o)
    return 0


if __name__ == '__main__':
    sys.exit(main())
