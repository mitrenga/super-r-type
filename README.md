SUPER R-TYPE (SNES) — remake
============================

**Internal project until the operator decides otherwise.** Super R-Type is
© Irem 1991 (Super Nintendo Entertainment System); the R-Type trademark is
alive and actively held. This remake is not published, distributed or
deployed anywhere public. It exists to be the **first consumer of a Super
Nintendo platform** in the **svision** library (R-050, `../DESIGN-snes.md`:
the PPU over VRAM/CGRAM/OAM, the brightness inside the frame as data, the
S-DSP and SPC700 to come) and to carry the `dump*` → `trace*` → `match*`
method onto the 65C816.

Not to be confused with `../r-type` (R-Type for the Commodore 64). The
reference is the **SNES cartridge program**, not the Irem arcade games
(*R-Type*, *R-Type II*); the arcades, their MAME drivers and the other
ports are second-hand sources only. The famous slowdown of the original
is part of its timing and is reproduced, not fixed.

**Status: M0-M3 done (2026-10-18).** The US cartridge is traced in
MesenCE under a script, disassembled with instruction widths out of the
run, its main loop, slowdown, sprites, scroll and sound mapped
(`sources/docs/`). The platform's first step is in svision
(`svision/js/platform/canvas2D/snes/`). The cartridge's data are read out
(`data/*.json`, M2) and **the game plays by the original's code** (M3):
the task scheduler, the level manager, the ship, its shot, beam and
wave, the Force, the bits, the five lasers, the missiles, the terrain
collision, death and restart — without enemies (M4) — and **the lag
frames** are modelled by a budget in master clocks fitted from the
original's own timing. Every byte of the game's memory is matched frame
by frame against recordings of the running original (`matchship.mjs`,
0 differences in all seven levels). See `ZADANI.md` (what the game is,
what ★ is measured and what ? is still hearsay), `MILNIKY.md`
(milestones with `match*` acceptance) and `sources/README.md`.

## Running it

Like every svision project: `config/config.php` out of
`config/config.php.sample` (`$devMode = true`), serve the directory with
nginx + PHP; the browser loads `app/` directly, nothing is built. The data
the application needs are `data/screen.json` and `data/screen_title.json`
(in git; `tools/mkscreen.py` makes them again from the emulator).

What it shows: the menu on the original's title picture — START GAME,
LEVEL (NOVICE/EASY/NORMAL/HARD) and SOUND (STEREO/NORMAL) as the original's
SELECT SCENE has them, SETTINGS, ABOUT GAME (the sections scrolling) —
and the game from the first section of level 1: the ship flies, shoots,
charges the beam, docks the Force and fires its lasers, dies on the
terrain and restarts, with the original's lag frames; the enemies come
with M4. The data the browser needs are `data/screen*.json`, `levels`,
`tiles`, `palettes`, `ship`, `sprites` and `waves` (`db/appData.php`
serves them). Keyboard, gamepad and touch controls make the pad's word;
Escape pauses.

## Developer parameters

In dev mode only (`$devMode` in `config/config.php`; R-058, `Tool.devParam`):
`?devSeed=N` pins the seed of the game's randomness so a run can be
repeated. The same knob goes into the configuration as
`$devMode = ['seed' => 123]`; the address wins. On a production server the
parameter does not exist.

## Tools

All under `tools/`, run from the project root; the emulator is MesenCE
2.2.1 in `~/opt/mesence/2.2.1/` (`MESEN=` overrides).

| tool | what it does |
|---|---|
| `snesemu.py` | MesenCE under a generated Lua script: frames and scanlines, captures of WRAM/VRAM/CGRAM/OAM/ARAM/state/screen, CPU trace with M/X, input, pokes, register watches; `selftest` |
| `matchcart.py` | the dumps against No-Intro, the header and its checksum, the regions' differences |
| `scanhw.py`, `dumpppu.py` | what the program touches of the hardware, the PPU state per scene and scanline |
| `dis65816.py`, `op65816.py`, `runcoverage.py` | the disassembly with widths from the CDL of 13 scenarios → `sources/asm/` |
| `disspc700.py` | the sound driver's map → `sources/asm/spc/` |
| `tracelag.py` | the lag frames per scenario |
| `mkscreen.py` | one frame of the original as data (registers, memory, brightness writes) plus the emulator's picture → `data/screen*.json`, `build/screens/`, `build/ref/` |
| `matchscreen.mjs` | the library's picture of those frames against the emulator's, pixel by pixel — **the acceptance of M1** |
| `dumplevels.py`, `dumptiles.py`, `dumppalettes.py`, `dumpsprites.py`, `dumpwaves.py`, `dumptexts.py`, `dumpglobal.py`, `dumphdma.py`, `srtlib.py` | the cartridge's data → `data/*.json` (M2) |
| `tracelevels.py`, `tracesprites.py`, `matchlevels.mjs`, `matchtiles.mjs`, `matchsprites.mjs`, `matchtexts.mjs`, `matchunpack.mjs` | the sections, tiles, sprites and texts against the running original (M2) |
| `sdis65816.py` | a static reading of a ROM range no run covered (widths from REP / SEP) |
| `dumpship.py` | bank $04 (the game code's tables) and bank $06 (object scripts) → `data/ship.json` (M3) |
| `traceship.py` | recordings of the game in the emulator: WRAM every frame, the lag flag, STAT77, the joypad word and the clocks of every task → `build/m3/ship/` |
| `matchship.mjs` | the game's memory, the layers and the lag model against those recordings, byte by byte — **the acceptance of M3** |
| `measurebudget.mjs` | the fit of the lag model's costs from the recordings' timing (`--emit` prints `app/frameBudget.js`'s tables) |
| `runworker.mjs` | the worker's protocol without a browser (M1-M3) |

The platform itself is checked by `node ../svision/tools/checksnes.mjs`;
its sandbox is `../snesdemo`.

The cartridge dumps are copyrighted and are **not** part of this
directory; see `sources/README.md`.
