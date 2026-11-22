import { access, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../gaze-demo/public/', import.meta.url));
const target = fileURLToPath(new URL('../public/tracker/', import.meta.url));
const assets = ['gaze-worker.js', 'gaze-worker.js.map', 'face_landmarker.task', 'mediapipe', 'web/model.json', 'web/group1-shard1of1.bin'];

try {
  await Promise.all(assets.map((name) => access(resolve(source, name))));
} catch (error) {
  throw new Error('Build the gaze worker and fetch the gaze weights first. See web/README.md.', { cause: error });
}

await mkdir(resolve(target, 'web'), { recursive: true });
await Promise.all(assets.map((name) => cp(resolve(source, name), resolve(target, name), { recursive: true })));

const eyeTheiaWeights = 'models/eyetheia-mpiiface.onnx';
const hasEyeTheia = await access(resolve(source, eyeTheiaWeights)).then(() => true, (error) => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
if (hasEyeTheia) {
  await mkdir(resolve(target, 'models'), { recursive: true });
  const eyeTheiaAssets = [eyeTheiaWeights, 'models/eyetheia-LICENSE.txt', 'ort'];
  await Promise.all(eyeTheiaAssets.map((name) => cp(resolve(source, name), resolve(target, name), { recursive: true })));
}
