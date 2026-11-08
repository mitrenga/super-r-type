const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { ZXSettingsEntity } = await import('./svision/js/platform/canvas2D/zx/zxSettingsEntity.js?ver='+window.srcVersion);
const { ZXDialogEntity } = await import('./svision/js/platform/canvas2D/zx/zxDialogEntity.js?ver='+window.srcVersion);
const { ZXDialogProperties } = await import('./svision/js/platform/canvas2D/zx/zxDialogProperties.js?ver='+window.srcVersion);
const { SNESPPUEntity } = await import('./svision/js/platform/canvas2D/snes/snesPPUEntity.js?ver='+window.srcVersion);
const { ScreenLoader } = await import('./screenLoader.js?ver='+window.srcVersion);
const { LevelLoader } = await import('./levelLoader.js?ver='+window.srcVersion);
const { AboutEntity } = await import('./aboutEntity.js?ver='+window.srcVersion);
// begin code

/**
 * Main menu, the structure the sibling remakes share, with the two choices
 * the original's own SELECT SCENE offers (★ manual p. 5-6):
 *
 * - **LEVEL** — NOVICE, EASY, NORMAL or HARD (★ the US cartridge starts on
 *   EASY, `sources/docs/disasm_notes.md` §4)
 * - **SOUND** — STEREO or NORMAL
 * - START GAME, SETTINGS (the controls, in the dialog entities of the
 *   library) and ABOUT GAME (a panel). No SOUNDS: the chip is M6. No hall of
 *   fame item: the local list shows at the end of a game (`ZADANI.md` §0).
 *
 * The menu sits on the original's own title picture — its VRAM, CGRAM and
 * OAM as recorded by `tools/mkscreen.py --title` (`data/screen_title.json`),
 * drawn by the library's PPU — the way the game sits on its own frame.
 */
export class MenuModel extends AbstractModel {

