#!/usr/bin/env python3
"""snesemu — headless MesenCE driven by a generated Lua script (SNES, M0).

The SNES counterpart of `svision/tools/retro/c64/c64emu.py`. First consumer
of the platform (R-050), so it lives in the project; the second consumer
moves it to `svision/tools/retro/snes/` (R-008).

★ MesenCE 2.2.1 (`~/opt/mesence/2.2.1/Mesen`, chosen by the operator
2026-10-18) has a test-runner mode: `Mesen --testRunner script.lua rom.sfc`
runs the script **without a window and without an X display**, at maximum
speed, and exits with the code the script passes to `emu.stop(code)`. Lua
has no `io`/`os` there, so everything travels back over stdout
(`--enableStdout`) as lines tagged `@…`, which this module parses.
Three things found while bringing it up (`../CLAUDE.md`, „Nástroje"):

- without `settings.json` next to the binary it opens the first-run wizard
  before the test runner and dies on the missing display — the file is
  there with `{}` (portable mode); the test runner never writes it;
- the script ends with `emu.stop(code)` — `emu.exit` from `--help` does
  not exist;
- with an empty configuration no controller is plugged in; the switch
  `--snes.port1.type=SnesController` plugs one in;
- a Lua callback may run 1 s, then the script is killed
  (`--debug.scriptWindow.scriptTimeout=60` raises it);
- RAM powers on **random** by default (`snes.ramPowerOnState=Random`), so
  two runs differ; the tool fixes it (`ram='AllZeros'`, or `AllOnes`) and
  `selftest` checks that two runs are byte for byte the same.

Units are the machine's, not seconds:

- **frame N** runs from line 0 to line 261: N is the PPU frame counter
  (`ppu.frameCount`) read at the start of line 0 (`startFrame`). ★ MesenCE
  increments that counter at the start of vblank (line 225), so lines
  225..261 of frame N read N+1 there — the tool keeps its own counter and
  never reads `ppu.frameCount` mid-frame. A capture "at frame N" is taken
  at the start of vblank (`endFrame`, line 225).
- **line L** of frame N is reached with the debugger's step
  `emu.step(L, specificScanline)` and captured on `codeBreak` at the start
  of the line, **whether the CPU runs or not** (it may sit in `WAI`); the
  capture records the line the PPU reports so that the two can be compared
  (`selftest`). In a trace the line is computed from the master clock
  since line 0 (1364 master clocks a line).
- ★ an NTSC frame is 357 368 master clocks, every other one 357 364
  (the short line) — measured 2026-10-18, `selftest` checks it.

    from snesemu import SnesEmu
    e = SnesEmu('sources/cart/Super R-Type (USA).sfc')
    e.press(300, 310, 'start')                   # buttons held on frames 300..309
    e.capture('title', frame=200, what=('wram', 'vram', 'cgram', 'oam', 'state'))
    e.capture('mid', frame=200, line=112, what=('state',))
    e.trace(400, 401, 'build/run/trace_400.txt')  # every CPU instruction
    e.count_pc(0x8286)                           # executions per frame
    r = e.run(frames=600)
    r.mem('title', 'vram'); r.state('title')['ppu.bgMode']; r.frames[-1]

Trace line (one per instruction, before it executes):
    frame line clock K:PC op b1 b2 b3 P A X Y S D DB E cycles
`op b1 b2 b3` are the four bytes at PC (read without side effects); the
length depends on M/X, which is why P travels with every line (the
disassembler takes widths from here, `dis65816.py`).

CLI:
    ./tools/snesemu.py --frames 600 --screenshot build/run/f600.ppm
    ./tools/snesemu.py --capture 200 --what wram,vram,cgram,oam,aram,dsp,state --out build/run
    ./tools/snesemu.py --capture 200:112 --what state
    ./tools/snesemu.py --trace 400:402 --out build/run
    ./tools/snesemu.py --press 300:310:start --frames 900 --screenshot build/run/game.ppm
    ./tools/snesemu.py --count-pc 8286 --frames 300        # per-frame log
    ./tools/snesemu.py selftest                             # acceptance M0
"""
import argparse, hashlib, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
ROM = os.path.join(PROJECT, 'sources', 'cart', 'Super R-Type (USA).sfc')
MESEN = os.environ.get('MESEN', os.path.expanduser('~/opt/mesence/2.2.1/Mesen'))

LINE_CLOCKS = 1364                       # master clocks per scanline
LINES_NTSC = 262
FRAME_CLOCKS_NTSC = (LINE_CLOCKS * LINES_NTSC, LINE_CLOCKS * LINES_NTSC - 4)   # ★ 357368 / 357364

# memory regions: name -> (Lua memType, size)
MEMORY = {
    'wram': ('snesWorkRam', 0x20000),
    # ★ the lower 12.5 KB only: the task pool, the game's variables, the OAM and CGRAM shadows
    # and the sprite groups ($0000-$31FF) — what tools/traceship.py records every frame (M3)
    'wramlo': ('snesWorkRam', 0x3200),
    'vram': ('snesVideoRam', 0x10000),
    'cgram': ('snesCgRam', 0x200),
    'oam': ('snesSpriteRam', 0x220),
    'aram': ('spcRam', 0x10000),
    'dsp': ('spcDspRegisters', 0x80),
    'rom': ('snesPrgRom', None),
}
BUTTONS = ('a', 'b', 'x', 'y', 'l', 'r', 'up', 'down', 'left', 'right', 'select', 'start')


