#!/usr/bin/env python3
"""dumphdma — the HDMA tables of Super R-Type (US).

★ There are none. `HDMAEN $420C` is written once, at reset, with 0
(`hw_notes.md`, `ppu_state.md`: `dmaController.hdmaChannels` = 0 in the
title and in every section), the channel registers `$43x7`-`$43xA` are
never written at run time, and the only register the program changes
inside the picture is `INIDISP` (the brightness, `mkscreen.py`). The
scroll of BG1/BG2 is written once a frame in the NMI. So `data/hdma.json`
records the measurement, and the platform's `SNESHDMA` (`DESIGN-snes.md`
§2.4) waits for a game that needs it.

    ./tools/dumphdma.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)


def main():
    out = {
        '_comment': 'Super R-Type (USA): HDMA — none. $420C = 0 from reset on, no channel register written at run time '
                    '(tools/scanhw.py, tools/dumpppu.py, build/m2/collect DMA catalogue); tools/dumphdma.py.',
        'hdmaen': 0,
        'channels': [],
        'inPictureWrites': ['INIDISP'],
    }
    path = os.path.join(PROJECT, 'data', 'hdma.json')
    json.dump(out, open(path, 'w'), indent=1)
    print('%s: no HDMA' % os.path.relpath(path, PROJECT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
