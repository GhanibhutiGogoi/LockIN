import { useState, type ReactNode } from 'react';

export function GazeTraceSetup({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  async function fullscreen() {
    setOpening(true);
    try {
      await document.documentElement.requestFullscreen();
      // Mount calibration after the fullscreen viewport has settled.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      setReady(true);
    } catch {
      setError('Fullscreen is unavailable. You can still record a window-relative trajectory.');
    } finally {
      setOpening(false);
    }
  }
  if (ready) return children;
  return <main className="mx-auto max-w-2xl px-6 py-16">
    <h1 className="text-3xl">Set up your gaze trajectory</h1>
    <p className="mt-5 text-graphite">Share your entire display and calibrate in fullscreen on that same display. After validation, gaze coordinates stay anchored to this screen. Use Alt+Tab to open WPS or another study app.</p>
    <p className="mt-3 text-graphite">Leaving fullscreen or resizing LockIn after calibration does not change screen coordinates. Changing displays, display scale or camera geometry requires recalibration. Keep LockIn open on its current tab; background sampling interruptions appear as gaps.</p>
    <p className="mt-3 text-graphite">Window mode records positions relative to the calibration window. It does not locate your gaze in other apps or on the whole display.</p>
    {error && <p role="alert" className="mt-4">{error}</p>}
    <div className="mt-7 flex flex-wrap gap-3">
      <button className="btn btn-primary" disabled={opening} onClick={() => void fullscreen()}>Calibrate in fullscreen</button>
      <button className="btn btn-quiet" disabled={opening} onClick={() => setReady(true)}>Use window coordinates</button>
    </div>
  </main>;
}