class EmuError(RuntimeError):
    pass


class Result:
    def __init__(self, rc, log):
        self.rc, self.log = rc, log
        self.mems = {}          # (capture, kind) -> bytes
        self.states = {}        # capture -> {key: value}
        self.where = {}         # capture -> (frame, line asked, line by PPU, clock)
        self.frames = []        # one dict per frame (frame, clock, cycles, nmi, irq, polls, pc counts)
        self.screens = {}       # capture -> (width, height, [argb])
        self.trace_lines = 0
        self.io = {}            # (register, 'R'/'W', 24-bit PC) -> [count, first frame, last frame]
        self.access = {}        # (capture, 'wramR'|'wramW'|'romX'|'romR') -> {offset: count}
        self.reg_writes = {}    # register -> [(frame, line, clock in line, value)] from watch_reg
        self.exec_hits = {}     # name -> [(frame, line, A, X, Y, DB, D, values...)] from watch_exec
        self.dmas = []          # [{frame, line, ch, mode, dst, src, size, vaddr, vmain, cgadd}] from watch_dma

    def mem(self, capture, kind):
        return self.mems[(capture, kind)]

    def state(self, capture):
        return self.states[capture]


def _num(text):
    if text in ('true', 'false'):
        return text == 'true'
    try:
        return int(text)
    except ValueError:
        try:
            return float(text)
        except ValueError:
            return text


LUA_PRELUDE = r'''
local function hex(memType, size)
  local out, row = {}, {}
  for a = 0, size - 1 do
    row[#row + 1] = string.format("%02x", emu.read(a, memType))
    if #row == 64 then out[#out + 1] = table.concat(row); row = {} end
  end
  if #row > 0 then out[#out + 1] = table.concat(row) end
  return out
end
local function emitMem(name, kind, memType, size)
  if size == nil then size = emu.getMemorySize(memType) end
  local rows = hex(memType, size)
  print(string.format("@M %s %s %d", name, kind, size))
  for i = 1, #rows do print("@m " .. rows[i]) end
end
local function emitState(name)
  local s = emu.getState(); local ks = {}
  for k, v in pairs(s) do ks[#ks + 1] = k end
  table.sort(ks)
  for i = 1, #ks do print("@S " .. name .. " " .. ks[i] .. " " .. tostring(s[ks[i]])) end
end
local function emitCdl(name)
  local t = emu.getCdlData(emu.memType.snesPrgRom)
  local size = emu.getMemorySize(emu.memType.snesPrgRom)
  print(string.format("@M %s cdl %d", name, size))
  local row = {}
  for a = 0, size - 1 do
    row[#row + 1] = string.format("%02x", t[a])
    if #row == 64 then print("@m " .. table.concat(row)); row = {} end
  end
  if #row > 0 then print("@m " .. table.concat(row)) end
end
-- access counters since power-on, sparse: "@A name kind addr count"
local function emitAccess(name)
  local sets = {{"wramR", emu.memType.snesWorkRam, emu.counterType.readCount},
                {"wramW", emu.memType.snesWorkRam, emu.counterType.writeCount},
                {"romX", emu.memType.snesPrgRom, emu.counterType.execCount},
                {"romR", emu.memType.snesPrgRom, emu.counterType.readCount}}
  for i = 1, #sets do
    local s = sets[i]
    local t = emu.getAccessCounters(s[2], s[3])
    local size = emu.getMemorySize(s[2])
    for a = 0, size - 1 do
      local n = t[a]
      if n and n > 0 then print(string.format("@A %s %s %d %d", name, s[1], a, n)) end
    end
  end
end
local function emitScreen(name)
  local buf = emu.getScreenBuffer(); local size = emu.getScreenSize()
  print(string.format("@P %s %d %d", name, size.width, size.height))
  local row = {}
  for i = 1, #buf do
    row[#row + 1] = string.format("%06x", buf[i] & 0xFFFFFF)
    if #row == 64 then print("@p " .. table.concat(row)); row = {} end
  end
  if #row > 0 then print("@p " .. table.concat(row)) end
end
local function guard(fn)
  return function(...)
    local ok, err = pcall(fn, ...)
    if not ok then print("@E " .. tostring(err)); emu.stop(3) end
  end
end
local frameStart, curFrame, nmi, irq, polls = 0, 0, 0, 0, 0
local function lineNow() return (emu.getMasterClock() - frameStart) // %(LINE)d end
'''


LUA_EXEC = r'''emu.addMemoryCallback(guard(function()
  if curFrame < %d or curFrame >= %d then return end
  local cs = emu.getCpuState(emu.cpuType.snes)
  local W = emu.memType.snesWorkRam
  local function rw(a) return emu.read(a, W) | (emu.read(a + 1, W) << 8) end
  print(string.format("@X %s %%d %%d %%d %%d %%d %%d %%d%s", curFrame, lineNow(), cs.a, cs.x, cs.y, cs.dbr, cs.d%s))
end), emu.callbackType.exec, %d, %d, emu.cpuType.snes, emu.memType.snesMemory)'''

