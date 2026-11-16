import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/mediapipe', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', { recursive: true });

await mkdir('public/ort', {recursive:true});
for (const file of ['ort.wasm.min.js','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) {
  await cp('node_modules/onnxruntime-web/dist/'+file,'public/ort/'+file);
}
