import type { TracePoint, TraceSample } from './types';

export const TRACE_COLORS = ['#0369a1', '#036f9e', '#087f8c', '#16836b', '#657531', '#a85a24', '#b63759', '#8039ad'];

export function traceIntervals(samples: TraceSample[]) {
  const intervals: { start: number; end: number; segment: number }[] = [];
  for (const sample of samples) {
    if (sample.status !== 'valid') continue;
    const last = intervals.at(-1);
    if (last?.segment === sample.segment) last.end = sample.t;
    else intervals.push({ start: sample.t, end: sample.t, segment: sample.segment });
  }
  return intervals;
}

/** Bound SVG detail without connecting across missing or invalid observations. */
export function buildTracePlot(samples: TraceSample[], smooth: boolean, width: number, height: number) {
  const paths = TRACE_COLORS.map(() => '');
  const points: { point: TracePoint; t: number }[] = [];
  const stride = Math.max(1, Math.ceil(samples.length / 3000));
  const start = samples[0]?.t ?? 0;
  const duration = Math.max(1, (samples.at(-1)?.t ?? start) - start);
  let previous: TraceSample | null = null;
  let previousPoint: TracePoint | null = null;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const point = smooth ? sample.display : sample.raw;
    if (sample.status !== 'valid' || !point) { previous = null; previousPoint = null; continue; }
    const connected = previous && previous.segment === sample.segment && previous.calibrationId === sample.calibrationId;
    const next = samples[i + 1];
    if (connected && i % stride !== 0 && next?.status === 'valid' && next.segment === sample.segment) continue;
    const x = (point.x * width).toFixed(2), y = (point.y * height).toFixed(2);
    const bucket = Math.min(TRACE_COLORS.length - 1, Math.floor((sample.t - start) / duration * TRACE_COLORS.length));
    paths[bucket] += connected && previousPoint
      ? `M${(previousPoint.x * width).toFixed(2)},${(previousPoint.y * height).toFixed(2)}L${x},${y}`
      : `M${x},${y}l0.01,0`;
    points.push({ point, t: sample.t });
    previous = sample;
    previousPoint = point;
  }
  return { paths, first: points[0], last: points.at(-1) };
}

export function downloadTraceSvg(svg: SVGSVGElement, sessionId: string) {
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lockin-gaze-${sessionId}.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
