import { useEffect, useRef } from 'react';
import type { GameplayLoop } from '../contracts/types';

/**
 * Background loop under the explainer. Uses the video team's loop when it has a
 * URL; otherwise draws an original procedural loop so no game footage is needed.
 */
export function Gameplay({ loop, dim = false }: { loop?: GameplayLoop; dim?: boolean }) {
  if (loop?.url) {
    return (
      <video
        className="h-full w-full object-cover transition-[filter] duration-300"
        style={{ filter: dim ? 'brightness(0.45) saturate(0.7)' : undefined }}
        src={loop.url}
        autoPlay
        muted
        loop
        playsInline
        // start at a random point so it never feels repeated
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.duration) v.currentTime = Math.random() * v.duration;
        }}
      />
    );
  }
  return <ProceduralLoop type={loop?.type ?? 'runner'} dim={dim} />;
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, state: Record<string, unknown>) => void;

const PALETTE = ['#ff5a5f', '#ffb400', '#00c2a8', '#3d7bff', '#b45cff', '#f2f05a'];

const runner: Draw = (ctx, w, h, t) => {
  // dusk sky
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.45);
  sky.addColorStop(0, '#1a1036');
  sky.addColorStop(1, '#ff7a59');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.45);
  // sun
  ctx.fillStyle = '#ffd36b';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.42, w * 0.16, Math.PI, 0);
  ctx.fill();
  // ground
  ctx.fillStyle = '#16122b';
  ctx.fillRect(0, h * 0.45, w, h * 0.55);
  const hz = h * 0.45;
  const vx = w / 2;
  // lane lines converge on the vanishing point
  ctx.strokeStyle = '#ff5ab4';
  ctx.lineWidth = 2;
  for (const k of [-1.5, -0.5, 0.5, 1.5]) {
    ctx.beginPath();
    ctx.moveTo(vx + k * 6, hz);
    ctx.lineTo(vx + k * w * 0.42, h);
    ctx.stroke();
  }
  // scrolling cross ties
  const speed = 0.9;
  for (let i = 0; i < 14; i++) {
    const z = ((i / 14 + t * speed * 0.25) % 1) ** 2.2;
    const y = hz + z * (h - hz);
    ctx.strokeStyle = `rgba(255,90,180,${0.15 + z * 0.6})`;
    ctx.lineWidth = 1 + z * 3;
    ctx.beginPath();
    ctx.moveTo(vx - z * w * 0.65, y);
    ctx.lineTo(vx + z * w * 0.65, y);
    ctx.stroke();
  }
  // obstacles
  for (let i = 0; i < 4; i++) {
    const phase = (t * 0.32 + i * 0.27) % 1;
    const z = phase ** 2.4;
    const lane = [-1, 0, 1, 0][i];
    const y = hz + z * (h - hz);
    const x = vx + lane * z * w * 0.28;
    const s = 6 + z * w * 0.16;
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fillRect(x - s / 2, y - s * 0.8, s, s * 0.8);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - s / 2, y - s * 0.2, s, s * 0.2);
  }
  // runner: hops lanes on a beat
  const beat = Math.floor(t * 1.25);
  const lanes = [0, -1, 0, 1, 1, 0, -1, -1];
  const from = lanes[beat % lanes.length];
  const to = lanes[(beat + 1) % lanes.length];
  const f = Math.min(1, (t * 1.25 - beat) * 3);
  const lane = from + (to - from) * (1 - (1 - f) ** 3);
  const jump = Math.abs(Math.sin(t * Math.PI * 1.25)) * h * 0.05;
  const rx = vx + lane * w * 0.26;
  const ry = h * 0.86 - jump;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(rx, h * 0.9, w * 0.07, h * 0.012, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2f05a';
  roundRect(ctx, rx - w * 0.055, ry - h * 0.11, w * 0.11, h * 0.11, w * 0.05);
  ctx.fillStyle = '#16122b';
  ctx.fillRect(rx - w * 0.03, ry - h * 0.085, w * 0.06, h * 0.012);
};

