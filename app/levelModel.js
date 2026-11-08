const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { SNESPPUEntity } = await import('./svision/js/platform/canvas2D/snes/snesPPUEntity.js?ver='+window.srcVersion);
const { SNESJoypad } = await import('./svision/js/platform/canvas2D/snes/snesJoypad.js?ver='+window.srcVersion);
const { ScreenLoader } = await import('./screenLoader.js?ver='+window.srcVersion);
const { LevelLoader } = await import('./levelLoader.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen — from M3 **the game as the original plays it**: the
 * worker runs the original's code over the cartridge's data (the task
 * scheduler, the level manager, the ship and its weapons, the scroll, the
 * sprites, the palette animation, the lag frames — `gameWorker.js`) and
 * every frame sends what its NMI put into the chip (the OAM, the CGRAM, the
 * map blocks, the ship's tiles, the panel, the scroll registers) and what
 * the section's load did (the tiles, the brightness); this model puts it
 * into the library's PPU (`levelLoader.js`, `data/tiles.json`) and
 * `SNESPPUEntity` draws it. The picture's registers are the ones the
 * program writes at reset, taken from the recorded frame `data/screen.json`
 * (`screenLoader.js`). Nothing is drawn that is not the original's;
 * `tools/matchship.mjs` measures the game's memory against the running
 * original frame by frame, `tools/matchscreen.mjs` the composition pixel
 * by pixel. **M3 runs without enemies** (M4) and starts in the level's
 * first section, not with the launch from the mother ship (part 2 of M3).
 *
 * The worker (gameWorker.js, WORKER-PROTOCOL.md) keeps the clock of the
 * machine and ticks; this model routes the controls into it as the joypad
 * word and draws on what comes back. The picture is drawn **on the
 * worker's frame** and the model's loop only draws when a frame did not
 * (R-037, `needDraw`), so that from M3 the screen keeps step with the
 * world and still draws when the worker is paused. **R-045**: the dev
 * counter `drawn/messages/ticks FPS` goes into the border.
 *
 * The keyboard, a gamepad and the touchscreen make **one joypad word**
 * (`$4219:$4218`, SNESJoypad): the directions, fire → B (held, it charges
 * the beam), force → A; Escape — or the X in the border — pauses the worker
 * and puts up the pause panel.
 */
export class LevelModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'LevelModel';

    this.gameOver = false;
    /** the actions held, by name */
    this.controlsState = {left: false, right: false, up: false, down: false, fire: false, force: false};
    /** the pad the actions make */
    this.joypad = new SNESJoypad();
    this.worker = null;
    this.screenEntity = null;
    this.ppu = null;
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastFrame: false};
    this.heldTaps = {};
    /** R-037: raised by the loop, dropped by the frame handler */
    this.needDraw = true;
  } // constructor

  /** the pad button of every action of the remake (★ manual p. 6: B shoots, A toggles the Force) */
  static get BUTTONS() {
    return {left: 'Left', right: 'Right', up: 'Up', down: 'Down', fire: 'B', force: 'A'};
  }

  newBorderEntity() {
    return new BorderEntity(true, true);
  } // newBorderEntity

  init() {
    super.init();
    this.desktopEntity.bkColor = '#000000';

    // the data files: at once from localStorage, or from the server when they
    // are missing there (R-062)
    this.loadDataFiles(['screen', 'levels', 'tiles', 'palettes', 'ship', 'sprites', 'waves'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files. Runs inside init() when
   * they are in localStorage, later when they had to come from the server.
   * @param {Object|null} files - The data files, or null.
   * @param {Error} [error] - Why they are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
    }
    if (!this.initScreen()) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 0, 8*8, this.desktopWidth, 7, 'SUPER R-TYPE', '#ffffff', false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/screen.json, levels.json, tiles.json, palettes.json, ship.json, sprites.json, waves.json). RUN tools/mkscreen.py AND tools/dump*.py.', '#e73929', false, {align: 'center', textWrap: true}));
      return;
    }

    this.showTouchIcons();

    this.worker = this.app.worker;
    this.app.inputEventsManager.sendEventsActiveKeys('Press');
    this.sendWorkerMessage({
      id: 'init',
      initData: {
        headless: false,
        // ★ the original's own choices (manual p. 5-6)
        level: this.app.level,
        sound: this.app.sound,
        hiScore: this.app.hiScore,
        // ★ the seed of the game's randomness, from the first line of the project (../STANDARDS.md)
        seed: this.app.gameSeed || 1,
        // ★ the cartridge's data the worker runs the original's code over (gameKernel.js, ship.js, levelScroll.js…)
        data: this.data
      }
    });
  } // initData

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
  } // shutdown

  /**
   * The chip with the original's frame in it.
   * @returns {boolean} True when the screen was created.
   */
  initScreen() {
    var scene = this.loadDataFile('screen');
    this.data = {};
    var names = ['levels', 'tiles', 'palettes', 'ship', 'sprites', 'waves'];
    for (var i = 0; i < names.length; i++) {
      this.data[names[i]] = this.loadDataFile(names[i]);
      if (!this.data[names[i]]) {
        return false;
      }
    }
    this.tiles = this.data.tiles;
    if (!scene || !scene.registers || !this.data.levels.sections || !this.tiles.bg || !this.data.palettes.palettes
        || !this.data.ship.data || !this.data.sprites.records || !this.data.waves.sections) {
      return false;
    }
    this.screenEntity = new SNESPPUEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight);
    this.desktopEntity.addEntity(this.screenEntity);
    this.ppu = this.screenEntity.ppu;
    try {
      // ★ the registers the program writes at reset (mode 1, the bases, the layers), from the recorded frame
      ScreenLoader.writeRegisters(this.ppu, scene.registers);
      LevelLoader.hideSprites(this.ppu);
      this.ppu.touch();
    } catch (error) {
      console.error(error.message);
      return false;
    }
    return true;
  } // initScreen

  /**
   * Puts the worker's frame on the screen: what the NMI put into the chip
   * and what the pass did to it (`levelLoader.js`). A lag frame changes
   * nothing — the picture stands, as the original's does.
   * @param {Object} data - The worker's frame.
   */
  showFrame(data) {
    if (!this.ppu) {
      return;
    }
    if (data.panel) {
      this.app.score = data.panel.score || 0;
    }
    if (data.lag) {
      return;
    }
    LevelLoader.applyFrame(this.ppu, data, this.tiles);
    this.ppu.touch();
  } // showFrame

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  /**
   * Sets one action and sends the whole pad when it changed — the whole
   * word, because left and up held together are a diagonal, not a conflict.
   * @param {string} action - The control action.
   * @param {boolean} value - Pressed or released.
   */
  setControl(action, value) {
    if (!(action in this.controlsState) || this.controlsState[action] === value) {
      return;
    }
    this.controlsState[action] = value;
    this.joypad.set(LevelModel.BUTTONS[action], value);
    this.sendWorkerMessage({id: 'controls', joypad: this.joypad.word});
  } // setControl

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'exitGame':
        this.app.setModel('GameExitModel');
        return true;

      case 'blurWindow':
        this.pauseGame();
        return true;

      case 'continueGame':
        this.sendWorkerMessage({id: 'continue'});
        return true;

      case 'releaseTouchAction':
        if (this.heldTaps[event.action]) {
          this.heldTaps[event.action]--;
        }
        this.releaseTouchAction(event.action);
        return true;

      case 'keyPress':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          case 'Escape':
          case 'GamepadExit':
            this.pauseGame();
            return true;
          case 'Touch':
            if (this.borderEntity.leftControlEntity && this.borderEntity.leftControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.leftControlEntity;
              this.touchStart(event, 'left', this.borderEntity.leftControlEntity);
              return true;
            }
            if (this.borderEntity.rightControlEntity && this.borderEntity.rightControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.rightControlEntity;
              this.touchStart(event, 'right', this.borderEntity.rightControlEntity);
              return true;
            }
            break;
          case 'RetryTouch':
            this.setControl(event.action, true);
            return true;
        }
        var action = this.controlAction(key);
        if (action !== false) {
          this.setControl(action, true);
          return true;
        }
        break;

      case 'keyRelease':
        var releasedKey = event.key;
        if (releasedKey.length == 1) {
          releasedKey = releasedKey.toUpperCase();
        }
        if (releasedKey == 'Touch') {
          this.touchEnd(event);
          return true;
        }
        var releasedAction = this.controlAction(releasedKey);
        if (releasedAction !== false) {
          this.setControl(releasedAction, false);
          return true;
        }
        break;

      case 'keyMove':
        if (event.key == 'Touch') {
          this.touchMove(event);
          return true;
        }
        break;
    }

    return false;
  } // handleEvent

  /** pauses the worker and opens the pause panel */
  pauseGame() {
    if (this.desktopEntity.modalEntity || this.gameOver) {
      return;
    }
    this.sendWorkerMessage({id: 'pause'});
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 52, Math.round((this.desktopHeight-44)/2), 153, 44, 'PAUSE GAME', 'GameExitModel'));
  } // pauseGame

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        this.fps.workerFrames++;
        if (this.fps.lastFrame !== false && data.frame > this.fps.lastFrame) {
          this.fps.ticks += data.frame-this.fps.lastFrame;
        }
        this.fps.lastFrame = data.frame;
        this.showFrame(data);
        // the picture follows the world: drawn on the frame, and the loop
        // then knows it need not (R-037)
        this.drawModel();
        this.needDraw = false;
        break;
      case 'gameOver':
        if (!this.gameOver) {
          this.gameOver = true;
          this.app.score = data.score || this.app.score;
          this.app.setModel('GameOverModel');
        }
        break;
      case 'error':
        console.error(data.message);
        break;
    }
  } // handleWorkerMessage

  /**
   * Maps a key or gamepad event onto a control action: **only** the
   * configured keys (SETTINGS) and the gamepad's fixed names.
   * @param {string} key - The event key.
   * @returns {string|false} The action, or false.
   */
  controlAction(key) {
    var kb = this.app.controls.keyboard;
    var upper = (k) => (k && k.length == 1) ? k.toUpperCase() : k;
    switch (key) {
      case upper(kb.left): case 'GamepadLeft': return 'left';
      case upper(kb.right): case 'GamepadRight': return 'right';
      case upper(kb.up): case 'GamepadUp': return 'up';
      case upper(kb.down): case 'GamepadDown': return 'down';
      case upper(kb.fire): case 'GamepadFire': case 'GamepadOK': return 'fire';
      case upper(kb.force): case 'GamepadForce': return 'force';
    }
    return false;
  } // controlAction

  // ------------------------------------------------------------ the touchscreen

  touchHalf(side) {
    var ts = this.app.controlsOptions.touchscreen;
    return ts.halves[ts.types[this.app.controls.touchscreen.type][side].half];
  } // touchHalf

  showTouchIcons() {
    if (!this.app.controls.touchscreen.supported || !this.borderEntity) {
      return;
    }
    var icons = this.app.controlsOptions.touchscreen.icons;
    this.borderEntity.setGameControlIcons(icons[this.touchHalf('left').icon],
                                          icons[this.touchHalf('right').icon]);
  } // showTouchIcons

  touchZone(event, side, entity) {
    var half = this.touchHalf(side);
    var width = Math.max(entity.width, 1), height = Math.max(entity.height, 1);
    var rx = (event.x-(entity.parentX+entity.x))/width;
    var ry = (event.y-(entity.parentY+entity.y))/height;
    for (var z = 0; z < half.zones.length; z++) {
      var r = half.zones[z].rect;
      if (rx >= r[0] && rx <= r[0]+r[2] && ry >= r[1] && ry <= r[1]+r[3]) {
        return half.zones[z];
      }
    }
    return false;
  } // touchZone

  touchStart(event, side, entity) {
    var zone = this.touchZone(event, side, entity);
    var control = {side: side, entity: entity, action: false,
                   type: zone === false ? 'none' : zone.type,
                   control: zone === false ? false : zone.control,
                   actions: zone === false ? false : zone.actions,
                   tap: zone !== false && zone.type == 'button' && !!zone.tap,
                   since: this.app.now,
                   origin: {x: event.x, y: event.y},
                   at: {x: event.x, y: event.y}};
    this.app.inputEventsManager.touchesGameControls[event.identifier] = control;
    if (zone !== false && zone.type == 'button') {
      control.action = zone.action;
      this.setControl(zone.action, true);
    }
  } // touchStart

  touchEnd(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined) {
      return;
    }
    delete controls[event.identifier];
    if (control.action === false) {
      return;
    }
    var rest = this.app.controlsOptions.touchscreen.tapHoldTime-(this.app.now-control.since);
    if (control.tap && rest > 0) {
      this.heldTaps[control.action] = (this.heldTaps[control.action] || 0)+1;
      this.sendEvent(rest, {id: 'releaseTouchAction', action: control.action});
      return;
    }
    [].concat(control.action).forEach((action) => this.releaseTouchAction(action));
  } // touchEnd

  releaseTouchAction(action) {
    if (this.heldTaps[action]) {
      return;
    }
    var controls = this.app.inputEventsManager.touchesGameControls;
    var held = Object.keys(controls).some((id) => controls[id].action !== false
                                                  && [].concat(controls[id].action).indexOf(action) !== -1);
    if (!held) {
      this.setControl(action, false);
    }
  } // releaseTouchAction

  /**
   * The stick is absolute: the direction is where the finger moved to from
   * where it landed, with a dead zone of `joystickStep`; two directions at
   * once are a diagonal, as on the pad.
   * @param {Object} event - The touch event.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var axis = {x: false, y: false};
    if (event.x-control.origin.x < -step) { axis.x = control.actions.left; }
    if (event.x-control.origin.x > step) { axis.x = control.actions.right; }
    if (event.y-control.origin.y < -step) { axis.y = control.actions.up; }
    if (event.y-control.origin.y > step) { axis.y = control.actions.down; }
    var next = [axis.x, axis.y].filter((action) => action !== false);
    var previous = control.action === false ? [] : [].concat(control.action);
    if (previous.length == next.length && previous.every((action) => next.indexOf(action) !== -1)) {
      return;
    }
    control.action = next.length == 0 ? false : (next.length == 1 ? next[0] : next);
    previous.forEach((action) => {
      if (next.indexOf(action) === -1) {
        this.releaseTouchAction(action);
      }
    });
    next.forEach((action) => this.setControl(action, true));
  } // touchMove

  // ------------------------------------------------------------------- the loop

  /**
   * R-045: `drawn/messages/ticks FPS` in the border of a developer build.
   * @param {number} timestamp - What the animation loop was given.
   */
  updateFps(timestamp) {
    if (!this.borderEntity || !this.borderEntity.fpsEntity) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      this.borderEntity.setFps(Math.round(this.fps.frames*1000/elapsed)+'/'+Math.round(this.fps.workerFrames*1000/elapsed)+'/'+Math.round(this.fps.ticks*1000/elapsed)+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    this.updateFps(timestamp);
    // the frame handler drew and dropped the flag; when no frame came (a
    // pause, a modal), the loop draws instead (R-037)
    if (this.needDraw) {
      this.drawModel();
    }
    this.needDraw = true;
  } // loopModel

} // LevelModel
