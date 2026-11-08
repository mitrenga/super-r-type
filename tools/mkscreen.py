#!/usr/bin/env python3
"""mkscreen — one frame of the running original as data, and the same frame as
MesenCE drew it.

The reference of M1 (`MILNIKY.md`): the picture of *Super R-Type* is what
the PPU makes of **VRAM, CGRAM, OAM and its registers**, so one frame is
those four things — and the register writes the main loop makes **while
the beam runs** (★ `hw_notes.md`: the brightness INIDISP during a fade).
`app/screenLoader.js` puts the record into the library's `SNESPPU` and
`tools/matchscreen.mjs` compares its pixels with the emulator's, pixel by
pixel.

What is recorded for frame F (`snesemu.py` units: frame F runs from
scanline 0, the picture is scanlines 1-224 = picture rows 0-223):

1. the **registers at scanline 0** of F — the values the vertical blank
   before it left (scroll, mode, maps, brightness…), read back from the
   emulator's PPU state and turned into the bytes the program wrote;
2. **VRAM, CGRAM and OAM at the start of the vertical blank** of F
   (scanline 225, before the NMI of F changes them) — the memory the
   picture of F was made of; the sprite flags of STAT77 from the same state;
3. every write to **INIDISP `$2100`** during the picture of F with the row
   and the x where it landed (`watch_reg`);
4. the emulator's picture of F (`emu.getScreenBuffer()` at the same
   moment), 256×239 → the 224 rows of the picture, as a PPM in
   `build/ref/`.

Scenes: the title without input (`--title`, frames 300 and 700), and
level 1 played with the recorded random walk of `runcoverage.py`'s `play1`
(START on frame 720, the walk from 900). `--frames` picks the frames,
`--scenario` the walk (`play1`, `play2`, `play3`; `stage0`…`stage6` are the
cheat scenes of `dumpppu.py` — a renderer reference, not a game state).
`--scan` runs the scenario once and lists the frames worth recording: the
ones with **time over / range over** (the limits of sprites on a line) and
the ones with a **brightness write inside the picture** (a fade).

    ./tools/mkscreen.py --title                       # data/screen_title.json, build/screens/title_f0700.json
    ./tools/mkscreen.py                               # data/screen.json (play1, frame 1500)
    ./tools/mkscreen.py --frames 1000,2000,2500 -o build/screens
    ./tools/mkscreen.py --scenario stage5 --frames 5000,5003 -o build/screens
    ./tools/mkscreen.py --scan 900:3500 [--scenario play1]

`data/screen.json` is what the application shows in M1 (`app/levelModel.js`);
everything else stays in `build/` (regenerated here, not in git).
"""
import argparse, base64, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from snesemu import SnesEmu, PROJECT, save_ppm   # noqa: E402
from runcoverage import scenarios, STAGE, CHEAT_ROM   # noqa: E402

INIDISP = 0x2100
PICTURE_ROWS = 224
DEFAULT_FRAME = 1500


def scenario(name):
    for sc in scenarios():
        if sc[0] == name:
            return sc
    raise SystemExit('unknown scenario %r' % name)


def emulator(sc, until):
    """An emulator with the scenario's input and cheats, like runcoverage.py."""
    name, desc, frames, presses, cheats, stage = sc
    e = SnesEmu()
    for p in presses:
        if p[0] < until + 1:
            e.press(*p)
    if stage is not None:
        e.poke(STAGE, stage, 900, 2700)
    for addr, val in cheats:
        e.poke(addr, val, 900)
    if cheats:
        for addr, val in CHEAT_ROM:
            e.patch_rom(addr, val)
    return e


