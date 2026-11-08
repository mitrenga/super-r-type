const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The pause panel. ★ The original pauses on START (manual p. 6); RESUME /
 * EXIT under a panel is the remake's, as is Escape opening it — a browser
 * tab that loses focus has to stop somewhere (`ZADANI.md` §10.2). EXIT GAME
 * goes through the game over screen, so that a game left early keeps its
 * score (R-049).
 */
export class PauseGameEntity extends AbstractEntity {

  constructor(parentEntity, x, y, width, height, title, exitModel) {
    super(parentEntity, x, y, width, height, false, false);
    this.id = 'PauseGameEntity';

    this.title = title;
    this.exitModel = exitModel;
    this.menuItems = [
      {t1: 'RESUME GAME', event: {id: 'closePauseGame'}},
      {t1: 'EXIT GAME', event: {id: 'exitGame'}}
    ];
    this.menuOptions = {
      fonts: this.app.fonts.fonts5x5,
      leftMargin: 9,
      rightMargin: 9,
      topMargin: 6,
      itemHeight: 11,
      t1LeftMargin: 3,
      t1TopMargin: 3,
      t2Width: 40,
      t2RightMargin: 3,
      t2TopMargin: 3,
      textColor: '#000000',
      selectionTextColor: '#000000',
      selectionBarColor: '#9c9c9c',
      hoverColor: '#0000001e',
      selectionHoverColor: '#ffffff',
      clickColor: '#0000002e',
      selectionClickColor: '#ffffffff'
    };
  } // constructor

  init() {
    super.init();
    this.addEntity(new AbstractEntity(this, 0, 0, this.width, this.height, false, '#ffffff'));
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 0, 0, this.width, 9, this.title, '#424242', false, {align: 'center', margin: 2}));
    this.addEntity(new MenuEntity(this, 1, 8, this.width-2, this.height-9, '#e7e7e7', this.menuOptions, this, this.getMenuData));
  } // init

  getMenuData(self, key, row) {
    switch (key) {
      case 'numberOfItems':
        return self.menuItems.length;
      default:
        if (key in self.menuItems[row]) {
          return self.menuItems[row][key];
        }
        break;
    }
    return '';
  } // getMenuData

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'keyPress':
        switch (event.key) {
          case 'Escape':
          case 'GamepadExit':
            this.sendEvent(-1, 1, {id: 'continueGame'});
            this.destroy();
            return true;
        }
        break;
      case 'closePauseGame':
        this.sendEvent(-1, 1, {id: 'continueGame'});
        this.destroy();
        return true;
      case 'exitGame':
        this.app.setModel(this.exitModel);
        return true;
    }
    return false;
  } // handleEvent

} // PauseGameEntity
