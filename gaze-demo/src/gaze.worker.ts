import {faceTensor} from './core/expression-input';
import * as tf from '@tensorflow/tfjs';
import WebEyeTrack from '../vendor/webeyetrack/WebEyeTrack';
import type { GazeResult } from '../vendor/webeyetrack/types';
import { EyeTheiaTracker } from './core/eyetheia';
import { featuresFrom, quantile, fitEnvelope, outsideEvidence, type Envelope } from './rules';

type WorkerGazeResult = GazeResult | Awaited<ReturnType<EyeTheiaTracker['step']>>;
let tracker: WebEyeTrack | EyeTheiaTracker;
let busy = false;
let expressionEnabled=false;
let point: { index: number; x: number; y: number; start: number; startedAt?: number; calibrationId?: number; captureRound?: number; validation: boolean; samples: WorkerGazeResult[]; features: number[][] } | null = null;
let supports: { result: WorkerGazeResult; x: number; y: number }[] = [];
let baseline: number[][] = [];
let lastSample = 0;
let screenEnvelope: Envelope | null = null;
let calibrationId: number | undefined;

function send(type: string, payload: object = {}) { self.postMessage({ type, ...payload }); }
// Reset/adaptation/filter changes must not interleave with asynchronous inference.
// The capture adapter sends at most one frame at a time, keeping this queue bounded.
let operations = Promise.resolve();
self.onmessage = ({ data }) => { operations = operations.then(() => handle(data)); };
async function handle(data: any) {
  try {
    if (data.type === 'init') {
      expressionEnabled=data.expression===true;
      send('loading', { message: '正在加载本地预训练模型…' });
      const model = data.model === 'eyetheia' ? 'eyetheia' : 'blazegaze';
      if (model === 'eyetheia') {
        tracker = new EyeTheiaTracker();
      } else {
        try { await tf.setBackend('webgl'); await tf.ready(); }
        catch { await tf.setBackend('cpu'); await tf.ready(); }
        tracker = new WebEyeTrack(12);
      }
      await tracker.initialize(data.baseUrl);
      send('ready', { model, backend: model === 'eyetheia' ? 'onnxruntime-web/wasm' : tf.getBackend(), protocolVersion: 3, captureRounds: true });
    } else if (data.type === 'reset') {
      supports = []; baseline = []; point = null;
      screenEnvelope = null;calibrationId = data.calibrationId;
      tracker.resetCalibration();
      send('resetDone');
    } else if (data.type === 'point') {
      tracker.resetFilter();
      point = { ...data.point, start: performance.now(), samples: [], features: [] };
      lastSample = 0;
    } else if (data.type === 'cancelPoint') {
      point = null;
    } else if (data.type === 'resetFilter') {
      tracker.resetFilter();
      send('filterReset');
    } else if (data.type === 'fit') {
      busy = true;
      if (supports.length < 9) throw new Error('校准点不足，请重新开始校准');
      const envelope = fitEnvelope(baseline);
      // Use the upstream affine adaptation with frozen pretrained weights.
      // No uncontrolled click-based retraining, no gradient updates in this demo.
      if ('fit' in tracker) {
        const predictions = supports.flatMap(({ result }) => 'rawGaze' in result && result.rawGaze ? [result.rawGaze] : []);
        if (predictions.length !== supports.length) throw new Error('缺少有效的 EyeTheia 校准坐标，请重新校准');
        tracker.fit(predictions, supports.map(s => [s.x, s.y]));
      } else {
        const results = supports.map(s => s.result as GazeResult);
        await tracker.adapt(
          results.map(r => r.eyePatch),
          results.map(r => r.headVector),
          results.map(r => r.faceOrigin3D),
          supports.map(s => [s.x, s.y]),
          0,
        );
      }
      supports = [];
      screenEnvelope = envelope;
      send('fitted', { baseline, calibrationId: data.calibrationId });
      baseline = [];
      busy = false;
    } else if (data.type === 'frame') {
      if (busy || !tracker?.loaded) { send('idle', {captureRound:data.captureRound}); return; }
      busy = true;
      const start = performance.now();
      const collecting = point;
      // New clients pass the target's timestamp in the same clock as the frame.
      // Older clients retain their pre-inference worker-clock settling behavior.
      const settled = collecting && (Number.isFinite(collecting.startedAt)
        ? data.timestamp - collecting.startedAt! : start - collecting.start) > 650;
      const frame = new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height);
      const r = await tracker.step(frame, data.timestamp);
      const f = featuresFrom({ landmarks: r.facialLandmarks, head: r.headVector, eyesOpen: r.gazeState === 'open' });
      const elapsed = performance.now() - start;
      send('result', {
        capturedAt: data.timestamp,
        captureRound: data.captureRound,
        gaze: r.gazeState === 'open' && r.facialLandmarks.length && r.normPog.every(Number.isFinite) ? r.normPog : null,
        features: f,
        face: r.facialLandmarks.length > 0,
        eyesOpen: r.gazeState === 'open',
        expressionInput: expressionEnabled ? faceTensor(frame.data,data.width,data.height,r.facialLandmarks) : null,
        blendshapes: r.faceBlendshapes?.[0]?.categories.map(c => [c.categoryName, c.score]) ?? [],
        ms: elapsed,
        outside: f && screenEnvelope ? outsideEvidence(f, screenEnvelope, 1) : null,
        calibrationId,
      });
      if (point && point === collecting && point.captureRound === data.captureRound && settled && f && r.normPog.length === 2 && r.normPog.every(Number.isFinite) && performance.now() - lastSample > 100) {
        lastSample = performance.now();
        point.samples.push(r);
        point.features.push(f);
        send('pointProgress', { count: point.samples.length, captureRound: point.captureRound, calibrationId: point.calibrationId, index: point.index, validation: point.validation });
        if (point.samples.length >= 7) {
          const p = point;
          point = null;
          if (!p.validation) {
            supports.push({ result: p.samples[Math.floor(p.samples.length / 2)], x: p.x, y: p.y });
            baseline.push(...p.features);
          }
          send('pointDone', {
            index: p.index,
            captureRound: p.captureRound,
            calibrationId: p.calibrationId,
            validation: p.validation,
            target: [p.x, p.y],
            predicted: [0, 1].map(i => quantile(p.samples.map(s => s.normPog[i]), 0.5)),
          });
        }
      }
      busy = false;
    }
  } catch (e) {
    busy = false;
    send('error', { message: e instanceof Error ? e.message : String(e), operation: data.type, captureRound: data.captureRound ?? data.point?.captureRound, calibrationId: data.calibrationId ?? data.point?.calibrationId });
  }
}
