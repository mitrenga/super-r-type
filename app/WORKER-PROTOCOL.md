# Protokol mezi `levelModel.js` a `gameWorker.js`

Hlavní vlákno kreslí, worker drží svět. Zprávy jsou jediné, co je spojuje.
**Stav M3 (2026-10-18): worker hraje hru kódem originálu** — plánovač
úloh, správce úrovně, loď se zbraněmi, Force, bity, scroll sekcí, sprajty
do OAM, animace palet (`app/gameKernel.js`, `ship.js`, `force.js`,
`weapons.js`, `levelScroll.js`, `objectSprites.js` nad `data/*.json`)
a **model zpožděného snímku** (`app/frameBudget.js`). Každý tik je snímek
stroje: NMI a průchod hlavní smyčky po něm, nebo zpožděný snímek, ve kterém
NMI nic nedělá. Zpráva snímku nese, co NMI dalo do čipu. **M4 (2026-10-18):
nepřátelé, jejich střely, výbuchy a bossové jsou kód originálu** —
`enemies.js`…`enemies4.js` (druhy ze seznamů vln, banka `$02`),
`enemiesLevel.js`…`enemiesLevel3.js` (výbuchy, střely a objekty vázané na
úroveň, banka `$03`), `bosses.js`…`bosses3.js` (banka `$08`); záplata
`noEnemies` z M3 je ve workeru vypnutá. Mozaika sekcí s bossem (`$2106`)
jde do `SNESPPU` jako událost `mosaic` a knihovna ji od M4 kreslí. Start
z mateřské lodi (sekce 14–15) zůstává druhou částí M3.

## ★ Tik je snímek NTSC, 60,10 Hz

Referenční stroj je US konzole (R-050): 262 řádků po 1 364 taktech
21,477 MHz, každý druhý snímek o 4 takty kratší (`tools/snesemu.py`
`selftest`: 357 368 / 357 364) = **16,639 ms**. Hodiny jsou rekurzivní
`setTimeout` s akumulátorem (R-046), nejvýš 4 tiky naráz po návratu karty.

## ★ Průchod hlavní smyčky a zpožděný snímek

Jednotkou herního času originálu je **průchod hlavní smyčky** (`$50`), ne
snímek (`sources/docs/disasm_notes.md` §2): průchod, který se nevejde do
snímku, nechá další NMI přeskočit scroll, OAM, paletu, VRAM i čtení
ovladače — **zpožděný snímek** (NMI prošlo `$00:82C5`). Worker ho hlásí
v každém snímku (`lag`) a rozhoduje o něm `FrameBudget`: takty, které
úlohy originálu stojí, naměřené na běžícím originálu
(`tools/measurebudget.mjs`), NMI podle bloků mapy, skupin sprajtů a úlohy,
nahrání skladby po skladbách (úroveň 1 = ★ 19 zpožděných snímků).
`tools/matchship.mjs` model drží proti nahrávkám (čísla v `MILNIKY.md`).
Ve zpožděném snímku zpráva nenese nic, co by model kreslil — obraz stojí.

## ★ Meze sprajtů čipu jsou stav hry

Originál čte v NMI STAT77 (*range over* = víc než 32 sprajtů na řádku,
*time over* = víc než 34 dlaždic) a při přetečení kreslí druhou skupinu
sprajtů v lichých průchodech pozpátku (blikání). Worker si příznaky počítá
sám z OAM, které poslalo poslední NMI, knihovní funkcí `snesSpriteLimits`
(`svision/js/platform/canvas2D/snes/snesSpriteLimits.js`, stejné pravidlo
jako `SNESPPU.evaluateSprites`; `svision/tools/checksnes.mjs` je drží proti
sobě) — PPU hlavního vlákna kreslí později, než hra příznaky čte.

## Model → worker

| zpráva | pole | význam |
|---|---|---|
| `init` | `initData: {headless, seed, hiScore, level, sound, data, section}` | založí svět a seedovaný zdroj náhody; `level` je volba originálu `NOVICE` / `EASY` / `NORMAL` / `HARD` (★ manuál s. 5, výchozí ★ EASY — `disasm_notes.md` §4), `sound` `STEREO` / `NORMAL` (★ s. 6); neznámá hodnota se zahodí. **`data`** = rozparsované `data/*.json`: s `ship`, `levels`, `sprites`, `tiles`, `palettes`, `waves` worker **hraje hru** (★ `L_018175`: nová hra ve zvolené obtížnosti od sekce 0, hiScore jako BCD do `$16CF`); se samotným `levels` jen scrolluje sekce (**attract mode** menu, M2; `section` = první sekce); bez dat jen tiká. Odpoví snímkem 0 a tiká. `headless: true` tiká jen na `tick` (`tools/runworker.mjs`). |
| `controls` | `joypad` | ★ celé slovo ovladače 1, jak ho dá automatické čtení `$4219:$4218` (`SNESJoypad`: B Y Select Start ↑ ↓ ← → / A X L R), při každé změně; dolní nibble je 0. NMI ho ukládá do `$60`, průchod z něj dělá `$15C9`/`$15CB` (drženo / stisknuto) a autofire |
| `pause` / `continue` | – | zastaví / rozjede tikání (panel pauzy, ztráta zaměření karty); pauza originálu (START) je stav hry `$8565` a jde přes `controls` |
| `tick` | – | jeden snímek v režimu `headless` |
| `random` | `site` | jedna hodnota ze zdroje náhody pro místo `site`; odpoví `random` |
| `reset` | – | zahodí stav (odchod z modelu) |

