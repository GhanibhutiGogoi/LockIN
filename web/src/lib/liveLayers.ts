/** Narration is the only clock. Decorative layers never advance a blocked recap. */
export function liveLayers(master: HTMLMediaElement, game: HTMLMediaElement, music: HTMLMediaElement, muted: boolean) {
  let disposed = false;
  let active = false;
  let suspended = true;
  const layers = [game, music];
  game.muted = true; game.loop = true;
  music.volume = 0.12; music.muted = muted; music.loop = true;
  const pause = () => layers.forEach(layer => layer.pause());
  const align = () => {
    for (const layer of layers) {
      if (!Number.isFinite(layer.duration) || layer.duration <= 0) continue;
      const target = master.currentTime % layer.duration;
      if (Math.abs(layer.currentTime - target) > 0.3) layer.currentTime = target;
    }
  };
  const start = () => {
    active = true; suspended = false; align();
    for (const layer of layers) {
      // A missing background must not stop an otherwise playable explanation.
      void layer.play().then(() => { if (disposed || suspended) layer.pause(); }, () => {});
    }
  };
  const wait = () => { suspended = true; pause(); };
  const resume = () => { if (active && !disposed) start(); };
  master.addEventListener('waiting', wait);
  master.addEventListener('pause', wait);
  master.addEventListener('playing', resume);
  master.addEventListener('timeupdate', align);
  return {
    start,
    pause: wait,
    setMuted(value: boolean) { music.muted = value; },
    stop() {
      disposed = true; active = false; wait();
      master.removeEventListener('waiting', wait);
      master.removeEventListener('pause', wait);
      master.removeEventListener('playing', resume);
      master.removeEventListener('timeupdate', align);
    },
  };
}
