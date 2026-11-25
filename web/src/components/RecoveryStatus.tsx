import { useApp, type RecoveryWait } from '../store';

const waiting: Record<RecoveryWait, string> = {
  tracking: 'Waiting for fresh gaze · keep LockIn visible beside your study window',
  'study-window': 'Open your shared study window to confirm your return',
  reading: 'Checking the shared page before confirming your return',
  'off-topic': 'Return to material related to your study goal',
  'look-at-screen': 'Look at your shared study page to confirm your return',
  notes: 'Taking notes · recovery check paused',
};

export function RecoveryStatus() {
  const { state, recoverProgress: progress, recoveryWait } = useApp(s => s.live);
  if (state !== 'recovering') return null;
  return (
    <div className="fade-in pointer-events-none absolute top-16 left-1/2 flex max-w-[90%] -translate-x-1/2 flex-col items-center justify-center gap-2 md:top-0 md:left-5 md:h-16 md:max-w-[50%] md:translate-x-0 md:items-start" role="status">
      <span className="text-[14px] font-semibold">{recoveryWait ? waiting[recoveryWait] : 'Locking back in · keep reading'}</span>
      {!recoveryWait && <span role="progressbar" aria-label="Return to study" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="block h-1 w-40 overflow-hidden rounded-full bg-rule-strong">
        <span className="block h-full rounded-full bg-ok transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
      </span>}
    </div>
  );
}