LUA_DMA = r'''local dmaShadow = {0, 0, 0, 0}
local function shadowCb(i)
  return guard(function(addr, value) dmaShadow[i] = value end)
end
for bank = 0, 0x0F do
  local regs = {0x2115, 0x2116, 0x2117, 0x2121}
  for i = 1, 4 do
    emu.addMemoryCallback(shadowCb(i), emu.callbackType.write, bank * 0x10000 + regs[i], bank * 0x10000 + regs[i], emu.cpuType.snes, emu.memType.snesMemory)
  end
  emu.addMemoryCallback(guard(function(addr, value)
    if curFrame < %d or curFrame >= %d then return end
    local R = emu.memType.snesMemory
    for ch = 0, 7 do
      if value & (1 << ch) ~= 0 then
        local b = 0x4300 + ch * 0x10
        print(string.format("@D %%d %%d %%d %%d %%d %%d %%d %%d %%d %%d", curFrame, lineNow(), ch, emu.read(b, R), emu.read(b + 1, R),
          emu.read(b + 2, R) | (emu.read(b + 3, R) << 8) | (emu.read(b + 4, R) << 16),
          emu.read(b + 5, R) | (emu.read(b + 6, R) << 8), dmaShadow[2] | (dmaShadow[3] << 8), dmaShadow[1], dmaShadow[4]))
      end
    end
  end), emu.callbackType.write, bank * 0x10000 + 0x420B, bank * 0x10000 + 0x420B, emu.cpuType.snes, emu.memType.snesMemory)
end'''


