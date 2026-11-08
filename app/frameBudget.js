// classic worker script (importScripts): no import, no export — R-001
// begin code

/**
 * The frame budget of Super R-Type — ★ **the model of the lag frame**
 * (`sources/docs/disasm_notes.md` §2, `MILNIKY.md` M3): the original's
 * main loop and NMI pass each other bit 7 of `$4C`; an NMI that finds
 * the pass of the previous frame unfinished does nothing (`nmi_lag_skip`,
 * 1 198 master clocks) and the game stands a frame. The remake counts
 * master clocks: a pass starts when the regular NMI returns and costs what
 * its tasks cost — a table **fitted from the running original**
 * (`tools/measurebudget.mjs` over the recordings of `tools/traceship.py`
 * and, from M4, `tools/traceenemies.py`: every task's dispatch and return
 * timed, 278 408 passes of all seven levels, the five lasers, the enemies
 * and the bosses) — plus the rest of the pass (the sprites into the OAM by the
 * entries drawn and hidden, the palette animation), and the NMI costs its
 * base plus the map blocks it draws, the sprite groups it uploads and the
 * job it runs. The song load (`$01:844D`, the IPL transfer to the SPC) is
 * measured per song: 1.0-6.8 million clocks, the 19 lag frames of a
 * level's start.
 *
 * The timeline: the NMI of frame k falls at `k·FRAME + NMI_CLOCK`; a pass
 * that is still running then makes that NMI a lag one (and costs the pass
 * `NMI.lag` more); when it ends, the next NMI is regular and starts the
 * next pass at `nmiTime + nmiCost`. ★ The fit's residual is 42 000 clocks
 * (12 % of a frame) a pass — a state costs its mean, and an enemy's pass
 * varies with the shots it tests and the sprites it draws; where the
 * original's pass ends within that of the NMI the model can miss a lag
 * frame — `tools/matchship.mjs` and `tools/matchenemies.mjs` count those
 * against the recordings (M3: 79 of 42 255 frames; M4: the numbers in
 * `MILNIKY.md`). A finer model (the cost of a state by its work) is left
 * open.
 */
class FrameBudget {

  constructor() {
    /** the master clock the running pass ends at (absolute), or -1 */
    this.passEnd = -1;
    /** the cost accumulated by the pass being run */
    this.cost = 0;
    /** the frames so far */
    this.frame = 0;
    /** the lag frames so far */
    this.lagFrames = 0;
  } // constructor

  /** ★ master clocks a frame (357 368 / 357 364 alternating: the mean) */
  static get FRAME() { return 357366; }
  /** ★ the NMI at the start of the vertical blank, line 225 */
  static get NMI_CLOCK() { return 225*1364; }

  /**
   * The NMI of frame `frame`: is the pass still running?
   * @param {number} frame - The frame.
   * @returns {boolean} True for a lag NMI (the pass goes on, `NMI.lag` dearer).
   */
  nmiIsLag(frame) {
    this.frame = frame;
    var at = frame*FrameBudget.FRAME+FrameBudget.NMI_CLOCK;
    if (this.passEnd > at) {
      this.passEnd += FrameBudget.NMI.lag;
      this.lagFrames++;
      return true;
    }
    return false;
  } // nmiIsLag

  /**
   * A regular NMI's cost: the pass of this frame starts when it returns.
   * @param {number} blocks - Map blocks drawn (0-13).
   * @param {number} groups - Sprite groups uploaded (0-4).
   * @param {boolean} job - An NMI job ran.
   */
  nmi(blocks, groups, job) {
    var n = FrameBudget.NMI;
    var at = this.frame*FrameBudget.FRAME+FrameBudget.NMI_CLOCK;
    this.passStart = at+n.base+n.block*blocks+n.group*groups+(job ? n.job : 0);
    this.cost = 0;
  } // nmi

  /** a task state ran: its fitted cost (an unknown state costs the mean of all) */
  task(code) {
    var c = FrameBudget.TASKS['$'+code.toString(16).padStart(6, '0')];
    this.cost += c === undefined ? FrameBudget.UNKNOWN_TASK : c;
  } // task

  /** the sprite set loader loaded `groups` groups (its cost by the groups, not its mean) */
  groups(groups) {
    var u = FrameBudget.UNITS['$01ddbd'];
    this.cost += u.base+u.unit*groups-FrameBudget.TASKS['$01ddbd'];
  } // groups

