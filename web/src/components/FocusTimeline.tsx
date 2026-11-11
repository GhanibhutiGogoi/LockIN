import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Deck, FocusLogEntry, RescueOutcome } from '../contracts/types';

/**
 * Focus over the session. Fills the box its parent gives it, so the report
 * can fit the whole session into the first view. No y-axis, legend or
 * threshold labels: the shape carries it, and the crosshair names any moment.
 * A minute-by-minute table is there for screen readers.
 */
export function FocusTimeline({ samples, rescues, deck, sessionStart }: { samples: FocusLogEntry[]; rescues: RescueOutcome[]; deck: Deck; sessionStart: number }) {
  // drawn at the size it is shown, so tick labels stay at their real 13px on a phone too
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(1200);
  const [H, setH] = useState(300);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      setW(Math.max(280, Math.round(el.clientWidth)));
      setH(Math.max(160, Math.round(el.clientHeight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const narrow = W < 640;
  const M = { l: 0, r: 0, t: 10, b: 28 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  // downsample to ≤ 400 points with a per-bucket mean so long sessions stay light
  const pts = useMemo(() => {
    if (samples.length <= 400) return samples;
    const step = samples.length / 400;
    const out: FocusLogEntry[] = [];
    for (let i = 0; i < 400; i++) {
      const slice = samples.slice(Math.floor(i * step), Math.floor((i + 1) * step));
      out.push({ ...slice[slice.length >> 1], score: slice.reduce((a, b) => a + b.score, 0) / slice.length });
    }
    return out;
  }, [samples]);

  // the axis ends where the session ended, so a short session isn't padded with empty time
  const tMax = Math.max(10, samples.at(-1)?.t ?? 10);
  const x = (t: number) => M.l + (t / tMax) * pw;
  const y = (v: number) => M.t + (1 - v / 100) * ph;

  const bands = useMemo(() => {
    const out: { from: number; to: number; kind: 'rescue' | 'away' }[] = [];
    let cur: { from: number; to: number; kind: 'rescue' | 'away' } | null = null;
    for (const s of samples) {
      const kind = s.state === 'lapse' || s.state === 'rescue' ? 'rescue' : s.state === 'paused' || s.state === 'break' ? 'away' : null;
      if (kind && cur && cur.kind === kind && s.t - cur.to <= 1) cur.to = s.t + 1;
      else {
        if (cur) out.push(cur);
        cur = kind ? { from: s.t, to: s.t + 1, kind } : null;
      }
    }
    if (cur) out.push(cur);
    return out;
  }, [samples]);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.state === 'paused' || p.state === 'break' ? 0 : p.score).toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${x(pts.at(-1)!.t)},${y(0)} L${x(pts[0].t)},${y(0)} Z` : '';

  // the smallest round step that keeps the axis to a handful of labels
  const maxTicks = narrow ? 5 : 9;
  const stepSec = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].find((s) => tMax / s < maxTicks) ?? 3600;
  const ticks: number[] = [];
  for (let t = 0; t <= tMax; t += stepSec) ticks.push(t);

  // one marker per lapse (the deeper second clip belongs to the same lapse)
  const lapseTimes = useMemo(
    () =>
      rescues
        .filter((r) => r.context.rescueInRow === 1)
        .map((r) => ({ t: Math.max(0, (r.startedAt - sessionStart) / 1000), slideIndex: r.context.slideIndex })),
    [rescues, sessionStart],
  );

  const hv = hover !== null ? samples[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = box.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = ((px - M.l) / pw) * tMax;
    if (!samples.length) return;
    let i = samples.findIndex((s) => s.t >= t);
    if (i < 0) i = samples.length - 1;
    setHover(i);
  }

  const fmt = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;

  const hvBand = hv ? bands.find((b) => hv.t >= b.from && hv.t < b.to) : undefined;

  return (
    <figure className="m-0 h-full">
      <div className="relative h-full" ref={wrap}>
        <svg
          ref={box}
          viewBox={`0 0 ${W} ${H}`}
          className="absolute inset-0 block h-full w-full touch-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Focus score over ${fmt(tMax)} minutes, with ${lapseTimes.length} lapses`}
        >
          {/* bands */}
          {bands.map((b, i) => (
            <rect key={i} x={x(b.from)} y={M.t} width={Math.max(2, x(b.to) - x(b.from))} height={ph} fill={b.kind === 'rescue' ? 'var(--lapse)' : 'var(--pencil)'} opacity={b.kind === 'rescue' ? 0.14 : 0.1} />
          ))}
          {/* series */}
          <path d={area} fill="var(--pen)" opacity={0.06} />
          <path d={line} fill="none" stroke="var(--pen)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* lapse markers */}
          {lapseTimes.map((l, i) => (
            <g key={i}>
              <line x1={x(l.t)} x2={x(l.t)} y1={M.t} y2={y(0)} stroke="var(--lapse)" strokeWidth={1.5} />
              <circle cx={x(l.t)} cy={M.t} r={5} fill="var(--lapse)" stroke="var(--paper)" strokeWidth={2} />
            </g>
          ))}
          {/* x axis */}
          <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--rule-strong)" />
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={H - 6} textAnchor={t === 0 ? 'start' : x(t) > W - 24 ? 'end' : 'middle'} fontSize={13} fill="var(--pencil)" className="num">
              {stepSec < 60 ? fmt(t) : `${t / 60}m`}
            </text>
          ))}
          {/* crosshair */}
          {hv && (
            <g pointerEvents="none">
              <line x1={x(hv.t)} x2={x(hv.t)} y1={M.t} y2={y(0)} stroke="var(--ink)" strokeWidth={1} opacity={0.5} />
              <circle cx={x(hv.t)} cy={y(hv.score)} r={5} fill="var(--pen)" stroke="var(--paper)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hv && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-xl bg-sheet px-3 py-2 text-[13px] shadow-[var(--shadow-float)]"
            style={{ left: `clamp(0px, calc(${(x(hv.t) / W) * 100}% - 70px), calc(100% - 160px))`, width: 160 }}
          >
            <div className="text-[15px] font-semibold">
              {hvBand?.kind === 'rescue' ? 'Lost you · clip' : hvBand?.kind === 'away' ? 'Paused' : <span className="num">{Math.round(hv.score)}</span>}
            </div>
            <div className="text-graphite">
              {fmt(hv.t)} · slide {hv.slideIndex + 1}
            </div>
            <div className="truncate text-pencil">{deck.slides[hv.slideIndex]?.title}</div>
          </div>
        )}
      </div>
      <div className="sr-only">
        <MinuteTable samples={samples} deck={deck} />
      </div>
    </figure>
  );
}

