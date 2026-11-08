const { SNESPlatform } = await import('./svision/js/platform/canvas2D/snes/snesPlatform.js?ver='+window.srcVersion);
// begin code

/**
 * A Super Nintendo on an NTSC television — the machine Super R-Type is
 * measured on (`ZADANI.md` §2, R-050: the US cartridge, 262 lines, ~60.1 Hz):
 * the 256×224 picture with pixels about 8:7 taller than wide, as a 4:3
 * television showed them, with no surround required: the console showed nothing around the
 * picture, so it may touch the edge of the element (what is left over by
 * the aspect fit stays black). The
 * aspect is an open point of R-050 the operator settles by eye; set
 * `pixelAspect: 1` for square pixels.
 */
export function appPlatform() {
  return new SNESPlatform({
    width: 256,
    height: 224,
    pixelAspect: 8/7,
    minimalBorder: 0
  });
} // appPlatform
