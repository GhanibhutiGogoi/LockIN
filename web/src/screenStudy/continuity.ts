/** A stable, nonblank navigation area links scrolls/page turns, not app switches.
 * The top-right is excluded because LockIn's floating timer lives there.
 * This is bounded evidence of continuity, never a permanent content label.
 */
export function sameReadingDocument(previous: Uint8ClampedArray | undefined, current: Uint8ClampedArray,
  width = 256, height = 144) {
  if (!previous || previous.length !== current.length || current.length !== width * height * 4) return false;
  let changed = 0, edges = 0, compared = 0;
  for (let y = 0; y < Math.floor(height * .12); y++) {
    for (let x = 1; x < Math.floor(width * .75); x++) {
      const i = (y * width + x) * 4;
      const delta = Math.abs(current[i] - previous[i]) + Math.abs(current[i + 1] - previous[i + 1])
        + Math.abs(current[i + 2] - previous[i + 2]);
      if (delta > 45) changed++;
      if (Math.abs(current[i] - current[i - 4]) + Math.abs(current[i + 1] - current[i - 3])
        + Math.abs(current[i + 2] - current[i - 2]) > 60) edges++;
      compared++;
    }
  }
  return edges > compared * .015 && changed <= compared * .003;
}