  constructor(app, selectionItem) {
    super(app);
    this.id = 'MenuModel';

    var c = app.constructor.COLORS;
    this.menuItems = [
      {t1: 'START GAME', event: {id: 'startGame'}, penColor: c.yellow},
      {t1: 'LEVEL', event: {id: 'cycle', key: 'level'}, penColor: c.white},
      {t1: 'SOUND', event: {id: 'cycle', key: 'sound'}, penColor: c.white},
      {t1: 'SETTINGS', event: {id: 'setSettings'}, penColor: c.blue},
      {t1: 'ABOUT GAME', event: {id: 'showAbout'}, penColor: c.grey}
    ];
    this.menuOptions = {
      fonts: this.app.fonts.fonts5x5,
      leftMargin: 4,
      rightMargin: 4,
      topMargin: 6,
      itemHeight: 11,
      t1LeftMargin: 3,
      t1TopMargin: 3,
      t2Width: 60,
      t2RightMargin: 3,
      t2TopMargin: 3,
      textColor: c.white,
      selectionTextColor: c.black,
      selectionBarColor: false,
      hoverColor: c.hover,
      selectionHoverColor: false,
      clickColor: c.click,
      selectionClickColor: false,
      selection: selectionItem || 0
    };
    // the dialogs of the menu: a dark window with a yellow title, the
    // contents of the library coloured in the remake's colours; laid out for
    // 200 x 124 px, like the siblings'
    this.dialogProperties = ZXDialogProperties.merge({
      x: 28,
      y: 48,
      width: 200,
      height: 130,
      frameWidth: 0,
      titleColor: c.yellow,
      bkColor: '#000000f0',
      theme: {
        penColor: c.white,
        valueColor: c.blue,
        selectionColor: c.yellow,
        selectionPenColor: c.black,
        hoverColor: c.hover,
        clickColor: c.click,
        separatorColor: c.grey,
        iconColor: c.blue,
        buttonColor: c.darkGrey,
        buttonHoverColor: '#5a5a5a',
        closeButtonColor: '#6b2a2a',
        okButtonColor: '#2a6b2a',
        dangerButtonColor: '#8c2a2a',
        sliderColor: c.white
      },
      clipsChildren: false,
      remapKeys: {
        x: 0,
        y: -9,
        width: 200,
        height: 130,
        frameWidth: 0,
        titleColor: c.yellow,
        bkColor: '#000000f0',
        theme: {
          penColor: c.white,
          valueColor: c.blue,
          selectionColor: c.yellow,
          selectionPenColor: c.black
        }
      }
    });

    this.screenEntity = null;
    this.menuEntity = null;
    this.versionEntity = null;
    this.noticeEntity = null;
    this.dialogEntity = null;
    this.aboutEntity = null;
    this.newVersionAvailable = false;
    this.attract = false;
    this.tiles = null;
    this.palettes = null;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false, false);
  } // newBorderEntity

  init() {
    super.init();
    this.desktopEntity.bkColor = '#000000';

    // the data files: at once from localStorage, or from the server when they
    // are missing there (R-062); before appData has come the menu is built
    // without them and built again when it comes (GameApp.refreshMenu)
    if (this.app.globalData) {
      this.loadDataFiles(['screen_title', 'levels', 'tiles', 'palettes', 'screen'], (files, error) => this.initData(files, error));
    } else {
      this.initData({});
    }
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
    // ★ the original's title picture under the menu, when the data are in
    var title = this.loadDataFile('screen_title');
    if (title && title.vram) {
      this.screenEntity = new SNESPPUEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight);
      this.desktopEntity.addEntity(this.screenEntity);
      try {
        ScreenLoader.apply(this.screenEntity.ppu, title);
      } catch (error) {
        console.error(error.message);
      }
    } else if (this.app.globalData) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8, this.desktopWidth-16, 20,
        'GAME DATA MISSING (data/screen_title.json). RUN tools/mkscreen.py --title.', '#e73929', false, {align: 'center', textWrap: true}));
    }

    // the menu window below the logo
    var menuHeight = 6+this.menuItems.length*11+6;
    this.menuEntity = new MenuEntity(this.desktopEntity, 64, 128, 128, menuHeight, '#000000c0', this.menuOptions, this, this.getMenuData);
    this.desktopEntity.addEntity(this.menuEntity);

    var versionWidth = 120;
    this.versionEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.fonts5x5, (this.desktopWidth-versionWidth)/2, this.desktopHeight-9, versionWidth, 7, 'v'+this.app.version, {id: 'upgradeApp'}, [], '#9c9c9c', false, {align: 'center'});
    this.desktopEntity.addEntity(this.versionEntity);
    this.versionEntity.hoverColor = false;
    this.versionEntity.clickColor = false;
    this.checkServerVersion();

    // the blink clock the remap dialog's cursor reads (330 ms, as the siblings)
    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData

  /**
   * ABOUT GAME shows the game's sections scrolling behind the panel (M2):
   * the worker runs the original's scroll over the cartridge's data, as in
   * the game, and this model puts its frames into the title's chip.
   */
  startAttract() {
    var levels = this.loadDataFile('levels');
    this.tiles = this.loadDataFile('tiles');
    this.palettes = this.loadDataFile('palettes');
    var scene = this.loadDataFile('screen');
    if (!this.screenEntity || !levels || !this.tiles || !this.palettes || !scene || !scene.registers) {
      return;
    }
    this.attract = true;
    ScreenLoader.writeRegisters(this.screenEntity.ppu, scene.registers);
    LevelLoader.hideSprites(this.screenEntity.ppu);
    // the scroll alone (the attract mode of the worker, M2): `data` without the ship's files
    this.app.worker.postMessage({id: 'init', initData: {headless: false, seed: 1, hiScore: 0, level: this.app.level, sound: this.app.sound,
                                                        data: {levels: levels}, section: 0}});
  } // startAttract

  /** back to the original's title picture */
  stopAttract() {
    if (!this.attract) {
      return;
    }
    this.attract = false;
    this.app.worker.postMessage({id: 'reset'});
    var title = this.loadDataFile('screen_title');
    if (this.screenEntity && title && title.vram) {
      ScreenLoader.apply(this.screenEntity.ppu, title);
    }
  } // stopAttract

  handleWorkerMessage(event) {
    var data = event.data;
    if (!this.attract || !this.screenEntity || data.id != 'frame') {
      return;
    }
    if (data.sectionStart) {
      LevelLoader.loadSection(this.screenEntity.ppu, data.sectionStart, this.tiles, this.palettes);
    }
    LevelLoader.applyFrame(this.screenEntity.ppu, data);
    this.screenEntity.ppu.touch();
  } // handleWorkerMessage

  shutdown() {
    this.stopAttract();
    super.shutdown();
  } // shutdown

  checkServerVersion() {
    var receiver = {
      id: this.id+'Version',
      fetchDataId: '',
      setData: (data) => {
        if (data.data.version && data.data.version !== 'unknown' && data.data.version !== this.app.version) {
          this.newVersionAvailable = true;
          if (this.dialogEntity === null) {
            this.showVersion();
          }
        }
      },
      errorData: () => {}
    };
    receiver.fetchDataId = this.app.fetchData('version.db', false, {}, receiver);
  } // checkServerVersion

  getMenuData(self, key, row) {
    switch (key) {
      case 'numberOfItems':
        return self.menuItems.length;
      case 't2':
        switch (row) {
          case 1: return self.app.level;
          case 2: return self.app.sound;
        }
        break;
      default:
        if (key in self.menuItems[row]) {
          return self.menuItems[row][key];
        }
        break;
    }
    return '';
  } // getMenuData

  openDialog(title, contentFactory) {
    var p = this.dialogProperties;
    this.dialogEntity = new ZXDialogEntity(this.desktopEntity, p.x, p.y, p.width, p.height, title, p, contentFactory);
    this.desktopEntity.addModalEntity(this.dialogEntity);
    this.versionEntity.setText('© 1991 IREM');
  } // openDialog

  showVersion() {
    if (this.newVersionAvailable) {
      this.versionEntity.setText('UPGRADE !');
      this.versionEntity.setPenColor('#f7d642');
    } else {
      this.versionEntity.setText('v'+this.app.version);
      this.versionEntity.setPenColor('#9c9c9c');
    }
  } // showVersion

  /**
   * A line of notice over the menu (the app's error messages).
   * @param {string} message - The text.
   */
  showNotice(message) {
    if (this.noticeEntity) {
      this.noticeEntity.setText(message.toUpperCase());
      return;
    }
    this.noticeEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 116, this.desktopWidth-16, 7, message.toUpperCase(), '#e73929', '#000000c0', {align: 'center'});
    this.desktopEntity.addEntity(this.noticeEntity);
  } // showNotice

  handleEvent(event) {
    if (event.id == 'destroy') {
      if (event.entity === this.dialogEntity) {
        this.dialogEntity = null;
        this.showVersion();
      }
      if (event.entity === this.aboutEntity) {
        this.aboutEntity = null;
        this.stopAttract();
      }
    }
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'startGame':
        this.app.startGame();
        return true;

      case 'cycle':
        // ★ LEVEL and SOUND — the original's own choices, cycled rather than
        // dialogs, as the original cycles them with the cross button
        this.app.cycleChoice(event.key);
        this.sendEvent(0, {id: 'refreshMenu'});
        return true;

      case 'setSettings':
        this.openDialog('SETTINGS', (dialog) => new ZXSettingsEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, this.app.controlsOptions, this.dialogProperties));
        return true;

      case 'showAbout':
        if (this.aboutEntity === null) {
          this.aboutEntity = new AboutEntity(this.desktopEntity, 16, 24, this.desktopWidth-32, this.desktopHeight-48);
          this.desktopEntity.addModalEntity(this.aboutEntity);
          this.startAttract();
        }
        return true;

      case 'upgradeApp':
        if (this.newVersionAvailable) {
          this.app.upgradeApp();
        }
        return true;

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;
    }
    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);
    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    } else if (this.menuEntity) {
      this.menuEntity.loopEntity(timestamp);
    }
    // R-037: a static screen redraws here, which costs nothing while nothing changed
    this.drawModel();
  } // loopModel

} // MenuModel
