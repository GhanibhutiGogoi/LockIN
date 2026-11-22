import { useMemo, useRef, useState } from 'react';
import { buildTracePlot, downloadTraceSvg, traceIntervals, TRACE_COLORS } from '../gazeTrace/plot';
import type { GazeTrace } from '../gazeTrace/types';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function GazeTraceReport({ trace, sessionId, durationMs }: { trace?: GazeTrace; sessionId: string; durationMs: number }) {
  const [selected, setSelected] = useState('');
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState<number | null>(null);
  const [smooth, setSmooth] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  const calibration = trace?.calibrations.find(c => c.id === selected) ?? trace?.calibrations[0];
  const duration = Math.max(durationMs, trace?.samples.at(-1)?.t ?? 0);
  const end = to ?? duration;
  const samples = useMemo(() => trace?.samples.filter(s => s.calibrationId === calibration?.id && s.t >= from && s.t <= end) ?? [], [trace, calibration, from, end]);
  const width = 1000;
  const height = calibration ? width * calibration.geometry.height / calibration.geometry.width : 562.5;
  const plot = useMemo(() => buildTracePlot(samples, smooth, width, height), [samples, smooth, height]);
  const valid = samples.filter(s => s.status === 'valid').length;
  const outside = samples.filter(s => s.status === 'outside').length;
  const geometryChanged = samples.some(s => s.reason === 'geometry_changed');
  const screenCoordinates = calibration?.coordinateSpace === 'screen';
  const geometryEvents = trace?.geometryEvents?.filter(e => e.calibrationId === calibration?.id) ?? [];
  const intervals = useMemo(() => traceIntervals(samples), [samples]);

  return <section className="mt-10 border-t border-rule pt-8" aria-labelledby="gaze-trace-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="gaze-trace-title" className="text-[24px]">Gaze trajectory</h2>
      {plot.first && <button className="btn btn-quiet btn-sm" onClick={() => svg.current && downloadTraceSvg(svg.current, sessionId)}>Download trajectory SVG</button>}
    </div>
    <p className="mt-3 text-graphite">Recorded independently of OCR and focus scores. Lines show estimated gaze movement, not proof of attention. Missing tracking, pauses and invalid measurements break the path.</p>
    {!calibration ? <p className="mt-5">No calibrated gaze coordinates were recorded. Complete gaze calibration with the camera enabled before a new screen session. Older reports do not include trajectories.</p> : <>
      <p className="mt-3 text-graphite">{screenCoordinates ? 'Screen coordinates fixed at calibration — app switches and browser resizing do not move the map.' : 'Window-relative calibration — not mapped to the whole display or other apps.'} Calibration area: {calibration.geometry.width} × {calibration.geometry.height} CSS pixels. Use the same display you shared; its identity is not automatically verified.</p>
      {calibration.validation && <p className="mt-2 text-sm text-graphite">Calibration validation error: mean {calibration.validation.meanErrorPx.toFixed(0)} px, maximum {calibration.validation.maxErrorPx.toFixed(0)} px. This is calibration error, not guaranteed accuracy during study.</p>}
      <div className="mt-5 flex flex-wrap items-center gap-5">
        {trace!.calibrations.length > 1 && <label>Calibration <select className="ml-2 rounded border p-1" value={calibration.id} onChange={e => setSelected(e.target.value)}>
          {trace!.calibrations.map((c, i) => <option key={c.id} value={c.id}>{i + 1} · {new Date(c.at).toLocaleTimeString()}</option>)}
        </select></label>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={smooth} onChange={e => setSmooth(e.target.checked)} />Smooth path</label>
        <span className="text-sm">{valid} valid · {outside} outside calibration area · {samples.length - valid - outside} invalid/stale samples</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-3">From {seconds(from)}<input className="min-w-0 flex-1" aria-label="Trajectory start time" type="range" min="0" max={duration} step="100" value={from} onChange={e => setFrom(Math.min(Number(e.target.value), end))} /></label>
        <label className="flex items-center gap-3">To {seconds(end)}<input className="min-w-0 flex-1" aria-label="Trajectory end time" type="range" min="0" max={duration} step="100" value={end} onChange={e => setTo(Math.max(Number(e.target.value), from))} /></label>
      </div>
      <svg className="mt-4 h-6 w-full" viewBox="0 0 1000 20" preserveAspectRatio="none" role="img" aria-label="Gaze recording availability across the session">
        <rect width="1000" height="20" fill="#e2e8f0" />
        {intervals.map((interval, i) => <rect key={i} x={interval.start / Math.max(1, duration) * 1000} width={Math.max(1, (interval.end - interval.start) / Math.max(1, duration) * 1000)} height="20" fill="#0369a1"><title>{seconds(interval.start)}–{seconds(interval.end)}</title></rect>)}
      </svg>
      <p className="mt-1 text-sm text-graphite">Session 0–{seconds(duration)}: blue shows recorded gaze in the selected range; grey shows time without drawable samples or outside the selection.</p>
      {geometryChanged && <p role="status" className="mt-4">{screenCoordinates ? 'Display or scale changed.' : 'Calibration window or display changed.'} Subsequent coordinates are excluded until recalibration.</p>}
      {!!geometryEvents.length && <p className="mt-3 text-sm text-graphite">{geometryEvents.length} geometry changes recorded ({geometryEvents.filter(e => !e.invalidates).length} compatible). Before/after values and changed fields are included in the downloaded report.</p>}
      {!!trace!.droppedSamples && <p className="mt-3">Storage limit reached: {trace!.droppedSamples} older samples were removed. The downloaded report contains the retained samples.</p>}
      {!plot.first ? <p className="mt-5">No drawable coordinates in this time range. Tracking may have been unavailable or outside the calibrated area.</p> : <svg
        ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox={`-30 -65 ${width + 60} ${height + 125}`}
        className="mt-5 w-full rounded-xl border border-rule" role="img" aria-label="Gaze movement in the calibrated viewport"
      >
        <title>Gaze trajectory · {seconds(from)}–{seconds(end)}</title>
        <desc>Estimated viewport coordinates; disconnected paths indicate missing or invalid measurements. No screenshot alignment or attention classification.</desc>
        <rect x="-30" y="-65" width={width + 60} height={height + 125} fill="#ffffff" />
        <text x="0" y="-36" fontSize="19" fill="#17202b">{screenCoordinates ? 'Fixed-screen' : 'Window-relative'} gaze · {seconds(from)}–{seconds(end)} · {smooth ? 'smoothed' : 'raw'}</text>
        <text x="0" y="-12" fontSize="14" fill="#475569">Top-left (0, 0) · calibration area {calibration.geometry.width} × {calibration.geometry.height} CSS px · no screen content overlay</text>
        <rect width={width} height={height} fill="#f8fafc" stroke="#94a3b8" />
        {[.25, .5, .75].map(n => <path key={n} d={`M${n * width},0V${height}M0,${n * height}H${width}`} stroke="#e2e8f0" fill="none" />)}
        {plot.paths.map((d, i) => <path key={i} data-gaze-path d={d} fill="none" stroke={TRACE_COLORS[i]} strokeWidth="2" strokeLinecap="round" opacity="0.85" />)}
        {[plot.first, plot.last].map((entry, i) => entry && <circle key={i} cx={entry.point.x * width} cy={entry.point.y * height} r="6" fill={i ? '#8039ad' : '#0369a1'} stroke="white" strokeWidth="2"><title>{i ? 'End' : 'Start'}: {seconds(entry.t)}</title></circle>)}
        <text x="0" y={height + 28} fontSize="16" fill="#0369a1">Start {seconds(plot.first.t)}</text>
        {TRACE_COLORS.map((color, i) => <rect key={color} x={width / 2 - 120 + i * 30} y={height + 12} width="30" height="14" fill={color} />)}
        <text x={width / 2} y={height + 46} textAnchor="middle" fontSize="14" fill="#475569">Earlier → Later · gaps are not interpolated</text>
        <text x={width} y={height + 28} textAnchor="end" fontSize="16" fill="#8039ad">End {seconds(plot.last!.t)}</text>
      </svg>}
    </>}
  </section>;
}
