const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
// begin code

/**
 * ABOUT GAME as a panel over the menu: what the project is, the version and
 * the copyright. Internal project (`ZADANI.md` §0) — the text says so.
 * CLOSE (Escape, GamepadExit, Enter) takes it down.
 */
export class AboutEntity extends AbstractEntity {

  constructor(parentEntity, x, y, width, height) {
    super(parentEntity, x, y, width, height, false, '#000000e0');
    this.id = 'AboutEntity';

    this.aboutText = 'SUPER R-TYPE IS AN INTERNAL REMAKE OF THE 1991 SUPER NINTENDO GAME BY IREM — THE FIRST GAME ON THE SUPER NINTENDO PLATFORM OF THE SVISION LIBRARY.\n' +
                     'R-TYPE IS A TRADEMARK OF IREM. THIS BUILD IS NOT DISTRIBUTED: IT EXISTS TO DEVELOP AND TEST THE PLATFORM AND TO CARRY THE REMAKE METHOD ONTO THE 65C816.\n' +
                     'THE PICTURE BEHIND THIS PANEL IS THE ORIGINAL\'S OWN VIDEO MEMORY, DRAWN BY THE LIBRARY\'S MODEL OF ITS PICTURE PROCESSOR.';
  } // constructor

  init() {
    super.init();
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 0, 4, this.width, 7, 'ABOUT GAME', '#f7d642', false, {align: 'center'}));
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 8, 16, this.width-16, this.height-50, this.aboutText, '#ffffff', false, {align: 'left', textWrap: true, lineSpacing: 2}));
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 8, this.height-30, this.width-16, 7, 'V'+this.app.version+'  '+this.app.copyright, '#9c9c9c', false, {align: 'center'}));
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, this.width/2-20, this.height-18, 40, 13, 'CLOSE', {id: 'closeAbout'}, ['Escape', 'GamepadExit', 'Enter', 'GamepadOK'], '#ffffff', '#424242', {align: 'center', margin: 4, hoverColor: '#5a5a5a', clickColor: '#7a7a7a'}));
  } // init

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'closeAbout':
        this.destroy();
        return true;
      case 'keyPress':
        if (event.key == 'Mouse1' || event.key == 'Touch') {
          return true;   // the panel swallows what is under it
        }
        break;
    }
    return false;
  } // handleEvent

} // AboutEntity