  /** the fill task queued a column of `blocks` blocks */
  blocks(blocks) {
    var u = FrameBudget.UNITS['$008d38'];
    this.cost += u.base+u.unit*blocks-FrameBudget.TASKS['$008d38'];
  } // blocks

  /** the song load of song `n` */
  song(n) {
    var c = FrameBudget.SONGS[String(n)];
    this.cost += (c === undefined ? FrameBudget.SONGS['1'] : c)-FrameBudget.TASKS['$01844d'];
  } // song

  /**
   * The pass ended: the rest of its work and the clock it ends at.
   * @param {number} drawn - OAM entries written.
   * @param {number} hidden - OAM entries hidden (128 − drawn).
   * @param {number} anim - Palette animations running.
   * @returns {number} The pass's cost in master clocks.
   */
  passEnded(drawn, hidden, anim) {
    var r = FrameBudget.REST;
    this.cost += r.base+r.drawn*drawn+r.hidden*hidden+r.anim*anim;
    this.passEnd = this.passStart+this.cost;
    return this.cost;
  } // passEnded

} // FrameBudget

/** a state the fit never saw: the mean of a task of the ship's play */
FrameBudget.UNKNOWN_TASK = 6000;

FrameBudget.NMI = {"base":17938,"block":1690,"group":7630,"job":14018,"lag":1198};
FrameBudget.REST = {"base":1478,"drawn":1848,"hidden":389,"anim":59696};
FrameBudget.SONGS = {"0":2816228,"1":6754760,"2":1917585,"3":2575985,"4":4435397,"5":2443403,"6":3097066,"7":1044507};
FrameBudget.UNITS = {"$008d38":{"base":864,"unit":8600,"what":"blocks"},"$01ddbd":{"base":30902,"unit":3749,"what":"groups"}};
FrameBudget.TASKS = {"$008d1c":1123,"$008d38":76407,"$008d6b":1775,"$01804a":359,"$0180d5":317,"$018161":355,"$0181a4":364,"$0181d7":338,"$0182a2":84638,"$01832d":11024,"$01837f":7720,"$0183a0":94,"$0183a1":203575,"$0183b4":105180,"$0183d1":10721,"$0183ef":558,"$018415":1011,"$01844d":3134220,"$0184cf":9646,"$0185ab":235,"$0185de":1994,"$018703":310,"$01871c":1748,"$018729":999,"$018760":321,"$01878d":327,"$0187bf":1749,"$0187d0":1748,"$018a73":8013,"$018a98":92,"$018a99":106686,"$018ab0":135938,"$018ac9":599,"$018ae1":1410,"$018af5":472,"$018b27":502,"$018b6a":7224,"$018bae":92,"$018baf":748,"$018bc5":450,"$018bd8":10478,"$018bdc":8063,"$018c57":332,"$018c78":1998,"$018cba":196,"$018cd0":4227,"$018d1b":1792,"$018d44":1868,"$018d74":3664,"$018d91":4158,"$018dc7":2131,"$018dfd":2010,"$019489":2154,"$0194a5":242,"$0194c7":316,"$019511":294,"$01952d":321,"$01955d":311,"$0195b7":380,"$019623":1772,"$0196e8":92,"$0196e9":203532,"$0196f9":106754,"$019716":135874,"$019729":10664,"$019744":566,"$01976a":382,"$01979e":3134,"$0197cd":1687474,"$0197e4":3595,"$01981a":854,"$01984b":421,"$019882":2964,"$0198bc":5609,"$0198e8":8150,"$019924":8525,"$01994a":1788,"$01994e":2664,"$01996b":317,"$019988":1748,"$01998c":1434,"$0199a0":328,"$0199bd":1748,"$0199c1":1776,"$0199ef":213,"$019a20":7896,"$019a24":1648,"$019a44":2259,"$019a54":9220,"$019adc":2347,"$019af8":7274,"$019afc":12652,"$019b8d":1092,"$019baa":582,"$019bc3":1264,"$019bee":325,"$019c0b":2066,"$019c0f":2570,"$019c32":2394,"$019c78":2006,"$019c7c":3914,"$019ca8":1948,"$019ccb":2275,"$019d18":2855,"$019d60":1905,"$019d7c":1670,"$019da8":1923,"$019dcb":2284,"$019e09":1911,"$019e2c":2248,"$019e6a":1929,"$019e8d":2246,"$019ecb":1914,"$019ef4":2341,"$019f2d":2010,"$019f31":3874,"$019f5d":1816,"$019f8c":2770,"$019fdd":2222,"$01a027":2504,"$01a057":2002,"$01a05b":1670,"$01a087":1956,"$01a0b6":2861,"$01a101":2282,"$01a13f":1897,"$01a157":1964,"$01a15b":1600,"$01a181":1832,"$01a18d":1668,"$01a1b9":1924,"$01a1e2":2342,"$01a21b":1962,"$01a21f":4018,"$01a248":1929,"$01a284":2249,"$01a2c2":1907,"$01a2de":4018,"$01a307":1926,"$01a32a":2249,"$01a368":1908,"$01a391":2345,"$01a3e0":1835,"$01a404":2733,"$01a42e":2589,"$01a471":4063,"$01a4c5":3287,"$01a511":1572,"$01a556":2528,"$01a586":2826,"$01a58a":1757,"$01a5b9":2280,"$01a5ef":1981,"$01a5f3":1868,"$01a625":2333,"$01a649":1462,"$01a66e":1878,"$01a6b4":1881,"$01a6f1":1454,"$01a711":2714,"$01a735":2503,"$01a765":2018,"$01a769":195,"$01a849":5270,"$01a8b5":5905,"$01a8f9":8283,"$01a9b4":2162,"$01a9f2":203,"$01aa1c":1535,"$01aa46":343,"$01b437":1318,"$01b476":1813,"$01b488":1979,"$01b48c":1392,"$01b4d1":5771,"$01b51d":2237,"$01b61a":1800,"$01b63d":5446,"$01b685":336,"$01b6ac":1977,"$01b6b0":1425,"$01b6f7":6633,"$01b714":1534,"$01b71c":1511,"$01b76a":6231,"$01b78b":1462,"$01b793":1440,"$01b7db":5576,"$01b829":2191,"$01b85f":1987,"$01b863":958,"$01b86e":945,"$01b879":930,"$01b89c":2273,"$01b8d2":1991,"$01b8d6":343,"$01b8f2":1757,"$01b920":2927,"$01b99e":2009,"$01b9b2":2960,"$01ba5c":2722,"$01baaa":1962,"$01bb99":6179,"$01bc09":2204,"$01bc66":5698,"$01bd15":2455,"$01bd60":416,"$01bd88":2244,"$01bd8c":2087,"$01bdd4":11970,"$01be2a":10136,"$01be6d":1589,"$01be91":6667,"$01bea8":3007,"$01c531":500,"$01c53f":540,"$01c54d":540,"$01c55b":513,"$01c569":527,"$01c577":498,"$01c599":1248,"$01c5da":340,"$01c601":1752,"$01c605":3369,"$01c617":10780,"$01c718":3355,"$01c72a":10212,"$01c82b":3359,"$01c83d":9943,"$01c93e":3360,"$01c950":10614,"$01ca51":3382,"$01ca63":6877,"$01cad7":3373,"$01cae9":6620,"$01cb64":3018,"$01cb68":810,"$01cb82":2401,"$01cc6e":1622,"$01ccaa":3865,"$01cd23":5742,"$01cd98":1998,"$01cd9c":1632,"$01cdd8":3864,"$01ce51":5420,"$01cec6":1995,"$01ceca":1518,"$01cee1":1486,"$01cf3a":1604,"$01cf4a":1570,"$01cfa8":6051,"$01d01e":1994,"$01d022":12783,"$01d0ce":5551,"$01d19d":12788,"$01d249":6512,"$01d709":7054,"$01d880":346,"$01d8a7":1993,"$01d8ab":1078,"$01d8ce":2348,"$01d8fc":1981,"$01d91a":16270,"$01d92a":16248,"$01d979":328,"$01d999":1756,"$01d99d":1366,"$01d9d8":6959,"$01da71":5978,"$01dada":1987,"$01daf8":1918,"$01db42":5135,"$01dba0":1940,"$01dbea":5537,"$01dc83":335,"$01dca3":2007,"$01dca7":1497,"$01dce2":3114,"$01dd31":2774,"$01dd78":1985,"$01dd7c":451,"$01dda6":1757,"$01ddbd":53767,"$01dde0":1759,"$01de0e":169,"$01de1f":233,"$01dece":17668,"$01df3e":17904,"$01dfc5":17076,"$01e035":17125,"$01e09c":17441,"$01e111":37070,"$01e18c":15800,"$01e1f8":21859,"$01e285":16427,"$01e2ee":22496,"$01e3ea":31301,"$01e477":16519,"$01e4e0":22989,"$01e592":9074,"$01e610":8970,"$01e6ee":17654,"$01e882":13522,"$01e8d2":20220,"$01e9a2":17195,"$01ea00":16416,"$01ec3e":21464,"$01ed43":2116,"$01f77c":167,"$01f78d":232,"$01f7a5":169,"$01f7b6":261,"$01f809":3983,"$01f867":3843,"$01f92d":1391,"$01fc4a":1968,"$01fc68":1526,"$01fc70":1568,"$01fcc0":7515,"$01fd5f":6587,"$01fdcc":6852,"$01fe66":8467,"$01ff30":2301,"$01ff80":348,"$01ff9d":1992,"$028000":5719,"$0280a3":14105,"$02811b":5966,"$0285a8":2050,"$0285c2":1252,"$0285d8":184,"$0285e1":3828,"$028631":3001,"$0286e7":2005,"$0286eb":4135,"$028764":6295,"$028833":1986,"$028f30":5556,"$028fb9":6572,"$029290":2026,"$02ad34":4515,"$02adaf":10888,"$02ae8d":5262,"$02aef6":10576,"$02afd3":6755,"$02b075":10844,"$02b153":5888,"$02b1bc":11366,"$02b334":6722,"$02b3ff":1988,"$02b81b":7621,"$02b835":458,"$02b961":11056,"$02bb31":11222,"$02bd1f":19817,"$02be0f":13715,"$02bfe2":13316,"$02c0c4":21284,"$02c9fe":328,"$02ca24":2241,"$02ca6f":3481,"$02cabd":8185,"$02cb4c":7156,"$02cbbf":6718,"$02cc39":7879,"$02cea7":6451,"$02cf0c":2074,"$02cf36":2247,"$02cf77":1984,"$02d1dd":2292,"$02d246":4579,"$02d298":5076,"$02d30b":4864,"$02d510":2240,"$02d514":5718,"$02d584":8973,"$02d64a":2050,"$02d758":3280,"$02d79f":6277,"$02d847":2232,"$02d84b":2090,"$02d888":9446,"$02d8d6":1975,"$02df65":16452,"$02dfae":173,"$02dfc1":553,"$02dff8":797,"$02e05c":1025,"$02e097":192,"$02e0d8":3776,"$02e18c":5504,"$02e223":2010,"$038000":8152,"$038032":92,"$038033":203531,"$038043":74356,"$038053":10888,"$038077":383,"$0380a0":177,"$0380ad":1748,"$0380b1":8152,"$0380e3":92,"$0380e4":203532,"$0380f4":74316,"$038104":10888,"$038128":73868,"$038178":178,"$03818c":1748,"$038190":8152,"$0381c2":92,"$0381c3":203533,"$0381d3":74316,"$0381e3":168200,"$0381fd":10888,"$038221":855,"$038271":92,"$038272":3523750,"$0382e0":341,"$038363":183,"$038380":18456,"$038384":11921,"$0384b7":326,"$0384d8":240,"$0384e1":489,"$038507":1760,"$03850b":3518,"$038518":1788,"$03854d":2227,"$0385d4":1464,"$038631":1463,"$038641":1490,"$038673":2423,"$038699":1802,"$0386d9":2475,"$03872b":1781,"$03875d":1974,"$039d7d":22429,"$039e76":5928,"$039f38":4019,"$039f8f":184,"$039f9e":5631,"$03a141":4020,"$03a198":182,"$03a1a7":5633,"$03a55e":4329,"$03a6a5":5626,"$03a8b5":5021,"$03a980":929,"$03a9b2":47242,"$03aa07":1772,"$03aa0b":4764,"$03aa68":3763,"$03ab23":2235,"$03ab27":4140,"$03ab8b":2479,"$03abf2":7070,"$03ac4d":1986,"$03b201":3495,"$03b266":9664,"$03b38b":12682,"$03b3f2":2219,"$03b3f6":4045,"$03b42f":3165,"$03b469":3567,"$03b4c4":2920,"$03b4e3":2028,"$03b7ec":3164,"$03b848":9196,"$03c6d9":307,"$03c6eb":793,"$03c743":4366,"$03c7c2":3527,"$03c8a4":10682,"$03cbc9":1975,"$03cbcd":485,"$03cbea":3432,"$03d08f":1185,"$03d0b2":2162,"$03d0e4":1188,"$03d107":2252,"$03d1a4":1190,"$03d1c7":2246,"$03d1fd":1979,"$03d201":936,"$03d21b":2345,"$03d25e":1993,"$03d2bf":2041,"$03d31f":5079,"$03d3ca":2192,"$03d400":1979,"$03d8b4":3228,"$03d91c":6254,"$03d985":6323,"$03d9ee":5746,"$03dbf2":5328,"$03dc69":10027,"$03dd41":9342,"$04aaf2":414,"$04ab0a":264,"$04ab56":1732,"$04ab5a":446,"$04ab62":542,"$04ab89":207,"$04ab98":450,"$04abbd":1757,"$04abc9":592,"$04abf0":193,"$04abff":413,"$04ac21":1763,"$0881a2":170,"$0881b3":700,"$088260":10636,"$08831a":5473,"$0883ec":6744,"$08848f":7136,"$088508":6174,"$0885a5":4447,"$0887be":2507,"$088801":4090,"$08887d":2240,"$088881":3825,"$0888e7":4041,"$088a6e":2237,"$088a72":3100,"$088ab9":298,"$088be9":921,"$088c13":183,"$088c39":2280,"$088c92":538,"$088d75":2126,"$088dbd":176,"$088e28":2474,"$088e83":852,"$088f24":3604,"$088f8c":194,"$088f9b":5761,"$088fec":1986,"$088ff0":378,"$089007":422,"$0890be":3550,"$089127":5485,"$0891a9":7338,"$089293":1780,"$0892c5":1962,"$0892c9":3332,"$089311":3913,"$08934b":1986,"$0896df":6256,"$089735":182,"$089744":1721,"$089771":2926,"$0897cb":2301,"$089836":3036,"$089891":259,"$089b0c":184,"$089b15":1255,"$089b59":3225,"$089b9e":322,"$089c59":21553,"$089d2f":5546,"$089da0":4268,"$089deb":274,"$089e27":5438,"$089f0d":3830,"$089f53":257,"$089f69":5547,"$089fbb":1872,"$089fe2":1892,"$08a014":2322,"$08a049":3858,"$08a06a":1887,"$08a094":2244,"$08a0cc":1885,"$08a0f6":2254,"$08a128":1642,"$08a149":1880,"$08a207":4096,"$08a22e":1890,"$08a260":2320,"$08acbf":6378,"$08ad11":3693,"$08b0d1":4681,"$08b106":2183,"$08b12d":9938,"$08b19f":1921,"$08b1e0":5050,"$08b360":420,"$08b377":316,"$08b3aa":420,"$08b3c1":319,"$08b3f2":406,"$08b3fa":2389,"$08b448":4108,"$08b497":3993,"$08b62e":2382,"$08b67c":4139,"$08b6cb":4088,"$08b92c":3520,"$08b965":3403,"$08b9b2":2408,"$08b9c0":2379,"$08ba0e":3841,"$08ba41":4064,"$08ba81":4071,"$08baec":4864,"$08bb57":8947,"$08bcde":6771,"$08bd75":2246,"$08bdab":1978,"$08c1ed":326,"$08c21a":4692,"$08c26b":197,"$08c2d6":7890,"$08c35f":4086,"$08c49f":5434,"$08c516":4087,"$08c733":7662,"$08c7aa":4147,"$08ca82":3188,"$08cab6":3158,"$08cb2b":2598,"$08cbda":2746,"$08cbeb":2746,"$08cbfc":2724,"$08cc51":2592,"$08cce8":2414,"$08cd39":2746,"$08cd4a":2754,"$08cd5b":2724,"$08cdb0":2497,"$08ce48":2396,"$08ce99":1959,"$08ced3":2246,"$08cf09":2001,"$08cf0d":1442,"$08cf3d":784,"$08cf87":1978,"$08cf8b":1958,"$08cfc5":2246,"$08cffb":1998,"$08cfff":1444,"$08d02f":3841,"$08d1d0":5178,"$08d1f2":2930,"$08d24a":3995,"$08d2c8":340,"$08d2da":257,"$08d303":2063,"$08d342":282,"$08d36b":2726,"$08d3bd":184,"$08d3c6":215,"$08d49a":693,"$08d4c7":1831,"$08d55b":6416,"$08d599":367,"$08d65b":354,"$08d66f":264,"$08d6bc":7772,"$08d722":5170,"$08d7fb":354,"$08d80f":274,"$08d86f":3288,"$08d8a3":5618,"$08d916":4762,"$08d97b":2018};

if (typeof globalThis !== 'undefined') { globalThis.FrameBudget = FrameBudget; }
if (typeof module !== 'undefined' && module.exports) { module.exports = FrameBudget; }
