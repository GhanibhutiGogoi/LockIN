import type { TrackerCalibrationDiagnostics } from '../../../gaze-demo/backend/static/gaze.js';
import type { CalibrationTarget } from '../contracts/providers';
import type { CameraStatus } from './camera';

const KEY = 'lockin.pendingCalibrationDiagnostics';
const HISTORY_KEY = 'lockin.calibrationDiagnostics';
const ENDPOINT = '/v1/web-screen/calibration-diagnostics';

interface CalibrationPointProgress {
  mode: 'calibration' | 'validation' | 'quick-check';
  index: number;
  total: number;
  count: number;
  elapsedMs: number;
}

interface CalibrationDiagnostic {
  schemaVersion: 2;
  attemptId: string;
  startedAt: number;
  durationMs: number;
  outcome: 'passed' | 'failed' | 'skipped' | 'interrupted';
  stage: 'camera' | 'model' | 'calibration';
  cameraStatus: CameraStatus;
  cameraError: string | null;
  model: 'blazegaze' | 'eyetheia';
  viewport: { width: number; height: number; pixelRatio: number };
  points: CalibrationPointProgress[];
  tracker: TrackerCalibrationDiagnostics | null;
}

function pending(): CalibrationDiagnostic[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function savePending(items: CalibrationDiagnostic[]) {
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items.slice(-20)));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

async function upload(diagnostic: CalibrationDiagnostic) {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(diagnostic),
      keepalive: true,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    savePending(pending().filter((item) => item.attemptId !== diagnostic.attemptId));
    return true;
  } catch {
    return false;
  }
}

export async function flushCalibrationDiagnostics() {
  for (const diagnostic of pending()) {
    if (!await upload(diagnostic)) return;
  }
}

export function startCalibrationDiagnostic(model: CalibrationDiagnostic['model']) {
  const attemptId = crypto.randomUUID();
  const startedAt = Date.now();
  const start = performance.now();
  const viewport = { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio };
  const points: CalibrationPointProgress[] = [];
  let completed = false;

  return {
    point(target: CalibrationTarget | null) {
      if (!target || completed) return;
      const mode = target.recheck ? 'quick-check' : target.validation ? 'validation' : 'calibration';
      const progress = { mode, index: target.index, total: target.total, count: target.count, elapsedMs: Math.round(performance.now() - start) } as const;
      const previous = points.at(-1);
      if (previous?.mode === mode && previous.index === target.index) points[points.length - 1] = progress;
      else points.push(progress);
    },
    async finish(fields: Pick<CalibrationDiagnostic, 'outcome' | 'stage' | 'cameraStatus' | 'cameraError' | 'tracker'>) {
      if (completed) return;
      completed = true;
      const diagnostic: CalibrationDiagnostic = {
        ...fields, schemaVersion: 2, attemptId, startedAt, viewport, points, model, durationMs: Math.round(performance.now() - start),
      };
      // Keep completed diagnostics available even after a successful local upload.
      try {
        const history: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
        localStorage.setItem(HISTORY_KEY, JSON.stringify([...(Array.isArray(history) ? history : []), diagnostic].slice(-20)));
      } catch { /* The pending queue remains available if history storage fails. */ }
      const queued = savePending([...pending(), diagnostic]);
      if (await upload(diagnostic)) return 'saved';
      return queued ? 'queued' : 'failed';
    },
  };
}
