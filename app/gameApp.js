const { Version } = await import('./version.js?ver='+window.srcVersion);
const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { Fonts5x5 } = await import('./svision/js/platform/canvas2D/fonts5x5.js?ver='+window.srcVersion);
const { Fonts3x3 } = await import('./svision/js/platform/canvas2D/fonts3x3.js?ver='+window.srcVersion);
const { MenuModel } = await import('./menuModel.js?ver='+window.srcVersion);
const { LevelModel } = await import('./levelModel.js?ver='+window.srcVersion);
const { GameOverModel } = await import('./gameOverModel.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
// begin code

/**
 * Super R-Type application shell (M1 skeleton), on SNESPlatform — the first
 * game on it (R-050). **Internal project**: R-Type is a trademark of Irem
 * and the series is alive; this remake is never deployed anywhere public
 * (`ZADANI.md` §0). It exists to be the first consumer of the Super Nintendo
 * platform in svision.
 *
 * MenuModel -> (START GAME) LevelModel -> (GAME OVER, or EXIT GAME in the
 * pause panel) GameOverModel -> MenuModel; ABOUT GAME is a panel over the
 * menu. **No boot model**: a Super Nintendo has no BIOS, RESET jumps into
 * the cartridge (R-050), so the application opens on the menu — which sits
 * on the original's own title picture, as the game sits on its own frame.
 *
 * ★ The original's own choices (manual p. 5-6, SELECT SCENE): the
 * difficulty NOVICE / EASY / NORMAL / HARD — ★ the US cartridge starts on
 * EASY (`sources/docs/disasm_notes.md` §4) — and the sound STEREO / NORMAL;
 * BGM and SE are the sound test and come with M6. The remake's menu carries
 * those two and what a browser game needs (SETTINGS, ABOUT).
 *
 * ★ The controller (manual p. 6, `disasm_notes.md` §4): B shoots (held, it
 * charges the beam), A and R detach and attach the Force, X and Y are the
 * autofire, START pauses. The remake maps its actions onto the pad's bits
 * (`SNESJoypad`) — fire → B, force → A — and **every key comes from
 * SETTINGS**; Escape is the remake's pause panel (`ZADANI.md` §10.2).
 *
 * No sound in M1: the S-DSP and the SPC700 are M6, there is no audio
 * manager here at all.
 */
export class GameApp extends AbstractApp {

  /** ★ the difficulty levels of the SELECT SCENE, in the manual's order */
  static get LEVELS() { return ['NOVICE', 'EASY', 'NORMAL', 'HARD']; }
  /** ★ the sound choice of the SELECT SCENE */
  static get SOUNDS() { return ['STEREO', 'NORMAL']; }
  /** the colours of the remake's own panels (the game's picture has its own CGRAM) */
  static get COLORS() {
    return {white: '#ffffff', grey: '#9c9c9c', darkGrey: '#424242', black: '#000000',
            red: '#e73929', yellow: '#f7d642', blue: '#4a8cf7', green: '#5ad65a',
            panel: '#000000d0', hover: '#ffffff20', click: '#ffffff40'};
  }
  /** how many scores the local hall of fame keeps */
  static get HALL_OF_FAME_SIZE() { return 10; }

  constructor(platform, importPath, wsURL, devModeName, appIconSprite) {
    super(platform, 'bodyApp', importPath, wsURL);

    this.worker = new Worker(this.importPath+'/gameWorker.js?ver='+window.srcVersion);
    this.worker.onmessage = (event) => {
      if (this.model && this.model.handleWorkerMessage) {
        this.model.handleWorkerMessage(event);
      }
    };
    // a worker that dies says nothing by itself
    this.worker.onerror = (event) => {
      console.error('gameWorker: '+event.message+' ('+event.filename+':'+event.lineno+')');
    };

    this.version = Version;
    this.copyright = '© 2026 LIBOR MITRENGA, INTERNAL BUILD';
    this.devModeName = devModeName === undefined ? false : devModeName;
    this.appIconSprite = appIconSprite;

    // the remake's fonts: svision's 5x5 and 3x3 for the menu, the panels and
    // the dialogs. The game's screen uses none of them — it is the original's
    // own tiles in its own VRAM (screenLoader.js; the font tiles come with M2)
    this.fonts = {
      fonts5x5: new Fonts5x5(this),
      fonts3x3: new Fonts3x3(this)
    };
    this.fonts.fonts5x5.addGlyphs({
      '◢': {width: 4, data: [[4,0,1,1], [3,1,2,1], [2,2,3,1], [1,3,4,1], [0,4,5,1]]},
      '◤': {width: 4, data: [[0,0,5,1], [0,1,4,1], [0,2,3,1], [0,3,2,1], [0,4,1,1]]}
    });
    this.fonts.fonts5x5.addSpace('␣', {width: 2, breaking: false, stretch: true});

    // ★ the pad: four directions, B shoots and charges, A toggles the Force.
    // The keyboard defaults are the remake's; the names of the actions are
    // what the worker turns into the bits of $4219:$4218 (SNESJoypad)
    this.controlsOptions = {
      keyboard: {
        device: 'keyboard',
        keys: [
          {action: 'left', label: 'LEFT'},
          {action: 'right', label: 'RIGHT'},
          {action: 'up', label: 'UP'},
          {action: 'down', label: 'DOWN'},
          {action: 'fire', label: 'FIRE / BEAM (B)'},
          {action: 'force', label: 'FORCE (A)'}
        ]
      },
      gamepads: {
        device: 'gamepads',
        keys: [
          {action: 'left', label: 'LEFT', eventKey: 'GamepadLeft'},
          {action: 'right', label: 'RIGHT', eventKey: 'GamepadRight'},
          {action: 'up', label: 'UP', eventKey: 'GamepadUp'},
          {action: 'down', label: 'DOWN', eventKey: 'GamepadDown'},
          {action: 'fire', label: 'FIRE / BEAM', eventKey: 'GamepadFire'},
          {action: 'force', label: 'FORCE', eventKey: 'GamepadForce'},
          {action: 'ok', label: 'OK', eventKey: 'GamepadOK'},
          {action: 'exit', label: 'EXIT', eventKey: 'GamepadExit'}
        ]
      },
      // ★ Touch controls are part of M1 (MILNIKY.md). One half of the screen
      // is the **stick** — the ship flies in eight directions — the other
      // the **buttons**: the lower part fires (held, it charges the beam),
      // the upper strip is the Force. Which half is which is the
      // left-handed / right-handed choice in SETTINGS.
      touchscreen: {
        device: 'touchscreen',
        types: {
          keys: ['rightFire', 'leftFire'],
          rightFire: {
            left: {half: 'stick', sprite: 'stick'},
            right: {half: 'buttons', sprite: 'fire'}
          },
          leftFire: {
            left: {half: 'buttons', sprite: 'fire'},
            right: {half: 'stick', sprite: 'stick'}
          }
        },
        halves: {
          stick: {
            icon: 'stick',
            zones: [
              {rect: [0, 0, 1, 1], type: 'joystick', control: 'both',
               actions: {left: 'left', right: 'right', up: 'up', down: 'down'}}
            ]
          },
          buttons: {
            icon: 'fire',
            zones: [
              {rect: [0, 0, 1, 0.3], type: 'button', action: 'force', tap: true},
              {rect: [0, 0.3, 1, 0.7], type: 'button', action: 'fire'}
            ]
          }
        },
        // the worker reads the pad once a frame (60 Hz); a tap is held at
        // least this long so that it is seen
        tapHoldTime: 120,
        joystickStep: 10,
        icons: {
          stick: {
            compressedSpriteData: 'lP101300N0E2P0111030Z051012320B0P020N0601234561718191AB9BCDB1BDCB9BA19181716543210'
          },
          // ? a plain disc until the original's own sprites are read (M2)
          fire: {
            width: 39, height: 23, frames: 1, directions: 1,
            sprite: [[
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------##########--------------',
              '-------------##############------------',
              '------------################-----------',
              '-----------##################----------',
              '----------####################---------',
              '----------####################---------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '----------####################---------',
              '----------####################---------',
              '-----------##################----------',
              '------------################-----------',
              '-------------##############------------',
              '---------------##########--------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------'
            ]]
          }
        }
      }
    };

    this.controls = {
      keyboard: this.getControls('keyboard'),
      touchscreen: this.getControls('touchscreen'),
      gamepads: this.getControls('gamepads')
    };

    // ★ the original's own choices, kept in cookies like the siblings keep the player's name
    this.level = this.readChoice('level', GameApp.LEVELS, 'EASY');
    this.sound = this.readChoice('sound', GameApp.SOUNDS, 'STEREO');
    this.score = 0;
    this.hiScore = 0;
    this.playerName = Tool.readCookie('playerName', 'R-9');
    /** ★ the seed of the game's randomness, settled before the worker starts (WORKER-PROTOCOL.md) */
    this.gameSeed = this.devSeed() || 1;
    this.globalData = false;
    this.dataError = false;
    this.id = 'GameApp';
    this.fetchDataId = '';
    this.setModel('MenuModel');
    this.loadAppData();
  } // constructor

  /**
   * A choice of the original's menu out of a cookie, or the default.
   * @param {string} key - The cookie.
   * @param {Array} values - The allowed values.
   * @param {*} fallback - The default.
   * @returns {*} The value.
   */
  readChoice(key, values, fallback) {
    var raw = Tool.readCookie(key, '');
    return values.indexOf(raw) >= 0 ? raw : fallback;
  } // readChoice

  /**
   * Cycles one of the original's choices and keeps it.
   * @param {string} key - 'level' or 'sound'.
   * @returns {string} The new value.
   */
  cycleChoice(key) {
    var values = {level: GameApp.LEVELS, sound: GameApp.SOUNDS}[key];
    this[key] = values[(values.indexOf(this[key])+1)%values.length];
    Tool.writeCookie(key, this[key]);
    return this[key];
  } // cycleChoice

  getControls(device) {
    var result = {};

    switch (device) {
      case 'keyboard':
        result = {left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', fire: ' ', force: 'Z'};
        break;
      case 'touchscreen':
        result = {supported: false, type: 'rightFire'};
        break;
      case 'gamepads':
        result = {supported: false, devices: {}};
        break;
    }

    switch (device) {
      case 'keyboard':
      case 'touchscreen':
        var cfgString = Tool.readCookie(device, false);
        if (cfgString !== false) {
          try {
            var cfg = JSON.parse(cfgString);
            Object.keys(cfg).forEach((item) => {
              result[item] = cfg[item];
              if (device == 'touchscreen' && !(result[item] in this.controlsOptions.touchscreen.types)) {
                result[item] = this.controlsOptions.touchscreen.types.keys[0];
              }
            });
          } catch (error) {
            console.error(error.message);
          }
        }
        break;
      case 'gamepads':
        var devicesString = Tool.readCookie('gamepads', false);
        if (devicesString !== false) {
          try {
            var devices = JSON.parse(devicesString);
          } catch (error) {
            console.error(error.message);
          } finally {
            if (Array.isArray(devices)) {
              devices.forEach((id) => {
                var deviceString = Tool.readCookie(id, false);
                if (deviceString !== false) {
                  try {
                    var device = JSON.parse(deviceString);
                  } catch (error) {
                    console.error(error.message);
                  } finally {
                    result.devices[id] = device;
                  }
                }
              });
            }
          }
        }
        break;
    }
    return result;
  } // getControls

  /**
   * The seed a developer build may pin: `?devSeed=` or `$devMode = ['seed' => N]`
   * (`Tool.devParam`, R-058 — nothing outside dev mode).
   * @returns {number} The seed, or 0 when nothing pins one.
   */
  devSeed() {
    var pinned = Number(Tool.devParam('devSeed', 0));
    return (Number.isFinite(pinned) && pinned > 0) ? (pinned & 0x7FFFFFFF) : 0;
  } // devSeed

  /** A fresh seed for every game, unless the developer build pinned one. */
  newGameSeed() {
    this.gameSeed = this.devSeed() || ((Date.now() & 0x7FFFFFFF) || 1);
    return this.gameSeed;
  } // newGameSeed

  /**
   * Switches models: menu → level → game over → menu; Escape in the level
   * opens the pause panel, whose EXIT GAME goes through the game over
   * screen (R-049: the score is kept even when the game is left early).
   * @param {string} model - 'MenuModel', 'LevelModel', 'GameOverModel' or 'GameExitModel'.
   */
  setModel(model) {
    var needResizeApp = false;
    var selectionItem = 0;
    if (this.model) {
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'MenuModel':
        this.model = new MenuModel(this, selectionItem);
        break;
      case 'LevelModel':
        this.model = new LevelModel(this);
        break;
      case 'GameOverModel':
        this.model = new GameOverModel(this, true, 'MenuModel');
        break;
      case 'GameExitModel':
        this.model = new GameOverModel(this, false, 'MenuModel');
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

  /**
   * Starts a new game with the menu's choices.
   */
  startGame() {
    this.score = 0;
    this.newGameSeed();
    this.setModel('LevelModel');
  } // startGame

  // ------------------------------------------------------ the local hall of fame

  /**
   * The local hall of fame (localStorage; the project has no server side,
   * `ZADANI.md` §0): the best scores, highest first.
   * @returns {Object[]} `{name, score, level, date}`.
   */
  readHallOfFame() {
    try {
      var stored = localStorage.getItem(window.appPrefix+'.hallOfFame');
      var list = stored === null ? [] : JSON.parse(stored);
      return Array.isArray(list) ? list : [];
    } catch (error) {
      console.error(error.message);
      return [];
    }
  } // readHallOfFame

  /**
   * Puts a score into the local hall of fame (R-049: a game left early
   * counts too) and keeps the hi-score.
   * @param {number} score - The score.
   * @returns {number} The index the score landed at, or -1 when it did not make the list.
   */
  addToHallOfFame(score) {
    var list = this.readHallOfFame();
    var entry = {name: this.playerName, score: score, level: this.level, date: new Date().toISOString().substring(0, 10)};
    var index = list.findIndex((item) => item.score < score);
    if (index < 0) {
      index = list.length;
    }
    list.splice(index, 0, entry);
    list.length = Math.min(list.length, GameApp.HALL_OF_FAME_SIZE);
    try {
      localStorage.setItem(window.appPrefix+'.hallOfFame', JSON.stringify(list));
    } catch (error) {
      console.error(error.message);
    }
    this.hiScore = Math.max(this.hiScore || 0, score);
    return index < list.length ? index : -1;
  } // addToHallOfFame

  // ------------------------------------------------------------------ the data

  /**
   * The data of the original: from the server when online (which also
   * refreshes localStorage), or straight out of localStorage when offline.
   */
  loadAppData() {
    if (navigator.onLine) {
      this.fetchDataId = this.fetchData('appData.db', false, {}, this, 2000);
    } else {
      this.loadGlobalDataFromStorage();
    }
  } // loadAppData

  loadGlobalDataFromStorage() {
    var stored = localStorage.getItem(window.appPrefix+'.screen');
    if (stored !== null) {
      this.globalData = true;
      return true;
    }
    return false;
  } // loadGlobalDataFromStorage

  setData(data) {
    var files = {};
    Object.keys(data.data).forEach((key) => {
      if (key == 'hiScore') {
        this.hiScore = Math.max(this.hiScore || 0, data.data[key] || 0);
      } else {
        files[key] = data.data[key];
      }
    });
    // a full localStorage is cleared and tried once more (R-062)
    this.saveAppDataToStorage(files);
    this.globalData = true;
    this.hiScore = Math.max(this.hiScore || 0, ...this.readHallOfFame().map((item) => item.score || 0));
    this.refreshMenu();
  } // setData

  errorData(error) {
    console.error(error.message ? error.message : error);
    if (!this.loadGlobalDataFromStorage()) {
      this.dataError = 'GAME DATA COULD NOT BE LOADED FROM THE SERVER';
    }
    this.refreshMenu();
  } // errorData

  /**
   * The menu opened before the data came: it is built again with the
   * picture, or told what is missing.
   */
  refreshMenu() {
    if (this.model && this.model.id == 'MenuModel') {
      this.setModel('MenuModel');
      if (this.dataError) {
        this.showErrorMessage(this.dataError);
      }
    }
  } // refreshMenu

  showErrorMessage(message, action) {
    console.error(message);
    if (this.model && this.model.showNotice) {
      this.model.showNotice(message, action);
    }
  } // showErrorMessage

} // GameApp
