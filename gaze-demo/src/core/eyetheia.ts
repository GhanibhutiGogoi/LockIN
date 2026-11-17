import type * as Ort from 'onnxruntime-web';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import FaceLandmarkerClient from '../../vendor/webeyetrack/FaceLandmarkerClient';
import type { GazeResult } from '../../vendor/webeyetrack/types';
import { KalmanFilter2D } from '../../vendor/webeyetrack/utils/filter';
import { computeAffineMatrixML, computeEAR, getHeadVector, translateMatrix } from '../../vendor/webeyetrack/utils/mathUtils';

type EyeTheiaResult = Pick<GazeResult, 'facialLandmarks' | 'faceBlendshapes' | 'headVector' | 'gazeState' | 'normPog' | 'eyeAspect'> & {
  rawGaze?: number[];
  mappedGaze?: number[];
  unclippedGaze?: number[];
};
type Crop = [x: number, y: number, width: number, height: number];

const INPUT_SIZE = 224;
const GRID_SIZE = 25;
const CROP_MARGIN = 20;
const LEFT_EYE = [33, 133, 159, 160, 158, 144];
const RIGHT_EYE = [362, 263, 386, 387, 385, 373];
const FACE = Array.from({ length: 328 }, (_, index) => index + 10);

function cropBox(landmarks: NormalizedLandmark[], indices: number[], width: number, height: number): Crop {
  const xs = indices.map(index => Math.trunc(landmarks[index].x * width));
  const ys = indices.map(index => Math.trunc(landmarks[index].y * height));
  const x = Math.max(0, Math.min(...xs) - CROP_MARGIN);
  const y = Math.max(0, Math.min(...ys) - CROP_MARGIN);
  return [x, y, Math.min(width, Math.max(...xs) + CROP_MARGIN) - x, Math.min(height, Math.max(...ys) + CROP_MARGIN) - y];
}

function faceGrid([x, y, width, height]: Crop, frameWidth: number, frameHeight: number) {
  const x0 = Math.floor(x * GRID_SIZE / frameWidth);
  const y0 = Math.floor(y * GRID_SIZE / frameHeight);
  const columns = Math.floor(width * GRID_SIZE / frameWidth);
  const rows = Math.floor(height * GRID_SIZE / frameHeight);
  const grid = new Float32Array(GRID_SIZE ** 2);
  for (let row = y0; row < y0 + rows; row++) {
    grid.fill(1, row * GRID_SIZE + x0, row * GRID_SIZE + x0 + columns);
  }
  return grid;
}

export class EyeTheiaTracker {
  loaded = false;
  private readonly landmarker = new FaceLandmarkerClient();
  private ort!: typeof Ort;
  private session!: Ort.InferenceSession;
  private readonly source = new OffscreenCanvas(1, 1);
  private readonly patch = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  private readonly sourceContext = this.source.getContext('2d')!;
  private readonly patchContext = this.patch.getContext('2d', { willReadFrequently: true })!;
  private affine: number[][] | null = null;
  private filter = new KalmanFilter2D();

  async initialize(baseUrl: string) {
    const assets = new URL(baseUrl.replace(/\/$/, '') + '/', self.location.href);
    const scope = self as unknown as { importScripts: (...urls: string[]) => void; ort: typeof Ort };
    const weights = await fetch(new URL('models/eyetheia-mpiiface.onnx', assets));
    if (!weights.ok || weights.headers.get('content-type')?.includes('text/html')) {
      throw new Error('EyeTheia weights missing. Run gaze-demo/scripts/prepare-eyetheia.py and npm run gaze:assets in web.');
    }
    const bytes = new Uint8Array(await weights.arrayBuffer());
    scope.importScripts(new URL('ort/ort.wasm.min.js', assets).href);
    this.ort = scope.ort;
    this.ort.env.wasm.numThreads = 1;
    this.ort.env.wasm.wasmPaths = new URL('ort/', assets).href;
    await this.landmarker.initialize();
    this.session = await this.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    this.loaded = true;
  }

  resetFilter() {
    this.filter = new KalmanFilter2D();
  }

  resetCalibration() {
    this.affine = null;
    this.resetFilter();
  }

  fit(predictions: number[][], targets: number[][]) {
    const matrix = computeAffineMatrixML(predictions, targets);
    if (!matrix.flat().every(Number.isFinite)) throw new Error('Non-finite calibration matrix');
    this.affine = matrix;
    this.resetFilter();
    return matrix;
  }

  private imageInput(box: Crop) {
    const context = this.patchContext;
    context.drawImage(this.source, ...box, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const { data } = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const size = INPUT_SIZE ** 2;
    const bgr = new Float32Array(3 * size);
    // The exported graph subtracts the checkpoint's per-region mean images.
    for (let pixel = 0; pixel < size; pixel++) {
      bgr[pixel] = data[4 * pixel + 2] / 255;
      bgr[size + pixel] = data[4 * pixel + 1] / 255;
      bgr[2 * size + pixel] = data[4 * pixel] / 255;
    }
    return new this.ort.Tensor('float32', bgr, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  }

  async step(frame: ImageData, _timestamp: number): Promise<EyeTheiaResult> {
    const detected = await this.landmarker.processFrame(frame);
    const landmarks = detected?.faceLandmarks[0] ?? [];
    const matrix = detected?.facialTransformationMatrixes[0];
    const result: EyeTheiaResult = {
      facialLandmarks: landmarks,
      faceBlendshapes: detected?.faceBlendshapes ?? [],
      headVector: matrix ? getHeadVector(translateMatrix(matrix)) : [0, 0, 0],
      gazeState: 'closed',
      normPog: [0, 0],
    };
    if (!matrix || landmarks.length < 478) return result;
    result.eyeAspect = [computeEAR(landmarks, 'left'), computeEAR(landmarks, 'right')];
    if (result.eyeAspect.some(value => value < .2)) return result;

    const { width, height } = frame;
    const face = cropBox(landmarks, FACE, width, height);
    const left = cropBox(landmarks, LEFT_EYE, width, height);
    const right = cropBox(landmarks, RIGHT_EYE, width, height);
    if ([face, left, right].some(box => box[2] <= 0 || box[3] <= 0)) return result;
    if (this.source.width !== width || this.source.height !== height) {
      this.source.width = width;
      this.source.height = height;
    }
    this.sourceContext.putImageData(frame, 0, 0);
    const prediction = await this.session.run({
      face: this.imageInput(face),
      left_eye: this.imageInput(left),
      right_eye: this.imageInput(right),
      face_grid: new this.ort.Tensor('float32', faceGrid(face, width, height), [1, GRID_SIZE ** 2]),
    });
    const [x, y] = prediction.gaze.data as Float32Array;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return result;
    const centered = this.affine
      ? this.affine.map(([a, b, c]) => a * x + b * y + c)
      : [x - 0.5, y - 0.5];
    const smoothed = this.filter.step(centered);
    return { ...result, gazeState: 'open', rawGaze: [x, y], mappedGaze: centered, unclippedGaze: [...smoothed], normPog: smoothed.map(value => Math.max(-0.5, Math.min(0.5, value))) };
  }
}
