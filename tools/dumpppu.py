#!/usr/bin/env python3
"""dumpppu — registry PPU a HDMA po snímcích a po řádcích ve scénách hry.

Krok M0 (`MILNIKY.md`): z běžícího originálu (`snesemu.py`) vytáhne stav
PPU v tolika scénách, aby z něj šel určit **rozsah kroku 1 platformy**
(R-050): režim, vrstvy, adresy map a dlaždic, scroll, sprajty, okna,
barevná matematika, mozaika, Mode 7 a **HDMA rozepsané po řádcích**.

Scény: titulka a pak každá hodnota `$7E:16E5` (? číslo úrovně / úseku —
`$01:844D` podle ní vybírá hudbu z `$04:8A3F`) nastavená **cheatem** před
startem hry, s nekonečnými životy a nesmrtelností z druhé ruky
(`CHEATS`). Cheat mění stav hry, takže tohle je průzkum, ne `trace*`.

V každé scéně se na vybraných snímcích zachytí:

- stav ve vblanku (řádek 225) a **WRAM** (tabulky HDMA bývají v ní);
- stav na řádcích `LINES` — co se mezi řádky téhož snímku liší, mění
  za běhu snímku HDMA nebo kód (rastrový efekt);
- tabulky aktivních kanálů HDMA (`$420C`) rozepsané na
  `{řádek, registr, hodnoty}` z ROM a WRAM (Fullsnes, „HDMA").

    ./tools/dumpppu.py                     # všechny scény → sources/docs/ppu_state.md
    ./tools/dumpppu.py --scenes 0,5        # jen některé hodnoty $16E5

Surová data: `build/ppu/<scéna>_<snímek>.json`.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from snesemu import SnesEmu, ROM, PROJECT
from scanhw import START_TAPS, reg_name

STAGE = 0x7E16E5
# ? kódy z druhé ruky (almarsguides.com, Pro Action Replay pro US verzi),
# ověřené jen tím, že životy drží a loď přežívá (2026-10-18)
CHEATS = {'životy': (0x7E16E1, 9), 'nesmrtelnost': (0x7E158F, 0)}
CHEAT_ROM = [(0x01A957, 0x80)]
FRAMES = (3000, 3300, 3600, 4000, 4400, 4800, 5400, 6000)
TITLE_FRAMES = (300, 700)
LINES = (0, 16, 48, 96, 144, 192, 223)

# klíče stavu, které popisují obraz (ne vnitřní latche a čítače)
KEYS = ['ppu.bgMode', 'ppu.mode1Bg3Priority', 'ppu.mainScreenLayers', 'ppu.subScreenLayers',
        'ppu.screenBrightness', 'ppu.forcedBlank', 'ppu.mosaicEnabled', 'ppu.mosaicSize',
        'ppu.oamMode', 'ppu.oamBaseAddress', 'ppu.oamAddressOffset', 'ppu.enableOamPriority',
        'ppu.colorMathEnabled', 'ppu.colorMathAddSubscreen', 'ppu.colorMathSubtractMode',
        'ppu.colorMathHalveResult', 'ppu.fixedColor', 'ppu.directColorMode',
        'ppu.hiResMode', 'ppu.screenInterlace', 'ppu.overscanMode', 'ppu.extBgEnabled',
        'ppu.windowMaskMain[0]', 'ppu.windowMaskMain[1]', 'ppu.windowMaskMain[2]',
        'ppu.windowMaskMain[3]', 'ppu.windowMaskMain[4]', 'ppu.windowMaskSub[0]',
        'ppu.windowMaskSub[1]', 'ppu.windowMaskSub[2]', 'ppu.windowMaskSub[3]', 'ppu.windowMaskSub[4]',
        'ppu.window[0].left', 'ppu.window[0].right', 'ppu.window[1].left', 'ppu.window[1].right',
        'ppu.mode7.matrix[0]', 'ppu.mode7.matrix[1]', 'ppu.mode7.matrix[2]', 'ppu.mode7.matrix[3]',
        'dmaController.hdmaChannels']
for _i in range(4):
    KEYS += ['ppu.layers[%d].%s' % (_i, k) for k in
             ('tilemapAddress', 'chrAddress', 'doubleWidth', 'doubleHeight', 'largeTiles', 'hscroll', 'vscroll')]
HDMA_BYTES = {0: 1, 1: 2, 2: 2, 3: 4, 4: 4, 5: 4, 6: 2, 7: 4}
HDMA_REGS = {0: (0,), 1: (0, 1), 2: (0, 0), 3: (0, 0, 1, 1), 4: (0, 1, 2, 3), 5: (0, 1, 0, 1),
             6: (0, 0), 7: (0, 0, 1, 1)}


class Bus:
    """Čtení z adresy CPU nad ROM (LoROM) a WRAM zachycenou ve scéně."""
    def __init__(self, rom, wram):
        self.rom, self.wram = rom, wram

    def __getitem__(self, addr):
        bank, a = (addr >> 16) & 0xFF, addr & 0xFFFF
        if bank in (0x7E, 0x7F):
            return self.wram[((bank - 0x7E) << 16) | a]
        if (bank & 0x7F) < 0x40 and a < 0x2000:
            return self.wram[a]
        if a >= 0x8000 and (bank & 0x7F) <= 0x7D:
            return self.rom[(((bank & 0x7F) << 15) | (a & 0x7FFF)) % len(self.rom)]
        return None


def expand_hdma(st, bus, ch):
    """Kanál HDMA → seznam (od řádku, do řádku, registr B, [bajty]) pro řádky 0–224."""
    p = 'dmaController.channel[%d].' % ch
    mode, dest = st[p + 'transferMode'], 0x2100 | st[p + 'destAddress']
    indirect = st[p + 'hdmaIndirectAddressing']
    addr = (st[p + 'srcBank'] << 16) | st[p + 'srcAddress']
    ibank = st[p + 'hdmaBank']
    n = HDMA_BYTES[mode]
    out, line = [], 0
    for _ in range(256):
        cnt = bus[addr]
        if cnt is None or cnt == 0 or line > 224:
            break
        addr = (addr & 0xFF0000) | ((addr + 1) & 0xFFFF)
        repeat, lines = bool(cnt & 0x80), (cnt & 0x7F) or 128
        if indirect:
            ptr = (ibank << 16) | bus[addr] | bus[(addr & 0xFF0000) | ((addr + 1) & 0xFFFF)] << 8
            addr = (addr & 0xFF0000) | ((addr + 2) & 0xFFFF)
            data_at = ptr
        else:
            data_at = addr
        if repeat:
            for i in range(lines):
                vals = [bus[(data_at & 0xFF0000) | ((data_at + i * n + k) & 0xFFFF)] for k in range(n)]
                out.append((line + i, line + i, dest, vals))
            used = lines * n
        else:
            vals = [bus[(data_at & 0xFF0000) | ((data_at + k) & 0xFFFF)] for k in range(n)]
            out.append((line, line + lines - 1, dest, vals))
            used = n
        if not indirect:
            addr = (addr & 0xFF0000) | ((addr + used) & 0xFFFF)
        line += lines
    return mode, dest, indirect, out


def scene(rom, stage, frames, title=False):
    e = SnesEmu()
    if not title:
        for t in START_TAPS:
            e.press(*t)
        e.poke(STAGE, stage, 900, 2700)
        for addr, val in CHEATS.values():
            e.poke(addr, val, 900)
        for addr, val in CHEAT_ROM:
            e.patch_rom(addr, val)
    for f in frames:
        e.capture('v%d' % f, f, what=('state', 'wram'))
        for line in LINES:
            e.capture('l%d_%d' % (f, line), f, line, what=('state',))
    r = e.run(frames=frames[-1])
    out = []
    for f in frames:
        st = r.state('v%d' % f)
        bus = Bus(rom, r.mem('v%d' % f, 'wram'))
        rec = {'frame': f, 'vblank': {k: st.get(k) for k in KEYS}, 'lines': {}, 'hdma': []}
        for line in LINES:
            ls = r.state('l%d_%d' % (f, line))
            rec['lines'][line] = {k: ls.get(k) for k in KEYS}
        mask = st.get('dmaController.hdmaChannels') or 0
        for ch in range(8):
            if mask & (1 << ch):
                mode, dest, ind, rows = expand_hdma(st, bus, ch)
                rec['hdma'].append({'channel': ch, 'mode': mode, 'register': dest, 'indirect': ind, 'rows': rows})
        out.append(rec)
    return out


def summarize(name, recs, p):
    keys_changing_frames, keys_changing_lines = {}, {}
    for rec in recs:
        for k, v in rec['vblank'].items():
            keys_changing_frames.setdefault(k, set()).add(json.dumps(v))
        base = rec['lines'][LINES[0]]
        for line, ls in rec['lines'].items():
            for k, v in ls.items():
                if v != base[k]:
                    keys_changing_lines.setdefault(k, set()).add(line)
    first = recs[0]['vblank']
    p('### %s' % name)
    p('')
    p('snímky %s' % ', '.join(str(r['frame']) for r in recs))
    p('')
    p('| klíč | hodnoty (ve vblanku) | mění se mezi řádky |')
    p('|---|---|---|')
    for k in KEYS:
        vals = sorted(keys_changing_frames[k], key=str)
        short = ', '.join(vals[:6]) + (' … (%d)' % len(vals) if len(vals) > 6 else '')
        if len(vals) > 1 or k in keys_changing_lines or k in (
                'ppu.bgMode', 'ppu.mainScreenLayers', 'ppu.subScreenLayers', 'ppu.colorMathEnabled',
                'ppu.mosaicEnabled', 'ppu.oamMode', 'dmaController.hdmaChannels') or \
                (k.startswith('ppu.layers') and ('Address' in k)):
            lines = keys_changing_lines.get(k)
            p('| `%s` | %s | %s |' % (k, short, ', '.join(map(str, sorted(lines))) if lines else '—'))
    hd = [(rec['frame'], h) for rec in recs for h in rec['hdma']]
    if hd:
        p('')
        p('HDMA:')
        seen = set()
        for f, h in hd:
            key = (h['channel'], h['register'], h['mode'], h['indirect'])
            if key in seen:
                continue
            seen.add(key)
            span = '%d–%d' % (h['rows'][0][0], h['rows'][-1][1]) if h['rows'] else '—'
            p('- snímek %d, kanál %d → `$%04X` %s, režim %d%s, %d úseků, řádky %s' % (
                f, h['channel'], h['register'], reg_name(h['register']), h['mode'],
                ', nepřímé' if h['indirect'] else '', len(h['rows']), span))
    else:
        p('')
        p('HDMA: žádné (`$420C` = 0 na všech snímcích)')
    p('')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--scenes', default='title,0,1,2,3,4,5,6')
    ap.add_argument('--out', default=os.path.join(PROJECT, 'sources', 'docs', 'ppu_state.md'))
    a = ap.parse_args()
    rom = open(ROM, 'rb').read()
    os.makedirs(os.path.join(PROJECT, 'build', 'ppu'), exist_ok=True)
    md = []
    p = md.append
    p('# ppu_state — registry PPU a HDMA ve scénách hry')
    p('')
    p('Vygenerováno `tools/dumpppu.py` (US NTSC, MesenCE 2.2.1). Scény kromě '
      'titulky jsou **přes cheat**: `$7E:16E5` nastavené na hodnotu scény před startem, '
      '? nekonečné životy `$7E:16E1` a ? nesmrtelnost `$7E:158F` + `$01:A957` (kódy z druhé '
      'ruky). Stav ve vblanku na snímcích scény, k tomu stav na řádcích %s téhož snímku; '
      '„mění se mezi řádky" = hodnota na některém řádku jiná než na řádku 0. '
      'Rozbor a závěry: `hw_notes.md`.' % ', '.join(map(str, LINES)))
    p('')
    for sc in a.scenes.split(','):
        if sc == 'title':
            recs, name = scene(rom, None, TITLE_FRAMES, title=True), 'titulka'
        else:
            recs, name = scene(rom, int(sc), FRAMES), '`$16E5` = %s' % sc
        tag = 'title' if sc == 'title' else 's%s' % sc
        for rec in recs:
            json.dump(rec, open(os.path.join(PROJECT, 'build', 'ppu', '%s_%d.json' % (tag, rec['frame'])), 'w'),
                      indent=1, default=str)
        summarize(name, recs, p)
        print('scéna %s: %d snímků' % (sc, len(recs)))
    open(a.out, 'w').write('\n'.join(md) + '\n')
    print(a.out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