### ★ Náhoda

M0 nenašel v originálu **žádné čtení hardwarové entropie ani závislost na
čase** (`disasm_notes.md` §5: partie posunutá o 1 a 7 snímků má stejnou
OAM i WRAM) a M3 to potvrdil nad kódem lodi — průběh hry je funkce vstupu,
nic ve workeru zdroj nečte. Zdroj `nextRand(site)` (seedovaný xorshift)
zůstává podle `STANDARDS.md`, aby místo, které by se v M4–M5 ukázalo jako
náhodné, dostalo seedovaný zdroj a ne `Math.random()`; `site` je adresa
čtení, přes kterou `match*` nasype nahrané hodnoty zpátky.

## Worker → model

| zpráva | pole | význam |
|---|---|---|
| `frame` | `frame`, `pass`, `lag`, `joypad`, `panel`, `section`, `scroll`, `regs`, `writes`, `groups`, `oam`, `cgram`, `shipTiles`, `shipTilesVram`, `panelLine`, `panelVram`, `events`, `sound`, `sectionStart?` | uplynul snímek; **na tuhle zprávu se kreslí** (R-037). `frame` roste o jedna na tik — model z rozdílu počítá třetí číslo ukazatele `nakresleno/zpráv/tiků FPS` (R-045). `pass` ★ `$50` (roste jen v řádném snímku), `lag` zpožděný snímek (pak zpráva nese jen počítadla a `panel`), `joypad` slovo, které worker drží, `panel` `{level, sound, score, hiScore}` (skóre ★ BCD `$16E9:$16E7` převedené na číslo). **Co NMI dalo do čipu** (`app/levelLoader.js` to zapíše): `section` ★ `$16E5`, `scroll` ★ `$1830`, `regs` = `{hofs: [BG1, BG2], vofs: [BG1, BG2]}` — stíny `$1836`/`$1838`, `$1866`/`$1868`; `writes` = co NMI zapsalo do VRAM: bloky mapy `{vaddr, words[16]}` (slovo VRAM levého horního dlaždice bloku 4×4, slova po řádcích; nejvýš ★ 13), nebo slova úlohy NMI — text `{text: [{vaddr, word}]}` (`$895A`), mazání mapy `{vaddr, fill, count}` (`$9675`, 256 slov na NMI); `groups` = ★ `nmi_upload_sprite_groups`: nejvýš 4 skupiny `{vaddr, words[64]}` (32 slov na adrese, 32 na +$100), jen když fronta mapy je prázdná; `oam` ★ stín `$7E:2200` (512 B) + horní tabulka `$2400` (32 B), DMA každé řádné NMI; `cgram` ★ stín `$7E:2F60` (512 B), DMA každé NMI — palety i jejich animace; `shipTiles` ★ buffer `$7E:24A0` (1 KB) → VRAM `shipTilesVram` = `$6000`, jen když `$4C` bit 15 (jinak `null`); `panelLine` ★ `$18CC` (54 B) → VRAM `panelVram` = `$5F40`, jen když bit 14; `events` = co udělal průchod s čipem mimo NMI: `{kind: 'bgTiles', section, tileSet}` (★ `S_008B18`: dlaždice pozadí sekce — model je nahraje z `data/tiles.json`), `{kind: 'commonTiles'}` (font a společná sada sprajtů), `{kind: 'inidisp', value}` (★ `$80`: zatemnění a jas), `{kind: 'mosaic', value}` (★ `$2106`, sekce s bossem); `sound` = povely zvuku odeslané v průchodu (`S_00A510`) a `{song}` nahrání skladby — pro M6, model je zatím nečte; `sectionStart` jen v attract mode: `{section, tileSet, paletteSets, bank}` |
| `gameOver` | `score` | ★ správce úrovně po třetí smrti spustil přechod banky `$03` (`$80B1`); worker přestal tikat |
| `error` | `message` | hra došla ke stavu, který ještě není převedený (`unported` v `ship.js`), nebo worker spadl |
| `random` | `value` | odpověď na `random`, 0–255 |

Měří `tools/runworker.mjs` bez prohlížeče (M2 + M3 kontroly, čísla
v `MILNIKY.md`); paměť hry proti běžícímu originálu `tools/matchship.mjs`,
scroll a mapu `tools/matchlevels.mjs`.