def registers(st):
    """The register bytes out of the emulator's decoded PPU state — the
    inverse of what the PPU does with a write (Fullsnes, `SnesPpu::Write`)."""
    layers = [{k: st['ppu.layers[%d].%s' % (i, k)] for k in
               ('tilemapAddress', 'chrAddress', 'doubleWidth', 'doubleHeight', 'largeTiles', 'hscroll', 'vscroll')}
              for i in range(4)]
    bgmode = st['ppu.bgMode'] | (0x08 if st['ppu.mode1Bg3Priority'] else 0)
    for i, l in enumerate(layers):
        if l['largeTiles']:
            bgmode |= 0x10 << i
    tmw = sum((1 << i) for i in range(5) if st['ppu.windowMaskMain[%d]' % i])
    tsw = sum((1 << i) for i in range(5) if st['ppu.windowMaskSub[%d]' % i])
    cgadsub = (st['ppu.colorMathEnabled'] & 0x3F) | (0x40 if st['ppu.colorMathHalveResult'] else 0) | \
              (0x80 if st['ppu.colorMathSubtractMode'] else 0)
    cgwsel = (1 if st['ppu.directColorMode'] else 0) | (2 if st['ppu.colorMathAddSubscreen'] else 0) | \
             ((st.get('ppu.colorMathPreventMode', 0) & 3) << 4) | ((st.get('ppu.colorMathClipMode', 0) & 3) << 6)
    setini = (1 if st['ppu.screenInterlace'] else 0) | (2 if st['ppu.objInterlace'] else 0) | \
             (4 if st['ppu.overscanMode'] else 0) | (8 if st['ppu.hiResMode'] else 0) | (0x40 if st['ppu.extBgEnabled'] else 0)
    return {
        'inidisp': (0x80 if st['ppu.forcedBlank'] else 0) | (st['ppu.screenBrightness'] & 15),
        'obsel': (st['ppu.oamMode'] << 5) | ((((st['ppu.oamAddressOffset'] >> 12) - 1) & 3) << 3) | ((st['ppu.oamBaseAddress'] >> 13) & 7),
        'bgmode': bgmode,
        'mosaic': ((st['ppu.mosaicSize'] - 1) << 4) | (st['ppu.mosaicEnabled'] & 15),
        'bgsc': [((l['tilemapAddress'] >> 10) << 2) | (1 if l['doubleWidth'] else 0) | (2 if l['doubleHeight'] else 0) for l in layers],
        'bg12nba': (layers[0]['chrAddress'] >> 12) | ((layers[1]['chrAddress'] >> 12) << 4),
        'bg34nba': (layers[2]['chrAddress'] >> 12) | ((layers[3]['chrAddress'] >> 12) << 4),
        'hofs': [l['hscroll'] & 0x3FF for l in layers],
        'vofs': [l['vscroll'] & 0x3FF for l in layers],
        'tm': st['ppu.mainScreenLayers'], 'ts': st['ppu.subScreenLayers'],
        'tmw': tmw, 'tsw': tsw, 'cgwsel': cgwsel, 'cgadsub': cgadsub, 'setini': setini,
        'oamPriority': bool(st['ppu.enableOamPriority']),
    }


def picture_writes(reg_writes, frame):
    """★ INIDISP writes during the picture of `frame` as {line, x, register,
    value}: scanline s, clock c → picture row s-1, x = (c >> 2) - 22 — the
    pixels before x were drawn with the old value (`SnesPpu::RenderScanline`).
    A write past the right edge belongs to the start of the next row."""
    out = []
    for f, line, clock, value in reg_writes.get(INIDISP, []):
        if f != frame:
            continue
        cycle = clock >> 2 if clock <= 1292 else (clock - 2) >> 2
        row, x = line - 1, cycle - 22
        if x < 0:
            x = 0
        if x >= 256:
            row, x = row + 1, 0
        if 0 <= row < PICTURE_ROWS:
            out.append({'line': row, 'x': x, 'register': INIDISP, 'value': value})
    return out


