import { useApp } from '../store';

export function DriftGlow() {
  const on = useApp(({ live }) => {
    if (live.noteTakingUntil !== null || !['drifting', 'recovering'].includes(live.state)) return false;
    if (!live.gazeTracking) return true;
    return !live.windowActive || live.gazeTracking.state === 'candidate' || live.gazeTracking.state === 'away';
  });
  return <div className="drift-glow" data-on={on} aria-hidden />;
}
