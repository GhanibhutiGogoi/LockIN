import type { ScreenScene, TextBlock } from './types';
import type { ScreenTimeline } from './timeline';

interface Job { scene: ScreenScene; frame: Blob }

const MAX_WAITING_FRAMES = 4;

/** Keep bounded screenshots, preserving longer study visits over transient changes. */
export class ScreenProcessor {
  private queue: Job[] = [];
  private running?: Promise<void>;
  private labels: ScreenScene[] = [];
  private classifying?: Promise<void>;
  private controller = new AbortController();
  private sealed = false;

  constructor(private timeline: ScreenTimeline, private publish: (scene: ScreenScene) => void) {}

  enqueue(scene: ScreenScene, frame: Blob) {
    if (this.sealed) { scene.status = 'skipped'; scene.label = 'unavailable'; return; }
    if (this.queue.length >= MAX_WAITING_FRAMES) {
      const shortest = this.queue.reduce((best, job, index, jobs) =>
        job.scene.observedUntil - job.scene.timestamp < jobs[best].scene.observedUntil - jobs[best].scene.timestamp ? index : best, 0);
      const [dropped] = this.queue.splice(shortest, 1);
      dropped.scene.status = 'skipped';
      dropped.scene.label = 'unavailable';
      dropped.scene.message = 'OCR queue retained longer visits and the newest screen.';
    }
    this.queue.push({ scene, frame });
    this.pump();
  }

  private pump() {
    if (this.running || !this.queue.length) return;
    const current = this.queue.findIndex(job => job.scene === this.timeline.current);
    const index = this.sealed ? this.queue.reduce((best, job, i, jobs) =>
      job.scene.observedUntil - job.scene.timestamp > jobs[best].scene.observedUntil - jobs[best].scene.timestamp ? i : best, 0)
      : Math.max(0, current);
    const [job] = this.queue.splice(index, 1);
    this.running = this.process(job).finally(() => { this.running = undefined; this.pump(); });
  }

  private classifyNext() {
    if (this.classifying || !this.labels.length) return;
    const current = this.labels.indexOf(this.timeline.current!);
    const [scene] = this.labels.splice(Math.max(0, current), 1);
    this.classifying = this.classify(scene).finally(() => { this.classifying = undefined; this.classifyNext(); });
  }

  private async classify(scene: ScreenScene) {
    scene.classificationStartedAt = Date.now();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(35_000)]);
    try {
      const response = await fetch('/v1/web-screen/activity', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: this.timeline.goal, text: scene.text,
          ...(scene.blocks ? { blocks: scene.blocks, image: { width: scene.width, height: scene.height } } : {}) }), signal,
      });
      const result = response.ok ? await response.json() : {};
      signal.throwIfAborted();
      scene.label = ['related', 'off-topic', 'uncertain'].includes(result.label) ? result.label : 'unavailable';
      scene.studyText = typeof result.studyText === 'string' ? result.studyText : undefined;
      scene.classification = { reason: result.reason, rawDecision: result.rawDecision, evidence: result.evidence,
        contentFilter: result.contentFilter };
    } catch (error) {
      scene.label = 'unavailable';
      scene.message = error instanceof Error ? error.message : 'Screen classification failed.';
    }
    scene.classifiedAt = Date.now();
    this.publish(scene);
  }

  private async process({ scene, frame }: Job) {
    scene.processingStartedAt = Date.now();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(45_000)]);
    try {
      const health = await fetch('/v1/web-screen/status', { signal });
      if (!health.ok) throw new Error('Local OCR backend is unavailable. Start the OCR backend and retry.');
      const status = await health.json();
      if (status.status !== 'ready') throw new Error(status.message || 'OCR is still loading.');
      const response = await fetch('/v1/web-screen/text', {
        method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: frame, signal,
      });
      if (!response.ok) throw new Error('Screen text recognition failed.');
      const result = await response.json() as { lines: string[]; blocks?: TextBlock[]; durationMs?: number; image?: { width: number; height: number } };
      if (!Array.isArray(result.lines) || !result.lines.every(s => typeof s === 'string')) throw new Error('Invalid OCR response.');
      if (signal.aborted) throw new Error('Screen analysis cancelled.');
      scene.completedAt = Date.now();
      scene.ocrDurationMs = result.durationMs;
      scene.text = result.lines.join('\n').slice(0, 2400);
      scene.blocks = result.blocks?.filter(b => typeof b.text === 'string' && Number.isFinite(b.confidence)
        && Array.isArray(b.polygon) && b.polygon.length >= 3 && b.polygon.every(p => p.length === 2 && p.every(Number.isFinite)));
      // OCR boxes are expressed in the decoded image's pixel coordinates.
      if (result.image) { scene.width = result.image.width; scene.height = result.image.height; }
      scene.status = scene.text.trim() ? 'ready' : 'no-text';
      if (scene.status === 'no-text') scene.label = this.timeline.goal ? 'uncertain' : null;
      this.publish(scene);
      if (scene.status === 'ready' && this.timeline.goal) {
        // One OCR request and one classifier request may run concurrently.
        // A slow historical classification must not hold up the current screenshot.
        if (this.labels.length >= MAX_WAITING_FRAMES) {
          const [dropped] = this.labels.splice(0, 1);
          dropped.label = 'unavailable';
          dropped.message = 'Classification queue retained the newest screens.';
          this.publish(dropped);
        }
        this.labels.push(scene);
        this.classifyNext();
      }
    } catch (error) {
      scene.label = 'unavailable';
      if (scene.status !== 'ready') scene.status = 'error';
      scene.message = error instanceof Error ? error.message : 'Screen analysis failed.';
      scene.completedAt ??= Date.now();
    }
    this.publish(scene);
  }

  async finish(timeoutMs = 90_000) {
    this.sealed = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drain = async () => { while (this.running || this.classifying) await Promise.all([this.running, this.classifying]); };
    await Promise.race([drain(), new Promise<void>(resolve => {
      timer = setTimeout(() => { this.cancel(); resolve(); }, timeoutMs);
    })]);
    clearTimeout(timer);
    await Promise.all([this.running, this.classifying]);
  }

  cancel() {
    this.sealed = true;
    this.controller.abort();
    for (const { scene } of this.queue) { scene.status = 'skipped'; scene.label = 'unavailable'; scene.message = 'Session analysis deadline reached.'; }
    this.queue = [];
    for (const scene of this.labels) { scene.label = 'unavailable'; scene.message = 'Session analysis deadline reached.'; this.publish(scene); }
    this.labels = [];
  }
}