def record(sc, frames, out_dir, data_name=None):
    """Records the frames of the scenario; `data_name` puts the first one into data/."""
    e = emulator(sc, max(frames))
    e.watch_reg(INIDISP, max(0, min(frames) - 2))
    for f in frames:
        e.capture('top%d' % f, f, line=0, what=('state',))
        e.capture('vbl%d' % f, f, what=('vram', 'cgram', 'oam', 'state', 'screen'))
        e.capture('nxt%d' % f, f + 1, what=('screen',))
    r = e.run(frames=max(frames) + 1)
    os.makedirs(os.path.join(PROJECT, 'build', 'ref'), exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    results = []
    for i, f in enumerate(frames):
        top, vbl = r.state('top%d' % f), r.state('vbl%d' % f)
        regs = registers(top)
        name = '%s_f%04d' % (sc[0], f)
        shot = os.path.join('build', 'ref', name + '.ppm')
        save_ppm(os.path.join(PROJECT, shot), r.screens['vbl%d' % f])
        save_ppm(os.path.join(PROJECT, 'build', 'ref', name + '.next.ppm'), r.screens['nxt%d' % f])
        writes = picture_writes(r.reg_writes, f)
        b64 = lambda b: base64.b64encode(bytes(b)).decode('ascii')
        out = {
            '_comment': 'Super R-Type (USA), MesenCE 2.2.1, scenario %s (%s), frame %d: VRAM, CGRAM and OAM at the start '
                        'of the vertical blank (base64), the PPU registers at scanline 0 as bytes, INIDISP writes during '
                        'the picture as {line, x, register, value}, the sprite flags of STAT77; tools/mkscreen.py, '
                        'checked by tools/matchscreen.mjs against the emulator\'s picture (%s).' % (sc[0], sc[1], f, shot),
            'scenario': sc[0], 'frame': f,
            'registers': regs,
            'writes': writes,
            'flags': {'rangeOver': bool(vbl['ppu.rangeOver']), 'timeOver': bool(vbl['ppu.timeOver'])},
            'vram': b64(r.mem('vbl%d' % f, 'vram')),
            'cgram': b64(r.mem('vbl%d' % f, 'cgram')),
            'oam': b64(r.mem('vbl%d' % f, 'oam')),
            'screenshot': shot,
        }
        target = os.path.join(PROJECT, 'data', data_name) if (i == 0 and data_name) else os.path.join(out_dir, name + '.json')
        os.makedirs(os.path.dirname(target), exist_ok=True)
        json.dump(out, open(target, 'w'))
        print('%s: frame %d, INIDISP $%02X, BG1 %d/%d BG2 %d/%d, %d writes in the picture, timeOver %s rangeOver %s → %s'
              % (name, f, regs['inidisp'], regs['hofs'][0], regs['vofs'][0], regs['hofs'][1], regs['vofs'][1],
                 len(writes), out['flags']['timeOver'], out['flags']['rangeOver'], os.path.relpath(target, PROJECT)))
        results.append(target)
    return results


def scan(sc, start, end):
    e = emulator(sc, end)
    e.watch_reg(INIDISP, start)
    r = e.run(frames=end)
    fades = {}
    for f, line, clock, value in r.reg_writes.get(INIDISP, []):
        if 1 <= line <= 224:
            fades.setdefault(f, []).append((line, value))
    print('frame  timeOver rangeOver brightness  INIDISP writes in the picture (scanline:value)')
    for fr in r.frames:
        f = fr['frame']
        if f < start:
            continue
        if fr['timeOver'] or fr['rangeOver'] or f in fades:
            print('%5d  %-8s %-9s %2s  %s' % (f, fr['timeOver'], fr['rangeOver'], fr['brightness'],
                                             ' '.join('%d:$%02X' % w for w in fades.get(f, []))))
    n_t = sum(1 for fr in r.frames if fr['frame'] >= start and fr['timeOver'])
    n_r = sum(1 for fr in r.frames if fr['frame'] >= start and fr['rangeOver'])
    print('%d frames: time over %d, range over %d, fades %d' % (end - start, n_t, n_r, len(fades)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--scenario', default='play1')
    ap.add_argument('--frames', help='comma-separated frame numbers (default %d)' % DEFAULT_FRAME)
    ap.add_argument('--title', action='store_true', help='the title without input: frames 300 and 700')
    ap.add_argument('--scan', metavar='FROM:TO', help='list the frames with sprite overflow or a fade')
    ap.add_argument('-o', default=os.path.join(PROJECT, 'build', 'screens'), help='directory for the records')
    ap.add_argument('--data', metavar='NAME', help='put the first frame into data/NAME (default for the plain runs)')
    a = ap.parse_args()
    if a.title:
        sc = scenario('attract')
        record(sc, [300, 700], a.o, a.data or 'screen_title.json')
        return
    sc = scenario(a.scenario)
    if a.scan:
        lo, hi = (int(x) for x in a.scan.split(':'))
        scan(sc, lo, hi)
        return
    frames = [int(x) for x in a.frames.split(',')] if a.frames else [DEFAULT_FRAME]
    data_name = a.data if a.data else ('screen.json' if not a.frames else None)
    record(sc, frames, a.o, data_name)


if __name__ == '__main__':
    main()
