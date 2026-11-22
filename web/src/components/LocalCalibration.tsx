import { useEffect, useRef, useState } from 'react';
import type { AttentionProvider, CalibrationTarget } from '../contracts/providers';
import { startCalibrationDiagnostic } from '../lib/calibrationDiagnostics';
import { cameraErrorName, type CameraStatus } from '../lib/camera';
import { ensureAttention, ensureCamera, stopCalibrationCamera, stopProvider } from '../session/engine';
import { actions, currentDeck } from '../store';

export function LocalCalibration({ provider, screenStudy = false }: { provider: AttentionProvider; screenStudy?: boolean }) {
  const [target, setTarget] = useState<CalibrationTarget | null>(null);
  const [message, setMessage] = useState('Starting the camera and gaze model…');
  const [error, setError] = useState(false);
  const [passed, setPassed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [skipping, setSkipping] = useState(false);
  const [diagnosticStatus, setDiagnosticStatus] = useState<'saved' | 'queued' | 'failed'>();
  const finishDiagnostic = useRef<(outcome: 'skipped') => void>(() => {});
  const activeRun = useRef<AbortController | null>(null);

  useEffect(() => {
    const run = new AbortController();
    activeRun.current = run;
    let diagnostic: ReturnType<typeof startCalibrationDiagnostic> | undefined;
    let stage: 'camera' | 'model' | 'calibration' = 'camera';
    let camera: CameraStatus = 'asking';
    const finish = (outcome: 'passed' | 'failed' | 'skipped' | 'interrupted') => {
      void diagnostic?.finish({
        outcome, stage, cameraStatus: camera, cameraError: stage === 'camera' ? cameraErrorName() : null,
        tracker: provider.calibrationDiagnostics?.() ?? null,
      }).then((status) => {
        if (!run.signal.aborted && status) setDiagnosticStatus(status);
      });
    };
    finishDiagnostic.current = finish;
    const pagehide = () => finish('interrupted');
    window.addEventListener('pagehide', pagehide, true);
    (async () => {
      // The initial development StrictMode mount is cleaned up before capture starts.
      await Promise.resolve();
      if (run.signal.aborted) return;
      if (provider.calibrationModel) diagnostic = startCalibrationDiagnostic(provider.calibrationModel);
      provider.prepareCalibration?.({ screenStudy });
      try {
        camera = await ensureCamera();
        run.signal.throwIfAborted();
        if (camera !== 'on') {
          finish('failed');
          provider.skipCalibration?.();
          await stopCalibrationCamera();
          if (run.signal.aborted) return;
          actions.setCalibrated(false);
          actions.toast(currentDeck().sourceType === 'screen'
            ? 'Camera unavailable. You can continue with screen text recognition.'
            : 'Camera unavailable. LockIn will track app switches.');
          actions.go('study');
          return;
        }
        stage = 'model';
        await ensureAttention();
        run.signal.throwIfAborted();
        stage = 'calibration';
        setMessage('Checking your calibration…');
        await provider.calibrate?.((point) => {
          diagnostic?.point(point);
          setTarget(point);
        }, run.signal);
        if (run.signal.aborted) return;
        finish('passed');
        actions.setCalibrated(true);
        setTarget(null);
        setMessage('Calibration and validation passed');
        setPassed(true);
      } catch (cause) {
        if (run.signal.aborted) return;
        finish('failed');
        actions.setCalibrated(false);
        setTarget(null);
        setMessage((cause as Error).message);
        setError(true);
      }
    })();
    return () => {
      window.removeEventListener('pagehide', pagehide, true);
      run.abort();
      finish('interrupted');
    };
  }, [attempt, provider, screenStudy]);

  async function retry() {
    setError(false);
    setDiagnosticStatus(undefined);
    setMessage('Preparing gaze calibration…');
    await stopProvider();
    setAttempt((n) => n + 1);
  }

  async function skip() {
    setSkipping(true);
    finishDiagnostic.current('skipped');
    activeRun.current?.abort();
    provider.skipCalibration?.();
    await stopCalibrationCamera();
    actions.setCalibrated(false);
    actions.go('study');
  }

  return (
    <div className="fixed inset-0 z-50 bg-paper" role="dialog" aria-modal="true" aria-label="Gaze calibration">
      {(!target || target.awaitingStart) && <div className="absolute top-[30%] left-1/2 w-[min(550px,calc(100%-32px))] -translate-x-1/2 text-center" aria-live="polite">
        <p className="text-[20px] font-semibold">
          {target ? (target.recheck ? 'Check your calibration' : target.validation ? 'Check the calibration on new points' : 'Prepare for gaze calibration') : message}
        </p>
        {passed && <>
          <p className="mt-3 text-[16px] text-graphite">Your gaze calibration is ready. Start studying when you are ready.</p>
          <button type="button" className="btn btn-primary mt-5" onClick={() => actions.go('study')}>Start learning</button>
        </>}
        {target && <>
          <p className="mt-3 text-[16px] text-graphite">Sit comfortably, keep your head still, and follow each dot with your eyes. <br /> No clicking is needed.</p>
          <p className="mt-3 text-[16px] text-graphite">There are {target.total} points. Keep looking at the center of each dot until it moves.</p>
          <button type="button" className="btn btn-primary mt-5" onClick={() => provider.startCalibrationStage?.()}>
            {target.recheck ? 'Start check' : target.validation ? 'Start validation' : 'Start calibration'}
          </button>
        </>}
        {target?.fallback && (
          <p className="mt-2 text-[14px] font-semibold text-lapse">
            {target.fallback === 'geometry' ? 'Camera or window changed. Full calibration required.' : 'Quick check did not pass. Full calibration required.'}
          </p>
        )}
        {error && diagnosticStatus && (
          <p className="mt-2 text-[14px] text-graphite">
            {diagnosticStatus === 'saved' ? 'Calibration diagnostics saved locally.'
              : diagnosticStatus === 'queued' ? 'Diagnostics saved in this browser. They will sync when the local service is available.'
              : 'Could not save calibration diagnostics.'}
          </p>
        )}
        {error && <button type="button" className="btn btn-primary mt-4" onClick={retry}>Try again</button>}
      </div>}
      {target && !target.awaitingStart && <CalibrationDot target={target} />}
      {!passed && <button type="button" className="link absolute bottom-8 left-1/2 -translate-x-1/2 text-[14px]" onClick={skip} disabled={skipping}>
        Continue without calibrated gaze
      </button>}
    </div>
  );
}

function CalibrationDot({ target }: { target: CalibrationTarget }) {
  return (
    <span className="absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-pen"
      role="img" aria-label={`Gaze point ${target.index} of ${target.total}`}
      style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }}>
      <span className="h-3 w-3 rounded-full bg-ink" />
    </span>
  );
}
