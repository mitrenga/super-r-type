const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { HallOfFameEntity } = await import('./hallOfFameEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The end of a game: GAME OVER, or the game left through the pause panel —
 * either way the score goes into the local hall of fame (**R-049**: a game
 * ended early keeps its score) and the list is shown, the new entry
 * highlighted. Any key, a click or a tap goes on to the next model (the
 * menu); so does a timeout.
 *
 * ★ The original's own GAME OVER screen and its flow (continue, the title)
 * come with M5 from its code; this screen is the remake's frame around it.
 */
export class GameOverModel extends AbstractModel {

  /** the screen goes on by itself after this many ms */
  static get TIMEOUT() { return 15000; }

  /**
   * @param {GameApp} app - The application.
   * @param {boolean} gameOver - True for GAME OVER, false for a game left early.
   * @param {string} nextModel - Where to go next.
   */
  constructor(app, gameOver, nextModel) {
    super(app);
    this.id = 'GameOverModel';
    this.gameOver = gameOver;
    this.nextModel = nextModel;
    this.listEntity = null;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false, false);
  } // newBorderEntity

  init() {
    super.init();
    this.desktopEntity.bkColor = '#000000';

    var score = this.app.score || 0;
    var index = score > 0 ? this.app.addToHallOfFame(score) : -1;

    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 0, 10, this.desktopWidth, 7,
      this.gameOver ? 'GAME OVER' : 'GAME ABANDONED', '#e73929', false, {align: 'center'}));
    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 0, 22, this.desktopWidth, 7,
      'SCORE '+score+'   HI-SCORE '+(this.app.hiScore || 0)+'   LEVEL '+this.app.level, '#ffffff', false, {align: 'center'}));

    this.listEntity = new HallOfFameEntity(this.desktopEntity, 24, 40, 208, 120, this.app.readHallOfFame(), index);
    this.desktopEntity.addEntity(this.listEntity);

    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 0, this.desktopHeight-16, this.desktopWidth, 7,
      'PRESS A KEY', '#9c9c9c', false, {align: 'center'}));
    this.sendEvent(GameOverModel.TIMEOUT, {id: 'closeHallOfFame'});
  } // init

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'closeHallOfFame':
        this.app.setModel(this.nextModel);
        return true;
      case 'keyPress':
        if (event.key == 'Mouse1' || event.key == 'Touch' || event.key == 'Escape' || event.key == 'Enter' || event.key == ' '
            || event.key == 'GamepadOK' || event.key == 'GamepadExit' || event.key == 'GamepadFire') {
          this.app.setModel(this.nextModel);
          return true;
        }
        break;
    }
    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);
    this.drawModel();
  } // loopModel

} // GameOverModel
