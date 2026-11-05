import * as tf from '@tensorflow/tfjs';
import WebEyeTrack from '../vendor/webeyetrack/WebEyeTrack';
import type { GazeResult } from '../vendor/webeyetrack/types';
import { featuresFrom, quantile } from './rules';

let tracker: WebEyeTrack;
let busy = false;
let point: { index: number; x: number; y: number; start: number; validation: boolean; samples: GazeResult[]; features: number[][] } | null = null;
let supports: { result: GazeResult; x: number; y: number }[] = [];
let baseline: number[][] = [];
let lastSample = 0;

function send(type: string, payload: object = {}) { self.postMessage({ type, ...payload }); }
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      send('loading', { message: '正在加载本地预训练模型…' });
      try { await tf.setBackend('webgl'); await tf.ready(); }
      catch { await tf.setBackend('cpu'); await tf.ready(); }
      tracker = new WebEyeTrack(12);
      await tracker.initialize(data.baseUrl);
      send('ready', { backend: tf.getBackend() });
    } else if (data.type === 'reset') {
      supports = []; baseline = []; point = null;
      tracker.resetCalibration();
      send('resetDone');
    } else if (data.type === 'point') {
      tracker.resetFilter();
      point = { ...data.point, start: performance.now(), samples: [], features: [] };
      lastSample = 0;
    } else if (data.type === 'cancelPoint') {
      point = null;
    } else if (data.type === 'fit') {
      busy = true;
      if (supports.length < 9) throw new Error('校准点不足，请重新开始校准');
      // Use the upstream affine adaptation with frozen pretrained weights.
      // No uncontrolled click-based retraining, no gradient updates in this demo.
      await tracker.adapt(
        supports.map(s => s.result.eyePatch),
        supports.map(s => s.result.headVector),
        supports.map(s => s.result.faceOrigin3D),
        supports.map(s => [s.x, s.y]),
        0,
      );
      supports = [];
      send('fitted', { baseline });
      baseline = [];
      busy = false;
    } else if (data.type === 'frame') {
      if (busy || !tracker?.loaded) { send('idle'); return; }
      busy = true;
      const start = performance.now();
      const frame = new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height);
      const r = await tracker.step(frame, data.timestamp);
      const f = featuresFrom({ landmarks: r.facialLandmarks, head: r.headVector, eyesOpen: r.gazeState === 'open' });
      const elapsed = performance.now() - start;
      send('result', {
        capturedAt: data.timestamp,
        gaze: r.gazeState === 'open' && r.facialLandmarks.length && r.normPog.every(Number.isFinite) ? r.normPog : null,
        features: f,
        face: r.facialLandmarks.length > 0,
        eyesOpen: r.gazeState === 'open',
        ms: elapsed,
      });
      if (point && f && performance.now() - point.start > 650 && performance.now() - lastSample > 100) {
        lastSample = performance.now();
        point.samples.push(r);
        point.features.push(f);
        send('pointProgress', { count: point.samples.length });
        if (point.samples.length >= 7) {
          const p = point;
          point = null;
          if (!p.validation) {
            supports.push({ result: p.samples[Math.floor(p.samples.length / 2)], x: p.x, y: p.y });
            baseline.push(...p.features);
          }
          send('pointDone', {
            index: p.index,
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
    send('error', { message: e instanceof Error ? e.message : String(e) });
  }
};