class SnesEmu:
    def __init__(self, rom=ROM, mesen=MESEN, controller=True, region='Ntsc', ram='AllZeros'):
        self.rom, self.mesen = rom, mesen
        # (a callback may run 1 s by default; dumping the 1 MB CDL takes longer)
        # ★ at full speed MesenCE skips the rendering of frames (`SnesPpu::_skipRender`:
        # faster than 150 % and less than 10 ms since the last drawn frame), so
        # `emu.getScreenBuffer()` would hand back an older picture — the switch turns it off
        self.switches = ['--snes.region=' + region, '--snes.ramPowerOnState=' + ram,
                         '--snes.disableFrameSkipping=true', '--debug.scriptWindow.scriptTimeout=60']
        if controller:
            self.switches.append('--snes.port1.type=SnesController')
        self.captures = []      # (name, frame, line, what)
        self.inputs = []        # (from, to, buttons)
        self.traces = []        # (from, to, path)
        self.pcs = []
        self.io_from = None
        self.pokes = []         # (from, to, WRAM offset, value)
        self.patches = []       # (ROM offset, value)
        self.reg_watches = []   # (register, from frame, to frame)
        self.exec_watches = []  # (address, name, reads, from frame, to frame)
        self.dma_watch = None   # (from frame, to frame)

    def capture(self, name, frame, line=None, what=('state',)):
        for w in what:
            if w not in MEMORY and w not in ('state', 'screen', 'cdl', 'access'):
                raise ValueError('unknown capture kind %r' % w)
        self.captures.append((name, frame, line, tuple(what)))

    def press(self, start, end, buttons):
        """Hold `buttons` (comma-separated names or a list) on frames start..end-1."""
        if isinstance(buttons, str):
            buttons = [b for b in buttons.split(',') if b]
        for b in buttons:
            if b not in BUTTONS:
                raise ValueError('unknown button %r' % b)
        self.inputs.append((start, end, tuple(buttons)))

    def trace(self, start, end, path):
        """Trace every CPU instruction of frames start..end-1 into `path`."""
        self.traces.append((start, end, path))

    def poke(self, addr, value, start=0, end=None):
        """Write `value` to WRAM `addr` ($7E:0000-$7F:FFFF, or a $0000-$1FFF
        mirror) at the start of every frame start..end-1 (end None = for
        good). A cheat: the state is no longer the original's, so it is fine
        for surveys (`dumpppu`), never for `trace*`/`match*`."""
        off = addr - 0x7E0000 if addr >= 0x7E0000 else addr & 0x1FFF
        self.pokes.append((start, 1 << 30 if end is None else end, off, value))

    def patch_rom(self, addr, value):
        """Change one ROM byte (LoROM CPU address) before the first frame — a cheat."""
        bank, a = (addr >> 16) & 0x7F, addr & 0xFFFF
        self.patches.append(((bank << 15) | (a & 0x7FFF), value))

    def watch_io(self, start=0):
        """Log every CPU-bus access to the I/O registers ($2100-$21FF, $4016-$4017,
        $4200-$421F, $4300-$437F) in all register mirrors (banks $00-$3F, $80-$BF)
        from frame `start` on: `Result.io[(reg, 'R'/'W', pc)] = [count, first, last]`.
        ★ The PC is the CPU's at the moment of the access, which MesenCE has
        already advanced past the operand — `LDA $4218` at `$00:83E8` reports
        `$00:83EB`; a DMA transfer reports the instruction after the write to
        `$420B` (`scanhw.py` resolves the start). Costs ~20 ms a frame."""
        self.io_from = start

    def watch_reg(self, reg, start=0, end=None):
        """Log every CPU write to one register ($21xx/$42xx, all mirror banks) on
        frames start..end-1 with its frame, scanline and master clock within the
        line: `Result.reg_writes[reg] = [(frame, line, clock, value), …]`. ★ The
        line is Mesen's scanline (0 = the first of the frame, the picture is
        1-224); the clock within the line is 0-1363 and the PPU has drawn the
        pixels up to `(clock >> 2) - 22` of that line when the write lands
        (`SnesPpu::GetCycle`, `RenderScanline`) — `mkscreen.py` turns it into
        the picture row and x of a brightness split."""
        self.reg_watches.append((reg & 0xFFFF, start, 1 << 30 if end is None else end))

    def watch_exec(self, addr, name, reads=(), start=0, end=None, clock=False):
        """Log every execution of the 24-bit address `addr` on frames start..end-1
        as `Result.exec_hits[name] = [(frame, line, A, X, Y, DB, D, values...)]`;
        `reads` names 16-bit words of WRAM to read at that moment: ('X', off) /
        ('Y', off) = the word at X+off / Y+off in bank $7E, ('abs', a) = at
        $7E:a, ('dp', a) = at D+a. The hook fires **before** the instruction
        (`emu.callbackType.exec`), so the registers are the routine's arguments
        — how `dump*` learns which record the original fetched (M2). With
        `clock=True` the master clock within the frame (0-357 367, from line 0)
        follows the values — how `tools/traceship.py` times the passes of the
        main loop, the NMI and every task for the lag model (M3)."""
        self.exec_watches.append((addr, name, tuple(reads), start, 1 << 30 if end is None else end, clock))

    def watch_dma(self, start=0, end=None):
        """Log every general DMA the program starts (`MDMAEN $420B`) on frames
        start..end-1 with the channel's parameters read back from `$43x0`-`$43x6`
        and the VRAM / CGRAM address the program set last (shadows of `$2115`-
        `$2117`, `$2121`): `Result.dmas`. The OAM / CGRAM transfers of every
        frame are included; the caller filters. Callbacks sit on banks $00-$0F
        only — the program writes registers with DB in that range or long."""
        self.dma_watch = (start, 1 << 30 if end is None else end)

    def count_pc(self, *addrs):
        """Count executions of 24-bit addresses per frame (`Result.frames[i]['pc']`)."""
        self.pcs.extend(addrs)

    # -- script --------------------------------------------------------------

    def script(self, frames):
        L = [LUA_PRELUDE.replace('%(LINE)d', str(LINE_CLOCKS))]
        L.append('local LAST = %d' % frames)
        # input: applied on every poll of the frame
        L.append('local inputs = {')
        for s, e, bs in self.inputs:
            L.append('  {%d, %d, {%s}},' % (s, e, ', '.join('%s = true' % b for b in bs)))
        L.append('}')
        L.append('''emu.addEventCallback(guard(function()
  polls = polls + 1
  local f = curFrame
  for i = 1, #inputs do
    local s = inputs[i]
    if f >= s[1] and f < s[2] then emu.setInput(s[3], 0) end
  end
end), emu.eventType.inputPolled)
emu.addEventCallback(guard(function() nmi = nmi + 1 end), emu.eventType.nmi)
emu.addEventCallback(guard(function() irq = irq + 1 end), emu.eventType.irq)''')
        # I/O watch: one callback per mirror bank and kind over $2100-$437F,
        # filtered here (fewer callbacks = less work on every bus access)
        if self.io_from is not None:
            L.append('local IO_FROM, io = %d, {}' % self.io_from)
            L.append('''local function ioCb(kind)
  return guard(function(addr, value)
    if curFrame < IO_FROM then return end
    local a = addr & 0xFFFF
    if a > 0x21FF and (a < 0x4016 or (a > 0x4017 and a < 0x4200) or (a > 0x421F and a < 0x4300)) then return end
    local cs = emu.getCpuState(emu.cpuType.snes)
    local key = string.format("%04X %s %02X%04X", a, kind, cs.k, cs.pc)
    local e = io[key]
    if e then e[1] = e[1] + 1; e[3] = curFrame else io[key] = {1, curFrame, curFrame} end
  end)
end
local ioR, ioW = ioCb("R"), ioCb("W")
for bank = 0, 0xBF do
  if bank < 0x40 or bank >= 0x80 then
    emu.addMemoryCallback(ioR, emu.callbackType.read, bank * 0x10000 + 0x2100, bank * 0x10000 + 0x437F, emu.cpuType.snes, emu.memType.snesMemory)
    emu.addMemoryCallback(ioW, emu.callbackType.write, bank * 0x10000 + 0x2100, bank * 0x10000 + 0x437F, emu.cpuType.snes, emu.memType.snesMemory)
  end
end
local function emitIo()
  for k, e in pairs(io) do print(string.format("@W %s %d %d %d", k, e[1], e[2], e[3])) end
end''')
        else:
            L.append('local function emitIo() end')
        # register write watches: one callback per mirror bank and register
        L.append('local regWatches = {%s}' % ', '.join('{%d, %d, %d}' % w for w in self.reg_watches))
        L.append('''for i = 1, #regWatches do
  local rw = regWatches[i]
  local cb = guard(function(addr, value)
    if curFrame < rw[2] or curFrame >= rw[3] then return end
    local off = emu.getMasterClock() - frameStart
    print(string.format("@R %d %d %d %d %d", rw[1], curFrame, off // %(LINE)d, off % %(LINE)d, value))
  end)
  for bank = 0, 0xBF do
    if bank < 0x40 or bank >= 0x80 then
      emu.addMemoryCallback(cb, emu.callbackType.write, bank * 0x10000 + rw[1], bank * 0x10000 + rw[1], emu.cpuType.snes, emu.memType.snesMemory)
    end
  end
end'''.replace('%(LINE)d', str(LINE_CLOCKS)))
        # exec watches: one callback per address, the reads as Lua expressions
        for addr, name, reads, s, e_, clock in self.exec_watches:
            exprs = []
            for kind, off in reads:
                if kind == 'X':
                    exprs.append('rw((cs.x + %d) & 0xFFFF)' % off)
                elif kind == 'Y':
                    exprs.append('rw((cs.y + %d) & 0xFFFF)' % off)
                elif kind == 'dp':
                    exprs.append('rw((cs.d + %d) & 0xFFFF)' % off)
                else:
                    exprs.append('rw(%d)' % off)
            if clock:
                exprs.append('emu.getMasterClock() - frameStart')
            L.append(LUA_EXEC % (s, e_, name, ' %d' * len(exprs), ''.join(', ' + x for x in exprs), addr, addr))
        if self.dma_watch:
            L.append(LUA_DMA % self.dma_watch)
        # cheats: ROM patches once, WRAM pokes at the start of every frame
        L.append('local patches = {%s}' % ', '.join('{%d, %d}' % p for p in self.patches))
        L.append('local pokes = {%s}' % ', '.join('{%d, %d, %d, %d}' % p for p in self.pokes))
        L.append('''for i = 1, #patches do emu.write(patches[i][1], patches[i][2], emu.memType.snesPrgRom) end
local function applyPokes(f)
  for i = 1, #pokes do
    local p = pokes[i]
    if f >= p[1] and f < p[2] then emu.write(p[3], p[4], emu.memType.snesWorkRam) end
  end
end''')
        # per-PC counters
        L.append('local pcs, pcCount = {%s}, {}' % ', '.join(str(a) for a in self.pcs))
        L.append('for i = 1, #pcs do pcCount[i] = 0 end')
        for i, a in enumerate(self.pcs):
            L.append('emu.addMemoryCallback(guard(function() pcCount[%d] = pcCount[%d] + 1 end), '
                     'emu.callbackType.exec, %d, %d, emu.cpuType.snes, emu.memType.snesMemory)'
                     % (i + 1, i + 1, a, a))
        # captures
        def what_lua(name, what):
            out = []
            for w in what:
                if w == 'state':
                    out.append('emitState("%s")' % name)
                elif w == 'screen':
                    out.append('emitScreen("%s")' % name)
                elif w == 'cdl':
                    out.append('emitCdl("%s")' % name)
                elif w == 'access':
                    out.append('emitAccess("%s")' % name)
                else:
                    mt, size = MEMORY[w]
                    out.append('emitMem("%s", "%s", emu.memType.%s, %s)'
                               % (name, w, mt, 'nil' if size is None else size))
            return '\n      '.join(out)
        vblank = [c for c in self.captures if c[2] is None]
        lined = [c for c in self.captures if c[2] is not None]
        # line captures: the debugger steps to the line and breaks there
        L.append('local lineCaps = {')
        for name, f, line, what in sorted(lined, key=lambda c: (c[1], c[2])):
            L.append('  {%d, %d, "%s", function()\n      %s\n    end},'
                     % (f, line, name, what_lua(name, what)))
        L.append('}')
        L.append('''local nextCap = 1
local function capLine(c)
  print(string.format("@C %s %d %d %d %d", c[3], curFrame, c[2], emu.getState()["ppu.scanline"], emu.getMasterClock()))
  c[4]()
end
-- step to the next line capture of this frame, or let the emulation run
local function stepOn()
  while nextCap <= #lineCaps and lineCaps[nextCap][1] == curFrame do
    local c = lineCaps[nextCap]
    if c[2] > 0 then emu.step(c[2], emu.stepType.specificScanline); return true end
    capLine(c); nextCap = nextCap + 1
  end
  return false
end
emu.addEventCallback(guard(function()
  local c = lineCaps[nextCap]
  if c and c[1] == curFrame then
    capLine(c); nextCap = nextCap + 1
    if stepOn() then return end
  end
  emu.resume()
end), emu.eventType.codeBreak)''')
        # traces need an exec callback over the whole bus, only while tracing
        L.append('local traces = {%s}' % ', '.join('{%d, %d}' % (s, e) for s, e, _ in self.traces))
        L.append('''local execRef = nil
local function tracing(f)
  for i = 1, #traces do if f >= traces[i][1] and f < traces[i][2] then return i end end
  return nil
end
local onExec = guard(function(addr, value)
  local t = tracing(curFrame)
  if t then
    local cs = emu.getCpuState(emu.cpuType.snes)
    local D = emu.memType.snesDebug
    print(string.format("@T %d %d %d %d %02X:%04X %02x %02x %02x %02x %02x %04x %04x %04x %04x %04x %02x %d %d",
      t, curFrame, lineNow(), emu.getMasterClock(), cs.k, cs.pc,
      emu.read(addr, D), emu.read((addr + 1) & 0xFFFFFF, D), emu.read((addr + 2) & 0xFFFFFF, D),
      emu.read((addr + 3) & 0xFFFFFF, D),
      cs.ps, cs.a, cs.x, cs.y, cs.sp, cs.d, cs.dbr, cs.emulationMode and 1 or 0, cs.cycleCount))
  end
end)''')
        L.append('''emu.addEventCallback(guard(function()
  frameStart = emu.getMasterClock()
  curFrame = emu.getState()["ppu.frameCount"]
  if tracing(curFrame) then
    if not execRef then
      execRef = emu.addMemoryCallback(onExec, emu.callbackType.exec, 0, 0xFFFFFF, emu.cpuType.snes, emu.memType.snesMemory)
    end
  elseif execRef then
    emu.removeMemoryCallback(execRef, emu.callbackType.exec, 0, 0xFFFFFF, emu.cpuType.snes, emu.memType.snesMemory)
    execRef = nil
  end
  applyPokes(curFrame)
  while nextCap <= #lineCaps and lineCaps[nextCap][1] < curFrame do nextCap = nextCap + 1 end
  stepOn()
end), emu.eventType.startFrame)''')
        L.append('local vblankCaps = {')
        for name, f, _, what in vblank:
            L.append('  {%d, "%s", function()\n      %s\n    end},' % (f, name, what_lua(name, what)))
        L.append('}')
        L.append('''emu.addEventCallback(guard(function()
  local f = curFrame
  local cs = emu.getCpuState(emu.cpuType.snes)
  local counts = {}
  for i = 1, #pcs do counts[i] = tostring(pcCount[i]); pcCount[i] = 0 end
  local ps = emu.getState()
  print(string.format("@F %d %d %d %d %d %d %d %s %d %d %d", f, frameStart, emu.getMasterClock(), cs.cycleCount, nmi, irq, polls,
    table.concat(counts, ","), ps["ppu.timeOver"] and 1 or 0, ps["ppu.rangeOver"] and 1 or 0, ps["ppu.screenBrightness"]))
  nmi, irq, polls = 0, 0, 0
  for i = 1, #vblankCaps do
    local c = vblankCaps[i]
    if c[1] == f then
      print(string.format("@C %s %d -1 %d %d", c[2], f, emu.getState()["ppu.scanline"], emu.getMasterClock()))
      c[3]()
    end
  end
  if f >= LAST then emitIo(); print("@END " .. f); emu.stop(0) end
end), emu.eventType.endFrame)''')
        return '\n'.join(L) + '\n'

    # -- run -----------------------------------------------------------------

    def run(self, frames, workdir=None, timeout=None, keep_script=None):
        last = max([frames] + [c[1] for c in self.captures] + [e for _, e, _ in self.traces])
        if not os.path.exists(self.mesen):
            raise EmuError('MesenCE not found at %s (MESEN=…)' % self.mesen)
        if not os.path.exists(os.path.join(os.path.dirname(self.mesen), 'settings.json')):
            raise EmuError('settings.json missing next to %s — without it MesenCE opens the '
                           'first-run wizard and dies without a display' % self.mesen)
        # MesenCE keeps the code/data log in Debugger/<rom>.cdl and loads it on
        # start; a run must not inherit what an earlier one executed
        cdl = os.path.join(os.path.dirname(self.mesen), 'Debugger',
                           os.path.splitext(os.path.basename(self.rom))[0] + '.cdl')
        if os.path.exists(cdl):
            os.remove(cdl)
        workdir = workdir or os.path.join(PROJECT, 'build', 'run')
        os.makedirs(workdir, exist_ok=True)
        lua = keep_script or os.path.join(workdir, 'snesemu.lua')
        with open(lua, 'w') as f:
            f.write(self.script(last))
        # the test runner's timeout is wall-clock seconds; ~0.6 s per 100 frames untraced
        secs = timeout or max(30, int(last / 60) + 30 + 20 * sum(e - s for s, e, _ in self.traces))
        cmd = [self.mesen, '--testRunner', '--enableStdout', '--timeout=%d' % secs] + self.switches + \
              [os.path.abspath(lua), os.path.abspath(self.rom)]
        res = Result(None, [])
        tfiles = [open(p, 'w') for _, _, p in self.traces]
        for fh, (s, e, _) in zip(tfiles, self.traces):
            fh.write('# frames %d..%d  frame line clock K:PC op b1 b2 b3 P A X Y S D DB E cycles\n' % (s, e - 1))
        # (the ROM header MesenCE prints first has non-UTF-8 bytes in „Game code")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                errors='replace', cwd=os.path.dirname(self.mesen))
        cur = None
        try:
            for raw in proc.stdout:
                line = raw.rstrip('\n')
                if line.startswith('@T '):
                    p = line.split(' ', 2)
                    tfiles[int(p[1]) - 1].write(p[2] + '\n')
                    res.trace_lines += 1
                elif line.startswith('@m '):
                    cur[1].append(line[3:])
                elif line.startswith('@p '):
                    cur[1].append(line[3:])
                elif line.startswith('@S '):
                    _, name, key, val = (line.split(' ', 3) + [''])[:4]
                    res.states.setdefault(name, {})[key] = _num(val)
                elif line.startswith('@M '):
                    self._flush(res, cur)
                    _, name, kind, size = line.split()
                    cur = (('M', name, kind, int(size)), [])
                elif line.startswith('@P '):
                    self._flush(res, cur)
                    _, name, w, h = line.split()
                    cur = (('P', name, int(w), int(h)), [])
                elif line.startswith('@F '):
                    p = line.split(' ')
                    pcs = [int(x) for x in p[8].split(',')] if len(p) > 8 and p[8] else []
                    res.frames.append({'frame': int(p[1]), 'start': int(p[2]), 'clock': int(p[3]),
                                       'cycles': int(p[4]), 'nmi': int(p[5]), 'irq': int(p[6]),
                                       'polls': int(p[7]), 'pc': pcs,
                                       'timeOver': len(p) > 9 and p[9] == '1',
                                       'rangeOver': len(p) > 10 and p[10] == '1',
                                       'brightness': int(p[11]) if len(p) > 11 else None})
                elif line.startswith('@X '):
                    p = line.split()
                    res.exec_hits.setdefault(p[1], []).append(tuple(int(x) for x in p[2:]))
                elif line.startswith('@D '):
                    p = [int(x) for x in line.split()[1:]]
                    res.dmas.append(dict(zip(('frame', 'line', 'ch', 'mode', 'dst', 'src', 'size', 'vaddr', 'vmain', 'cgadd'), p)))
                    res.dmas[-1]['dst'] |= 0x2100
                elif line.startswith('@R '):
                    _, reg, f, ln, clk, val = line.split()
                    res.reg_writes.setdefault(int(reg), []).append((int(f), int(ln), int(clk), int(val)))
                elif line.startswith('@C '):
                    _, name, f, asked, ppu, clock = line.split()
                    res.where[name] = (int(f), None if asked == '-1' else int(asked), int(ppu), int(clock))
                elif line.startswith('@A '):
                    _, name, kind, addr, n = line.split()
                    res.access.setdefault((name, kind), {})[int(addr)] = int(n)
                elif line.startswith('@W '):
                    _, reg, kind, pc, n, first, last = line.split()
                    res.io[(int(reg, 16), kind, int(pc, 16))] = [int(n), int(first), int(last)]
                elif line.startswith('@E '):
                    res.log.append(line)
                elif not line.startswith('@'):
                    res.log.append(line)
            self._flush(res, cur)
            res.rc = proc.wait()
        finally:
            for fh in tfiles:
                fh.close()
        if res.rc != 0:
            raise EmuError('MesenCE exit %s%s' % (res.rc, ''.join(
                '\n  ' + l for l in res.log if l.startswith('@E')) or
                (' (timeout %d s?)' % secs if res.rc in (255, -1) else '')))
        return res

    @staticmethod
    def _flush(res, cur):
        if cur is None:
            return
        head, rows = cur
        if head[0] == 'M':
            _, name, kind, size = head
            data = bytes.fromhex(''.join(rows))
            if len(data) != size:
                raise EmuError('%s/%s: %d B instead of %d' % (name, kind, len(data), size))
            res.mems[(name, kind)] = data
        else:
            _, name, w, h = head
            hexs = ''.join(rows)
            res.screens[name] = (w, h, [int(hexs[i:i + 6], 16) for i in range(0, len(hexs), 6)])


