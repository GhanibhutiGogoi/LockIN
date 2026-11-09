/**
 * WebSocket attention provider. Lets the gaze-tracking team run their model as
 * a separate process (Python + MediaPipe, etc.) and stream samples into the UI.
 *
 * Server → UI   {"t":…, "score":…, "confidence":…, "signals":{…}}       (one FocusSample per message, ~10 Hz)
 *               {"type":"status","status":"running"|"error","detail":"…"}
 *               {"type":"calibrate_point_done","id":"…"}
 * UI → server   {"type":"start"} | {"type":"stop"}
 *               {"type":"calibrate_point","id":"…","x":0.1,"y":0.1}
 *               {"type":"finish_calibration"}
 *               {"type":"probe","t":…,"focused":true}
 */
import type { AttentionProvider, AttentionStatus, Unsubscribe } from '../../contracts/providers';
import type { CalibrationPoint, FocusSample } from '../../contracts/types';
import { camelize, checkSample } from '../../contracts/validate';
import { devlog } from '../../lib/devlog';

export class WsAttentionProvider implements AttentionProvider {
  readonly name: string;
  readonly needsCamera = false;
  private ws: WebSocket | null = null;
  private sampleSubs = new Set<(s: FocusSample) => void>();
  private statusSubs = new Set<(s: AttentionStatus, d?: string) => void>();
  private pending = new Map<string, () => void>();
  private warned = false;

  constructor(private url: string) {
    this.name = `WebSocket · ${url}`;
  }

  start(): Promise<void> {
    this.emit('starting');
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.emit('error', String(e));
        reject(e);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        this.emit('error', `No answer from ${this.url}`);
        reject(new Error(`No answer from ${this.url}. Is the gaze service running?`));
      }, 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'start' }));
        this.emit('running');
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        this.emit('error', `Could not connect to ${this.url}`);
        reject(new Error(`Could not connect to ${this.url}`));
      };
      ws.onclose = () => this.emit('stopped');
      ws.onmessage = (ev) => this.onMessage(ev.data);
    });
  }

  async stop() {
    try {
      this.ws?.send(JSON.stringify({ type: 'stop' }));
    } catch {
      /* ignore */
    }
    this.ws?.close();
    this.ws = null;
  }

  onSample(cb: (s: FocusSample) => void): Unsubscribe {
    this.sampleSubs.add(cb);
    return () => this.sampleSubs.delete(cb);
  }
  onStatus(cb: (s: AttentionStatus, d?: string) => void): Unsubscribe {
    this.statusSubs.add(cb);
    return () => this.statusSubs.delete(cb);
  }

  calibratePoint(p: CalibrationPoint): Promise<void> {
    const id = Math.random().toString(36).slice(2);
    this.ws?.send(JSON.stringify({ type: 'calibrate_point', id, x: p.x, y: p.y }));
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.delete(id)) resolve();
      }, 4000);
    });
  }
  async finishCalibration() {
    this.ws?.send(JSON.stringify({ type: 'finish_calibration' }));
  }
  reportProbe(t: number, focused: boolean) {
    this.ws?.send(JSON.stringify({ type: 'probe', t, focused }));
  }

  private emit(s: AttentionStatus, d?: string) {
    this.statusSubs.forEach((f) => f(s, d));
  }

  private onMessage(raw: unknown) {
    let msg: Record<string, unknown>;
    try {
      msg = camelize(JSON.parse(String(raw)));
    } catch {
      devlog.push({ team: 'attention', level: 'error', label: 'Message is not JSON', detail: String(raw).slice(0, 200) });
      return;
    }
    if (msg.type === 'status') {
      this.emit(msg.status as AttentionStatus, msg.detail as string | undefined);
      return;
    }
    if (msg.type === 'calibratePointDone') {
      const id = String(msg.id);
      this.pending.get(id)?.();
      this.pending.delete(id);
      return;
    }
    const sample = msg as unknown as FocusSample;
    sample.t ??= Date.now();
    const problems = checkSample(sample);
    if (problems.length) {
      if (!this.warned) devlog.push({ team: 'attention', level: 'error', label: 'Sample breaks the contract', detail: problems });
      this.warned = true;
      return;
    }
    this.sampleSubs.forEach((f) => f(sample));
  }
}
