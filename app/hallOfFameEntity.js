const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The **local** hall of fame: the best scores kept in this browser
 * (`GameApp.readHallOfFame`, localStorage). The project is internal and
 * has no server side (`ZADANI.md` §0), so there is no public list and no
 * name dialog — the name is the `playerName` cookie, as the siblings keep
 * it. The entry just made is highlighted. CLOSE (Escape, Enter, a tap)
 * sends `closeHallOfFame` up.
 */
export class HallOfFameEntity extends AbstractEntity {

  /**
   * @param {AbstractEntity} parentEntity - The parent.
   * @param {number} x - Position.
   * @param {number} y - Position.
   * @param {number} width - Size.
   * @param {number} height - Size.
   * @param {Object[]} entries - `{name, score, level, date}`, highest first.
   * @param {number} highlight - The index to highlight, or -1.
   */
  constructor(parentEntity, x, y, width, height, entries, highlight) {
    super(parentEntity, x, y, width, height, false, '#000000e0');
    this.id = 'HallOfFameEntity';
    this.entries = entries || [];
    this.highlight = highlight === undefined ? -1 : highlight;
  } // constructor

  init() {
    super.init();
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 0, 4, this.width, 7, 'HALL OF FAME (THIS BROWSER)', '#f7d642', false, {align: 'center'}));
    var rows = Math.min(this.entries.length, 10);
    for (var i = 0; i < rows; i++) {
      var e = this.entries[i];
      var color = i === this.highlight ? '#f7d642' : '#ffffff';
      var y = 16+i*8;
      this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 8, y, 14, 7, String(i+1).padStart(2, ' ')+'.', '#9c9c9c', false, {align: 'right'}));
      this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 26, y, 70, 7, String(e.name || '').toUpperCase().substring(0, 12), color, false, {align: 'left'}));
      this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 100, y, 50, 7, String(e.score || 0), color, false, {align: 'right'}));
      this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 156, y, 40, 7, String(e.level || ''), '#9c9c9c', false, {align: 'left'}));
    }
    if (rows === 0) {
      this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 8, 24, this.width-16, 7, 'NO SCORES YET', '#9c9c9c', false, {align: 'center'}));
    }
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, this.width/2-20, this.height-18, 40, 13, 'CLOSE', {id: 'closeHallOfFame'}, ['Escape', 'GamepadExit', 'Enter', 'GamepadOK', ' '], '#ffffff', '#424242', {align: 'center', margin: 4, hoverColor: '#5a5a5a', clickColor: '#7a7a7a'}));
  } // init

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    if (event.id == 'keyPress' && (event.key == 'Mouse1' || event.key == 'Touch')) {
      this.sendEvent(0, 0, {id: 'closeHallOfFame'});
      return true;
    }
    return false;
  } // handleEvent

} // HallOfFameEntity
