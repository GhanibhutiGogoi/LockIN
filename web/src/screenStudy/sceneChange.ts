/** Compare study content, ignoring peripheral toolbars and small cursor/clock changes. */
export function sceneChanged(previous: Uint8ClampedArray | undefined, current: Uint8ClampedArray, width = 256, height = 144) {
  if (!previous || previous.length !== current.length) return true;
  if (width * height * 4 !== current.length) return true;
  let changed = 0, compared = 0;
  const firstRow = Math.floor(height * .12), lastRow = Math.ceil(height * .94);
  for (let i = firstRow * width * 4; i < lastRow * width * 4; i += 4) {
    compared++;
    const delta = Math.abs(current[i] - previous[i]) + Math.abs(current[i + 1] - previous[i + 1]) + Math.abs(current[i + 2] - previous[i + 2]);
    if (delta > 60) changed++;
  }
  return changed / compared > .006;
}