const parkour: Draw = (ctx, w, h, t) => {
  ctx.fillStyle = '#9fd3ff';
  ctx.fillRect(0, 0, w, h);
  // far skyline
  for (let layer = 0; layer < 3; layer++) {
    const speed = [0.04, 0.09, 0.22][layer];
    const color = ['#7fb2e0', '#4f7fb3', '#1d2b45'][layer];
    const base = [0.55, 0.62, 0.72][layer];
    ctx.fillStyle = color;
    const bw = w * [0.14, 0.2, 0.42][layer];
    const off = (t * speed * w * 3) % bw;
    for (let x = -off, i = 0; x < w + bw; x += bw, i++) {
      const seed = Math.sin((i + Math.floor((t * speed * w * 3) / bw)) * 12.9898 + layer) * 43758.5453;
      const r = seed - Math.floor(seed);
      const top = h * (base - r * 0.12);
      if (layer === 2 && r < 0.25) continue; // gaps to jump
      ctx.fillRect(x + (layer === 2 ? bw * 0.08 : 0), top, bw * (layer === 2 ? 0.84 : 0.92), h - top);
    }
  }
  // runner bounces along the near roofs
  const x = w * 0.32;
  const y = h * 0.6 - Math.abs(Math.sin(t * 2.6)) * h * 0.08;
  ctx.fillStyle = '#ff5a5f';
  ctx.beginPath();
  ctx.arc(x, y, w * 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff5a5f';
  ctx.lineWidth = w * 0.022;
  ctx.lineCap = 'round';
  const legs = Math.sin(t * 14) * w * 0.035;
  ctx.beginPath();
  ctx.moveTo(x, y + w * 0.04);
  ctx.lineTo(x + legs, y + w * 0.12);
  ctx.moveTo(x, y + w * 0.04);
  ctx.lineTo(x - legs, y + w * 0.12);
  ctx.stroke();
};

const sand: Draw = (ctx, w, h, t, st) => {
  ctx.fillStyle = '#f3e6d6';
  ctx.fillRect(0, 0, w, h);
  const bx = w * 0.15;
  const bw = w * 0.7;
  const by = h * 0.25;
  const bh = h * 0.5;
  const cycle = 1.4;
  const k = (t % cycle) / cycle;
  const sliceCount = Math.floor(t / cycle);
  const sliceW = bw * 0.07;
  const consumed = (sliceCount % 10) * sliceW;
  // block in layers
  const layers = ['#ff8fb1', '#ffd36b', '#7fe0c4', '#8fb8ff', '#c79bff'];
  layers.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(bx + consumed, by + (bh / layers.length) * i, bw - consumed, bh / layers.length + 1);
  });
  // knife
  const kx = bx + consumed + sliceW;
  const ky = by - h * 0.12 + Math.min(1, k * 1.8) * (bh + h * 0.12);
  ctx.fillStyle = '#d9dde3';
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.lineTo(kx + w * 0.02, ky - h * 0.22);
  ctx.lineTo(kx - w * 0.01, ky - h * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(kx - w * 0.012, ky - h * 0.3, w * 0.028, h * 0.08);
  // falling slice crumbles into particles
  const parts = (st.parts as { x: number; y: number; vx: number; vy: number; c: string }[] | undefined) ?? [];
  if (k > 0.55 && st.lastSlice !== sliceCount) {
    st.lastSlice = sliceCount;
    for (let i = 0; i < 70; i++)
      parts.push({ x: bx + consumed + Math.random() * sliceW, y: by + Math.random() * bh, vx: -Math.random() * 1.5, vy: Math.random() * 2, c: layers[Math.floor(Math.random() * layers.length)] });
  }
  for (const p of parts) {
    p.vy += 0.35;
    p.x += p.vx;
    p.y = Math.min(h * 0.82, p.y + p.vy);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  st.parts = parts.slice(-900);
};

const marble: Draw = (ctx, w, h, t, st) => {
  ctx.fillStyle = '#10223a';
  ctx.fillRect(0, 0, w, h);
  const pegs: { x: number; y: number }[] = [];
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    const cols = 6;
    for (let c = 0; c < cols; c++) pegs.push({ x: w * ((c + (r % 2 ? 0.5 : 0.25)) / cols + 0.04), y: h * (0.12 + r * 0.085) });
  }
  ctx.fillStyle = '#4c6a92';
  for (const p of pegs) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, w * 0.012, 0, Math.PI * 2);
    ctx.fill();
  }
  const balls = (st.balls as { x: number; y: number; vx: number; vy: number; c: string }[] | undefined) ?? [];
  if (!st.next || t > (st.next as number)) {
    st.next = t + 0.35;
    balls.push({ x: w * (0.3 + Math.random() * 0.4), y: -10, vx: (Math.random() - 0.5) * 1, vy: 0, c: PALETTE[Math.floor(Math.random() * PALETTE.length)] });
  }
  const r = w * 0.028;
  for (const b of balls) {
    b.vy += 0.28;
    b.x += b.vx;
    b.y += b.vy;
    for (const p of pegs) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < r + w * 0.012) {
        const nx = dx / d;
        const ny = dy / d;
        const dot = b.vx * nx + b.vy * ny;
        b.vx = (b.vx - 2 * dot * nx) * 0.62 + (Math.random() - 0.5) * 0.6;
        b.vy = (b.vy - 2 * dot * ny) * 0.62;
        b.x = p.x + nx * (r + w * 0.012);
        b.y = p.y + ny * (r + w * 0.012);
      }
    }
    if (b.x < r || b.x > w - r) b.vx *= -0.8;
    ctx.fillStyle = b.c;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(b.x - r * 0.35, b.y - r * 0.35, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  st.balls = balls.filter((b) => b.y < h + 20);
};

const DRAWS: Record<string, Draw> = { runner, parkour, 'kinetic-sand': sand, marble };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function ProceduralLoop({ type, dim }: { type: string; dim: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw = DRAWS[type] ?? runner;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const state: Record<string, unknown> = {};
    const t0 = performance.now() - Math.random() * 20_000; // random start point
    let raf = 0;
    const frame = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, w, h, ((now - t0) / 1000) * (reduced ? 0.25 : 1), state);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [type]);
  return (
    <canvas
      ref={ref}
      className="block h-full w-full transition-[filter] duration-300"
      style={{ filter: dim ? 'brightness(0.45) saturate(0.7)' : undefined }}
      aria-hidden
    />
  );
}
