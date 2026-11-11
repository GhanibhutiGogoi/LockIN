import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsAttentionProvider } from './attention';

class FakeWs {
  static OPEN = 1;
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWs.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWs.all = [];
  Object.assign(globalThis, { WebSocket: FakeWs });
});
afterEach(() => vi.useRealTimers());

describe('WsAttentionProvider', () => {
  it('completes a calibration point on calibrate_point_done', async () => {
    const p = new WsAttentionProvider('ws://x');
    const started = p.start();
    FakeWs.all[0].open();
    await started;
    let done = false;
    void p.calibratePoint({ x: 0.5, y: 0.5 }).then(() => (done = true));
    const { id } = JSON.parse(FakeWs.all[0].sent.at(-1)!);
    FakeWs.all[0].onmessage?.({ data: JSON.stringify({ type: 'calibrate_point_done', id }) });
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('closes the socket on connect timeout, so a late open does not start tracking', async () => {
    const p = new WsAttentionProvider('ws://x');
    const got: unknown[] = [];
    p.onSample((s) => got.push(s));
    const started = p.start().catch((e) => e);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await started).toBeInstanceOf(Error);
    const ws = FakeWs.all[0];
    expect(ws.closed).toBe(true);
    ws.open?.();
    ws.onmessage?.({ data: JSON.stringify({ t: 1, score: 50, confidence: 1 }) });
    expect(ws.sent).toHaveLength(0);
    expect(got).toHaveLength(0);
  });

  it('a second start closes the first socket', async () => {
    const p = new WsAttentionProvider('ws://x');
    const a = p.start();
    FakeWs.all[0].open();
    await a;
    const b = p.start();
    FakeWs.all[1].open();
    await b;
    expect(FakeWs.all[0].closed).toBe(true);
    await p.stop();
    expect(FakeWs.all[1].closed).toBe(true);
  });
});
