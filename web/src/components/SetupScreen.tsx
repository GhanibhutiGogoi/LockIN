import { useCallback, useEffect, useState } from 'react';
import { getStream, requestCamera } from '../lib/camera';
import { plainText } from '../lib/demoDeck';
import { registry } from '../providers/registry';
import { actions, useApp, useDeck } from '../store';

/**
 * Recalibration, reached from Settings only: five dots, then 20 seconds of
 * reading. First use doesn't stop here; Study asks for the camera itself.
 */
export function SetupScreen() {
  const [step, setStep] = useState<'calibrate' | 'baseline'>('calibrate');
  const [ready, setReady] = useState(useApp.getState().camera === 'on');

  useEffect(() => {
    if (ready) return;
    let alive = true;
    (async () => {
      useApp.setState({ camera: 'asking' });
      const status = await requestCamera();
      if (!alive) return;
      useApp.setState({ camera: status });
      if (status === 'on') setReady(true);
      else {
        actions.toast('LockIn can’t see the camera, so there is nothing to calibrate.', 'error');
        actions.go('desk');
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready]);

  const finish = useCallback(() => {
    actions.setCalibrated(true);
    actions.go('study');
  }, []);
  const toBaseline = useCallback(() => setStep('baseline'), []);

  if (!ready) return null;
  if (step === 'calibrate') return <Calibrate onDone={toBaseline} onSkip={finish} />;
  return <Baseline onDone={finish} />;
}

// ───────── calibration ─────────

const DOTS = [
  { x: 0.5, y: 0.5 },
  { x: 0.06, y: 0.08 },
  { x: 0.94, y: 0.08 },
  { x: 0.94, y: 0.92 },
  { x: 0.06, y: 0.92 },
];

function Calibrate({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    let alive = true;
    const provider = registry.attention;
    (async () => {
      try {
        await provider.start(provider.needsCamera ? getStream() : null);
      } catch {
        /* calibration still runs on the UI side */
      }
      for (let k = 0; k < DOTS.length && alive; k++) {
        setI(k);
        await Promise.all([provider.calibratePoint?.(DOTS[k]), new Promise((r) => setTimeout(r, 1200))]);
      }
      if (alive) {
        await provider.finishCalibration?.();
        await provider.stop().catch(() => {});
        onDone();
      }
    })();
    return () => {
      alive = false;
      void provider.stop().catch(() => {});
    };
  }, [onDone]);

  const dot = DOTS[i];
  return (
    <div className="fixed inset-0 z-50 bg-paper" role="dialog" aria-modal="true" aria-label="Calibration">
      <div className="absolute top-[38%] left-1/2 w-[min(440px,calc(100%-32px))] -translate-x-1/2 text-center" style={{ opacity: i === 0 ? 0 : 1 }}>
        <p className="text-[20px] font-semibold">Look at the dot</p>
        <p className="num mt-1 text-[14px] text-graphite">
          {i + 1} of {DOTS.length}
        </p>
      </div>
      {i === 0 && (
        <p className="absolute top-[calc(50%+40px)] left-1/2 -translate-x-1/2 text-center text-[16px] text-graphite">
          Look at the dot. Keep your head where it usually is.
        </p>
      )}
      <span key={i} className="absolute h-0 w-0" style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }}>
        <span className="absolute -top-[22px] -left-[22px] h-[44px] w-[44px] rounded-full border-2 border-pen" style={{ animation: 'calib 1.2s var(--ease-out) forwards' }} />
        <span className="absolute -top-[7px] -left-[7px] h-[14px] w-[14px] rounded-full bg-ink" />
      </span>
      <button type="button" className="link absolute bottom-[max(24px,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 text-[14px]" onClick={onSkip}>
        Skip calibration
      </button>
      <style>{'@keyframes calib{from{transform:scale(1.6);opacity:.2}to{transform:scale(.4);opacity:1}}'}</style>
    </div>
  );
}

// ───────── 20 s reading baseline ─────────

function Baseline({ onDone }: { onDone: () => void }) {
  const deck = useDeck();
  const DURATION = 20;
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setT(s);
      if (s >= DURATION) {
        clearInterval(id);
        onDone();
      }
    }, 100);
    return () => clearInterval(id);
  }, [onDone]);
  const slide = deck.slides.find((s) => s.text.split(/\s+/).length > 25) ?? deck.slides[0];
  const passage = plainText(slide.text).replace(/^- /gm, '');

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-paper">
      <div className="fixed inset-x-0 top-0 h-1 bg-raised" role="progressbar" aria-label="Reading check" aria-valuemin={0} aria-valuemax={DURATION} aria-valuenow={Math.round(t)}>
        <div className="h-full bg-ink" style={{ width: `${(t / DURATION) * 100}%` }} />
      </div>
      <div className="mx-auto max-w-[680px] px-[max(20px,env(safe-area-inset-left))] pt-[14vh] pb-16 pr-[max(20px,env(safe-area-inset-right))]">
        <p className="text-[15px] text-graphite">
          Read normally · <span className="num">{Math.max(0, Math.ceil(DURATION - t))} s</span>
        </p>
        <h1 className="mt-6 text-[clamp(28px,3vw,36px)]">{slide.title}</h1>
        <div className="mt-5 grid gap-3 text-[20px] leading-[1.6]">
          {passage.split('\n').map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <button type="button" className="link mt-12 text-[15px]" onClick={onDone}>
          Skip
        </button>
      </div>
    </div>
  );
}