function MinuteTable({ samples, deck }: { samples: FocusLogEntry[]; deck: Deck }) {
  const rows: { m: number; avg: number; focused: number; slides: Set<number>; lapses: number }[] = [];
  for (const s of samples) {
    const m = Math.floor(s.t / 60);
    rows[m] ??= { m, avg: 0, focused: 0, slides: new Set(), lapses: 0 };
    const r = rows[m];
    r.avg += s.score;
    if (s.state === 'focused') r.focused++;
    if (s.state === 'lapse') r.lapses++;
    r.slides.add(s.slideIndex);
  }
  return (
    <div className="mt-3 max-h-64 overflow-auto rounded-lg bg-sheet">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 bg-sheet text-[13px] text-graphite">
          <tr>
            <th className="px-3 py-2 font-semibold">Minute</th>
            <th className="px-3 py-2 text-right font-semibold">Avg score</th>
            <th className="px-3 py-2 text-right font-semibold">Focused</th>
            <th className="px-3 py-2 font-semibold">Slides</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.filter(Boolean).map((r) => {
            const n = samples.filter((s) => Math.floor(s.t / 60) === r.m).length;
            return (
              <tr key={r.m} className="border-t border-rule">
                <td className="px-3 py-2">{r.m + 1}</td>
                <td className="px-3 py-2 text-right">{Math.round(r.avg / n)}</td>
                <td className="px-3 py-2 text-right">{Math.round((r.focused / n) * 100)}%</td>
                <td className="px-3 py-2 font-body">{[...r.slides].map((i) => deck.slides[i]?.title ?? i + 1).join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
