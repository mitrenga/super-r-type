const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { SpriteEntity } = await import('./svision/js/platform/canvas2D/spriteEntity.js?ver='+window.srcVersion);
const { SpriteTool } = await import('./svision/js/spriteTool.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The black surround of the television around the 256×224 picture: the
 * optional exit (X) button, the two halves used by the touch controls with
 * their icons, the FPS counter of a developer build (R-045: a game whose
 * picture is compared with the original pixel by pixel draws it into the
 * border, never over the picture) and the developer-mode banner.
 *
 * The surround is always black — the console has no border colour
 * (SNESPlatform) — so nothing here follows a register.
 */
export class BorderEntity extends AbstractEntity {

  constructor(enableExit, enableGameControls) {
    super(null, 0, 0, 0, 0, false, false);
    this.id = 'BorderEntity';

    this.enableExit = enableExit;
    this.enableGameControls = enableGameControls;

    this.escapeEntity = null;
    this.escapeScale = 2;

    this.leftControlEntity = null;
    this.rightControlEntity = null;
    this.leftIconEntity = null;
    this.rightIconEntity = null;
    this.gameControlIcons = false;
    this.fpsEntity = null;
    this.devModeNameEntity = null;
  } // constructor

  init() {
    super.init();

    if (this.enableExit) {
      if (this.app.layout.ratio > 2) {
        this.escapeScale = 1;
      }
      this.escapeEntity = new ButtonEntity(this, this.app.fonts.fonts5x5, 0, 0, this.escapeScale*7, this.escapeScale*7, 'X', {id: 'keyPress', key: 'Escape'}, [], '#ffffff', false, {scale: this.escapeScale, margin: 1, clickColor: '#7a7a7aff', hoverColor: '#3d3d3dff'});
      this.addEntity(this.escapeEntity);
    }

    if (this.enableGameControls) {
      this.leftControlEntity = new AbstractEntity(this, 0, 0, 0, 0, false, false);
      this.addEntity(this.leftControlEntity);
      this.rightControlEntity = new AbstractEntity(this, 0, 0, 0, 0, false, false);
      this.addEntity(this.rightControlEntity);

      this.leftIconEntity = new SpriteEntity(this, 0, 0, '#9c9c9c', false, 0, 0);
      this.leftIconEntity.hide = true;
      this.addEntity(this.leftIconEntity);
      this.rightIconEntity = new SpriteEntity(this, 0, 0, '#9c9c9c', false, 0, 0);
      this.rightIconEntity.hide = true;
      this.addEntity(this.rightIconEntity);
    }

    if (this.app.devModeName !== false) {
      // R-045: drawn / messages / ticks, in the border
      this.fpsEntity = new TextEntity(this, this.app.fonts.fonts3x3, 0, 0, 12*4, 4, '', '#9c9c9c', false, {align: 'right'});
      this.addEntity(this.fpsEntity);

      this.devModeNameEntity = new TextEntity(this, this.app.fonts.fonts5x5, 0, -7, 100, 7, '', false, false, {margin: 1});
      var cfgLen = this.app.devModeName.indexOf('}');
      this.devModeNameEntity.setText(this.app.devModeName.substring(cfgLen+1));
      var cfg = null;
      try {
        cfg = JSON.parse(this.app.devModeName.substring(1, cfgLen+1));
        Object.keys(cfg).forEach((item) => {
          this.devModeNameEntity[item] = cfg[item];
        });
      } catch (error) {
        console.error(error.message);
      }
      if (!cfg || !('width' in cfg)) {
        this.devModeNameEntity.width = this.devModeNameEntity.lineWidth(this.devModeNameEntity.text)+2;
      }
      this.addEntity(this.devModeNameEntity);
    }
  } // init

  /**
   * The FPS counter's text (R-045).
   * @param {string} text - `drawn/messages/ticks FPS`.
   */
  setFps(text) {
    if (this.fpsEntity) {
      this.fpsEntity.setText(text);
    }
  } // setFps

  /**
   * The icons of the touch controls for both halves of the screen.
   * @param {Object|false} left - The icon of the left half (`controlsOptions.touchscreen.icons`).
   * @param {Object|false} right - The icon of the right half.
   */
  setGameControlIcons(left, right) {
    if (!this.enableGameControls) {
      return;
    }
    this.gameControlIcons = !!(left && right);
    [{entity: this.leftIconEntity, icon: left},
     {entity: this.rightIconEntity, icon: right}].forEach((item) => {
      if (item.icon) {
        item.entity.setGraphicsData('compressedSpriteData' in item.icon
                                    ? SpriteTool.decode(item.icon.compressedSpriteData)
                                    : item.icon);
      }
    });
    this.layoutGameControlIcons();
  } // setGameControlIcons

  /**
   * Puts the icons into the border: beside the picture when the side border
   * is wide enough (a phone on its side), under it when the bottom one is
   * tall enough (upright); never over the picture.
   */
  layoutGameControlIcons() {
    if (!this.enableGameControls || !this.leftIconEntity || this.model == null) {
      return;
    }
    var icons = [this.leftIconEntity, this.rightIconEntity];
    if (!this.gameControlIcons || icons.some((icon) => icon.width == 0)) {
      icons.forEach((icon) => { icon.hide = true; });
      return;
    }
    var margin = 2;
    var beside = Math.max(...icons.map((icon) => icon.width))+2*margin;
    var below = Math.max(...icons.map((icon) => icon.height))+2*margin;
    if (this.model.borderWidth >= beside) {
      icons.forEach((icon, i) => {
        icon.x = (i == 0 ? 0 : this.width-this.model.borderWidth)
                 +Math.floor((this.model.borderWidth-icon.width)/2);
        icon.y = Math.floor((this.height-icon.height)/2);
        icon.hide = false;
      });
    } else if (this.model.borderHeight >= below) {
      var top = this.height-this.model.borderHeight;
      icons.forEach((icon, i) => {
        icon.x = Math.floor(this.width*(1+2*i)/4-icon.width/2);
        icon.y = top+Math.floor((this.model.borderHeight-icon.height)/2);
        icon.hide = false;
      });
    } else {
      icons.forEach((icon) => { icon.hide = true; });
    }
  } // layoutGameControlIcons

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'resizeModel':
        if (this.escapeEntity) {
          if (this.model.borderHeight < this.escapeScale*7) {
            this.escapeEntity.x = this.model.borderWidth+this.model.desktopEntity.width;
            this.escapeEntity.y = this.model.borderHeight;
          } else {
            this.escapeEntity.x = this.model.borderWidth+this.model.desktopEntity.width-this.escapeScale*7;
            this.escapeEntity.y = this.model.borderHeight-this.escapeScale*7;
          }
        }
        if (this.fpsEntity) {
          // the top right corner of the border, left of the X; over the picture only when there is no border at all
          this.fpsEntity.x = this.model.borderWidth+this.model.desktopEntity.width-this.fpsEntity.width-(this.escapeEntity ? this.escapeScale*7+2 : 0);
          this.fpsEntity.y = Math.max(this.model.borderHeight-5, 0);
        }
        if (this.enableGameControls) {
          var w = Math.floor(this.width/2);
          this.leftControlEntity.x = 0;
          this.leftControlEntity.y = 0;
          this.leftControlEntity.width = w;
          this.leftControlEntity.height = this.height;
          this.rightControlEntity.x = this.width-w;
          this.rightControlEntity.y = 0;
          this.rightControlEntity.width = w;
          this.rightControlEntity.height = this.height;
          this.layoutGameControlIcons();
        }
        if (this.devModeNameEntity) {
          this.devModeNameEntity.x = Math.floor((this.width-this.devModeNameEntity.width)/2);
          this.devModeNameEntity.y = Math.max(Math.floor((this.app.model.borderHeight-this.devModeNameEntity.height)/2), 0);
        }
        break;
    }
    return false;
  } // handleEvent

} // BorderEntity