def save_ppm(path, screen):
    w, h, px = screen
    with open(path, 'wb') as f:
        f.write(b'P6 %d %d 255\n' % (w, h))
        f.write(bytes(b for p in px for b in ((p >> 16) & 255, (p >> 8) & 255, p & 255)))


# -- selftest ------------------------------------------------------------------

def selftest(rom):
    """Acceptance M0: frame counter +100 per 100 steps, line ±0, frame length constant."""
    ok = True
    e = SnesEmu(rom)
    lines = (0, 1, 2, 100, 112, 223, 224, 225, 239, 240, 241, 261)
    for i, line in enumerate(lines):
        e.capture('L%d' % line, frame=150 + i, line=line, what=('state',))
    e.capture('a', frame=400, what=('wram', 'vram', 'cgram', 'oam', 'aram'))
    r = e.run(frames=400)

    steps = [f for f in r.frames if 100 <= f['frame'] < 200]
    inc = [b['frame'] - a['frame'] for a, b in zip(steps, steps[1:])]
    good = len(steps) == 100 and set(inc) == {1} and steps[-1]['frame'] - steps[0]['frame'] == 99
    print('krok = snímek: %d kroků, počítadlo %d → %d (+%d) — %s' % (
        len(steps), steps[0]['frame'], steps[-1]['frame'], steps[-1]['frame'] - steps[0]['frame'] + 1,
        'sedí' if good else '*** NESEDÍ ***'))
    ok &= good

    worst = 0
    for line in lines:
        f, asked, ppu, _ = r.where['L%d' % line]
        worst = max(worst, abs(ppu - asked))
        if ppu != asked:
            print('  řádek %d: PPU hlásí %d' % (asked, ppu))
    print('krok = řádek: %d řádků (%s), největší odchylka ±%d — %s' % (
        len(lines), ', '.join(map(str, lines)), worst, 'sedí' if worst == 0 else '*** NESEDÍ ***'))
    ok &= worst == 0

    deltas = [b['start'] - a['start'] for a, b in zip(r.frames, r.frames[1:])]
    hist = {d: deltas.count(d) for d in sorted(set(deltas))}
    alt = all(deltas[i] != deltas[i + 1] for i in range(len(deltas) - 1))
    good = set(hist) <= set(FRAME_CLOCKS_NTSC) and alt
    print('takty na snímek: %s, střídavě %s — %s' % (
        ', '.join('%d × %d' % (d, c) for d, c in hist.items()), 'ano' if alt else 'ne',
        'konstanta stroje (NTSC 262 × 1364, krátký řádek −4)' if good else '*** NESEDÍ ***'))
    ok &= good

    e2 = SnesEmu(rom)
    e2.capture('a', frame=400, what=('wram', 'vram', 'cgram', 'oam', 'aram'))
    r2 = e2.run(frames=400)
    same = all(r.mem('a', k) == r2.mem('a', k) for k in ('wram', 'vram', 'cgram', 'oam', 'aram'))
    digest = hashlib.sha1(b''.join(r.mem('a', k) for k in ('wram', 'vram', 'cgram', 'oam', 'aram'))).hexdigest()
    print('determinismus: dva běhy, snímek 400, WRAM+VRAM+CGRAM+OAM+ARAM — %s (SHA-1 %s)' % (
        'shodné' if same else '*** LIŠÍ SE ***', digest[:16]))
    ok &= same

    # informativní, ne akceptace: záleží hře na obsahu RAM po zapnutí?
    e3 = SnesEmu(rom, ram='AllOnes')
    e3.capture('a', frame=400, what=('wram', 'vram', 'cgram', 'oam', 'aram'))
    r3 = e3.run(frames=400)
    diff = {k: sum(1 for x, y in zip(r.mem('a', k), r3.mem('a', k)) if x != y)
            for k in ('wram', 'vram', 'cgram', 'oam', 'aram')}
    print('RAM po zapnutí AllZeros × AllOnes, snímek 400: %s B rozdílů (%s)' % (
        sum(diff.values()), ', '.join('%s %d' % kv for kv in diff.items())))
    print('\nselftest: %s' % ('0 rozdílů' if ok else '*** ROZDÍLY ***'))
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('command', nargs='?', choices=('run', 'selftest'), default='run')
    ap.add_argument('--rom', default=ROM)
    ap.add_argument('--frames', type=int, default=0, help='run until this frame')
    ap.add_argument('--capture', action='append', default=[], help='FRAME or FRAME:LINE')
    ap.add_argument('--what', default='state', help='wram,vram,cgram,oam,aram,dsp,rom,state,screen')
    ap.add_argument('--trace', action='append', default=[], help='FROM:TO (frames, TO exclusive)')
    ap.add_argument('--press', action='append', default=[], help='FROM:TO:button[,button]')
    ap.add_argument('--count-pc', action='append', default=[], help='hex address (bank:addr or 24-bit)')
    ap.add_argument('--screenshot', help='PPM of the screen at the last frame')
    ap.add_argument('--out', default=os.path.join(PROJECT, 'build', 'run'))
    a = ap.parse_args()

    if a.command == 'selftest':
        return selftest(a.rom)

    e = SnesEmu(a.rom)
    what = [w for w in a.what.split(',') if w]
    for c in a.capture:
        f, _, line = c.partition(':')
        e.capture('f%s' % c.replace(':', 'l'), int(f), int(line) if line else None, what)
    for t in a.trace:
        s, e_ = (int(x) for x in t.split(':'))
        e.trace(s, e_, os.path.join(a.out, 'trace_%d_%d.txt' % (s, e_)))
    for p in a.press:
        s, e_, bs = p.split(':', 2)
        e.press(int(s), int(e_), bs)
    for pc in a.count_pc:
        e.count_pc(int(pc.replace(':', ''), 16))
    if a.screenshot:
        e.capture('screenshot', a.frames, None, ('screen',))
    r = e.run(frames=a.frames, workdir=a.out)

    for (name, kind), data in sorted(r.mems.items()):
        path = os.path.join(a.out, '%s_%s.bin' % (name, kind))
        open(path, 'wb').write(data)
        print('%s  %6d B  %s' % (path, len(data), hashlib.sha1(data).hexdigest()[:16]))
    for name, st in sorted(r.states.items()):
        path = os.path.join(a.out, '%s_state.txt' % name)
        with open(path, 'w') as fh:
            fh.writelines('%s %s\n' % kv for kv in sorted(st.items()))
        print('%s  %d klíčů' % (path, len(st)))
    for name, (f, asked, ppu, clock) in sorted(r.where.items()):
        print('  %s: snímek %d, %s, PPU řádek %d, takt %d' % (
            name, f, 'vblank' if asked is None else 'řádek %d' % asked, ppu, clock))
    for name, screen in sorted(r.screens.items()):
        path = a.screenshot if name == 'screenshot' else os.path.join(a.out, '%s_screen.ppm' % name)
        save_ppm(path, screen)
        print('%s  %d × %d' % (path, screen[0], screen[1]))
    for _, _, p in e.traces:
        print('%s' % p)
    if r.trace_lines:
        print('  trace: %d instrukcí' % r.trace_lines)
    if a.count_pc or not (a.capture or a.trace or a.screenshot):
        for fr in r.frames[-20:]:
            print('  snímek %5d  takt %10d  cyklů %9d  NMI %d IRQ %d čtení vstupu %d%s' % (
                fr['frame'], fr['start'], fr['cycles'], fr['nmi'], fr['irq'], fr['polls'],
                ('  PC ' + ' '.join(map(str, fr['pc']))) if fr['pc'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
