import {faceTensor} from './core/expression-input';
import * as tf from '@tensorflow/tfjs';
import WebEyeTrack from '../vendor/webeyetrack/WebEyeTrack';
import type { GazeResult } from '../vendor/webeyetrack/types';
import { EyeTheiaTracker } from './core/eyetheia';
import { featuresFrom, fitEnvelope, attentionEvidence, ScreenEvidence, type Envelope } from './rules';
import { ATTENTION_TIMING, ATTENTION_RULE_VERSION } from '../backend/static/attention-policy.js';
import { finitePair, summarizeCalibrationPoint, calibrationFitDiagnostics, type CalibrationSample, type CalibrationFitDiagnostics } from './core/calibration';

type WorkerGazeResult = GazeResult | Awaited<ReturnType<EyeTheiaTracker['step']>>;
let tracker: WebEyeTrack | EyeTheiaTracker;
let busy = false;
let expressionEnabled=false;
let point: { index: number; x: number; y: number; start: number; startedAt?: number; calibrationId?: number; captureRound?: number; validation: boolean; samples: WorkerGazeResult[]; features: number[][] } | null = null;
let supports: { rawMedian: number[]; x: number; y: number }[] = [];
let fitDiagnostics: CalibrationFitDiagnostics | null = null;
let baseline: number[][] = [];
let lastSample = 0;
let screenEnvelope: Envelope | null = null;
const screenEvidence = new ScreenEvidence();
let calibrationId: number | undefined;
let model = 'blazegaze';

function send(type: string, payload: object = {}) { self.postMessage({ type, ...payload }); }
// Reset/adaptation/filter changes must not interleave with asynchronous inference.
// The capture adapter sends at most one frame at a time, keeping this queue bounded.
let operations = Promise.resolve();
self.onmessage = ({ data }) => { operations = operations.then(() => handle(data)); };
async function handle(data: any) {
  try {
    if (data.type === 'init') {
      expressionEnabled=data.expression===true;
      send('loading', { message: 'Loading local pretrained models…' });
      model = data.model === 'eyetheia' ? 'eyetheia' : 'blazegaze';
      if (model === 'eyetheia') {
        tracker = new EyeTheiaTracker();
      } else {
        try { await tf.setBackend('webgl'); await tf.ready(); }
        catch { await tf.setBackend('cpu'); await tf.ready(); }
        tracker = new WebEyeTrack(12);
      }
      await tracker.initialize(data.baseUrl);
      send('ready', { model, backend: model === 'eyetheia' ? 'onnxruntime-web/wasm' : tf.getBackend(), protocolVersion: 5, captureRounds: true });
    } else if (data.type === 'reset') {
      supports = []; baseline = []; point = null;
      fitDiagnostics = null;
      screenEnvelope = null;calibrationId = data.calibrationId;
      screenEvidence.reset();
      tracker.resetCalibration();
      send('resetDone');
    } else if (data.type === 'point') {
      screenEvidence.reset();
      tracker.resetFilter();
      point = { ...data.point, start: performance.now(), samples: [], features: [] };
      lastSample = 0;
    } else if (data.type === 'cancelPoint') {
      point = null;
    } else if (data.type === 'resetFilter') {
      screenEvidence.reset();
      tracker.resetFilter();
      send('filterReset');
    } else if (data.type === 'fit') {
      busy = true;
      if (supports.length < 9) throw new Error('Not enough calibration points. Please restart calibration.');
      const envelope = fitEnvelope(baseline);
      // Fit one robust raw prediction per target; pretrained weights stay frozen.
      const predictions = supports.map(s => s.rawMedian);
      const targets = supports.map(s => [s.x, s.y]);
      fitDiagnostics = calibrationFitDiagnostics(predictions, targets);
      const matrix = await tracker.fit(predictions, targets);
      fitDiagnostics = calibrationFitDiagnostics(predictions, targets, matrix);
      supports = [];
      screenEnvelope = envelope;
      screenEvidence.reset();
      send('fitted', { baseline, fitDiagnostics, calibrationId: data.calibrationId });
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
      const decision = attentionEvidence({ face: r.facialLandmarks.length > 0, head: r.headVector, eyesOpen: r.gazeState === 'open', eyeAspect: r.eyeAspect, features: f, mappedGaze: r.mappedGaze }, screenEnvelope);
      const outside = screenEvidence.update(data.timestamp, decision.outside, decision.confirmMs);
      const elapsed = performance.now() - start;
      send('result', {
        capturedAt: data.timestamp,
        captureRound: data.captureRound,
        gaze: r.gazeState === 'open' && r.facialLandmarks.length && r.normPog.every(Number.isFinite) ? r.normPog : null,
        features: f,
        mappedGaze: r.mappedGaze,
        face: r.facialLandmarks.length > 0,
        eyesOpen: r.gazeState === 'open',
        attentionValid: outside !== null,
        attentionReason: decision.reason,
        diagnostic: {
          model, ruleVersion: ATTENTION_RULE_VERSION, timing: ATTENTION_TIMING,
          capturedAt: data.timestamp, reason: decision.reason, rawOutside: decision.outside, confirmedOutside: outside,
          face: r.facialLandmarks.length > 0, eyesOpen: r.gazeState === 'open',
          eyeAspect: r.eyeAspect?.every(Number.isFinite) ? r.eyeAspect : null,
          head: r.headVector.every(Number.isFinite) ? r.headVector : null,
          features: f, mappedGaze: finitePair(r.mappedGaze) ? r.mappedGaze : null,
        },
        expressionInput: expressionEnabled ? faceTensor(frame.data,data.width,data.height,r.facialLandmarks) : null,
        blendshapes: r.faceBlendshapes?.[0]?.categories.map(c => [c.categoryName, c.score]) ?? [],
        ms: elapsed,
        outside,
        calibrationId,
      });
      if (point && point === collecting && point.captureRound === data.captureRound && settled && f && finitePair(r.normPog) && finitePair(r.rawGaze) && finitePair(r.mappedGaze) && finitePair(r.unclippedGaze) && performance.now() - lastSample > 100) {
        lastSample = performance.now();
        point.samples.push(r);
        point.features.push(f);
        send('pointProgress', { count: point.samples.length, captureRound: point.captureRound, calibrationId: point.calibrationId, index: point.index, validation: point.validation });
        if (point.samples.length >= 7) {
          const p = point;
          point = null;
          const summary = summarizeCalibrationPoint(p.samples as CalibrationSample[]);
          if (!p.validation) {
            supports.push({ rawMedian: summary.rawMedian, x: p.x, y: p.y });
            baseline.push(...p.features);
          }
          send('pointDone', {
            index: p.index,
            captureRound: p.captureRound,
            calibrationId: p.calibrationId,
            validation: p.validation,
            target: [p.x, p.y],
            predicted: summary.predicted,
            diagnostics: { ...summary, durationMs: Math.max(0, data.timestamp - (p.startedAt ?? p.start)) },
          });
        }
      }
      busy = false;
    }
  } catch (e) {
    busy = false;
    send('error', { message: e instanceof Error ? e.message : String(e), operation: data.type, fitDiagnostics: data.type === 'fit' ? fitDiagnostics : undefined, captureRound: data.captureRound ?? data.point?.captureRound, calibrationId: data.calibrationId ?? data.point?.calibrationId });
  }
}
