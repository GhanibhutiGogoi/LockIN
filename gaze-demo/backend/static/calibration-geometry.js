/** Screen calibration stays anchored when the browser window changes. */
export function readCalibrationGeometry() {
  const w = globalThis.window ?? globalThis;
  const s = w.screen;
  return {
    width: w.innerWidth, height: w.innerHeight,
    screenWidth: s.width, screenHeight: s.height,
    windowX: w.screenX, windowY: w.screenY, pixelRatio: w.devicePixelRatio,
    fullscreen: !!document.fullscreenElement,
    screenLeft: Number.isFinite(s.availLeft) ? s.availLeft : null,
    screenTop: Number.isFinite(s.availTop) ? s.availTop : null,
  };
}

export function coversScreen(g) {
  return g.width > 0 && g.height > 0
    && Math.abs(g.width - g.screenWidth) <= 2 && Math.abs(g.height - g.screenHeight) <= 2;
}

export function changedGeometry(a, b, space = 'viewport') {
  const keys = space === 'screen'
    ? ['screenWidth', 'screenHeight', 'pixelRatio', 'screenLeft', 'screenTop']
    : Object.keys(a);
  return keys.filter(key => a[key] !== b[key]);
}
