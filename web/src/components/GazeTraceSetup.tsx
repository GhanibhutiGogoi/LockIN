import { useState, type ReactNode } from 'react';

export function GazeTraceSetup({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  async function fullscreen() {
    setOpening(true);
    setError('');
    try {
      await document.documentElement.requestFullscreen();
      // Mount calibration after the fullscreen viewport has settled.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      setReady(true);
    } catch {
      setError('Could not enter fullscreen. Allow fullscreen in your browser, then try again to calibrate this display.');
    } finally {
      setOpening(false);
    }
  }
  if (ready) return children;
  return <main className="mx-auto max-w-2xl px-6 py-16">
    <h1 className="text-3xl">Calibrate once for this display</h1>
    <p className="mt-5 text-graphite">Calibrate in fullscreen on the display you’re sharing. Follow the dots, then complete the validation.</p>
    <p className="mt-4 font-semibold">After calibration, you can leave fullscreen, resize LockIn, and switch to WPS or another app without recalibrating.</p>
    <p className="mt-3 text-graphite">Stay on the same display with the same display scale and camera position. Changes to those require recalibration.</p>
    <p className="mt-3 text-graphite">Keep LockIn open in its current tab while you study.</p>
    {error && <p role="alert" className="mt-4">{error}</p>}
    <div className="mt-7 flex flex-wrap gap-3">
      <button className="btn btn-primary" disabled={opening} onClick={() => void fullscreen()}>Calibrate in fullscreen</button>
    </div>
  </main>;
}
