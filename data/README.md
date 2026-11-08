# data/

Datové soubory, které jdou do prohlížeče. **Každý z nich vyrábí nástroj
z `../tools/` z běžícího originálu nebo z cartridge** — žádný se needituje
ručně a žádný neobsahuje číslo, které by někdo odhadl. Server je posílá přes
`db/appData.php`; chybějící soubor dorazí jako `null` a aplikace to přežije.

## Z cartridge (M2, `tools/dump*.py`, formáty v `tools/srtlib.py`)

| soubor | co v něm je | dělá ho | doloženo |
|---|---|---|---|
| `levels.json` | ★ **18 sekcí hry** (14, 15 start z mateřské lodi; 0–13 sedm úrovní, sudá = úroveň, lichá = část s bossem; 16/17 jeden záznam): hlavička (seznam vln, konec a rychlost scrollu 8.8, tabulka scén), scény (druh, poloha a rychlost / skript obou vrstev), skripty vrstev, **proudy mapy** obou vrstev jako sloupce odkazů na metadlaždice, **metadlaždice** (16 slov dlaždic + 16 kolizních nibblů, adresou v bance sekce), seznam vln, sady palet, číslo skladby | `dumplevels.py` | `matchlevels.mjs`: mapy ve VRAM, kolizní mapa, polohy, scroll a registry proti běžícímu originálu |
| `tiles.json` | ★ **grafika dlaždic jako leží v ROM** (nic není komprimované): 16 sad pozadí po 24 KB (VRAM `$2000`; u sedmi sad DMA přeteče konec banky a čte zrcadlo WRAM — uložené jen bajty v bance), font BG3 (`$05:9B00` → `$5000`, 2 bpp, ASCII), sady sprajtů titulky, startu a společná, dlaždice lodi (`$05:B300`), **68 dynamických sad sprajtů** (záznamy v bance `$04`: id, zdroj, sloty 16×16 ve VRAM `$7000`+) | `dumptiles.py` | `matchtiles.mjs` bajt po bajtu proti VRAM, `matchunpack.mjs` proti katalogu DMA |
| `palettes.json` | ★ palety banky `$05` (16 × BGR555) a sady po sekcích (`$04:824B` řádky 0–7, `$04:82D3` řádky 8–15); 119 palet včetně těch, které si za běhu alokují objekty | `dumppalettes.py` | `matchlevels.mjs` (CGRAM řádky 0–7) |
| `sprites.json` | ★ **511 metasprajtů** banky `$04` (`draw_object_sprites`): díly `{dx, dy, slovo dlaždice}`, rozložení řad a čtverce, s atributy, se kterými je originál kreslil | `dumpsprites.py` | `matchsprites.mjs`: OAM z objektů originálu, bajt po bajtu |
| `waves.json` | ★ seznamy vln po sekcích (`$08:81D0`): scroll spuštění, kód objektu, nejnižší obtížnost, vrstva, tři parametry; druhy objektů podle adresy kódu (jména jsou M5) | `dumpwaves.py` | tytéž položky v `levels.json`; spouštění ověří M5 |
| `texts.json` | ★ 29 textových záznamů (`S_008938`): bajt ≥ `$10` = dlaždice BG3 (ASCII), povely 0–7; nalezené voláními v celé ROM, i v kódu, kam průzkum nedošel (konec hry, continue) | `dumptexts.py` | `matchtexts.mjs` proti mapě BG3 titulky |
| `global.json` | ★ pořadí sekcí (14, 15, 0 … 13; 13 je poslední), obtížnosti (`$16D5`, výchozí EASY), životy 3, hudba a rychlosti scrollu po sekcích, ovládání podle manuálu; body a paprsek `?` (M4) | `dumpglobal.py` | kód (`$01:8204`, `$01:86B5`, `$01:8019`) |
| `hdma.json` | ★ **žádné HDMA** — `$420C` = 0 od resetu, kanály se za běhu nepíší | `dumphdma.py` | `scanhw.py`, `dumpppu.py`, katalog DMA |
| `ship.json` | ★ **banka `$04` celá** (32 KB, tabulky herního kódu: hitboxy, rychlosti, animace, kořeny úloh `$8000`, tabulky laserů `$B487` / `$B49B`, vestavěný vstup `$9073`…) s rejstříkem 69 pojmenovaných tabulek, a **banka `$06`** (skripty objektů) — kód M3 (`app/gameKernel.js`, `ship.js`, `force.js`, `weapons.js`, `lasers.js`) je čte adresou jako originál (`d8` / `d16`) | `dumpship.py` | `matchship.mjs`: WRAM hry bajt po bajtu proti běžícímu originálu |

## Z běžícího originálu (M1, `tools/mkscreen.py`)

| soubor | co v něm je | doloženo |
|---|---|---|
| `screen.json` | ★ **úroveň 1 v rozběhu** (scénář `play1`, snímek 1500): VRAM, CGRAM, OAM, registry PPU na řádku 0, zápisy INIDISP během obrazu, příznaky `STAT77` — reference M1; od M2 z něj aplikace bere **registry obrazu** (režim, báze map a dlaždic, vrstvy — hodnoty z resetu originálu) | `matchscreen.mjs` proti pixelům MesenCE |
| `screen_title.json` | ★ **titulka** po zapnutí (snímek 300) — menu remaku sedí na ní | `matchscreen.mjs`, `matchtexts.mjs` |

Další snímky téhož tvaru a záznamy sekcí (`build/m2/levels/`, `build/m2/
sprites/`, `build/m2/collect/`) a záznamy partií M3 (`build/m3/ship/`,
`tools/traceship.py`) nejsou v gitu — `tools/mkscreen.py`,
`tools/tracelevels.py`, `tools/tracesprites.py`, `build/m2/collect.py` a
`tools/traceship.py` je vyrobí znovu.
