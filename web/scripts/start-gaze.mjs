import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = ['gaze-worker.js', 'face_landmarker.task', 'mediapipe/vision_wasm_internal.wasm', 'web/model.json', 'web/group1-shard1of1.bin'];
for (const asset of assets) {
  await access(new URL(`../public/tracker/${asset}`, import.meta.url));
}

// Use real browser gaze with local recap fixtures and no memory backend.
const child = spawn(process.execPath, [
  fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
  '--mode', 'demo', '--host', '127.0.0.1', '--port', '5181', '--strictPort',
], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_ATTENTION_PROVIDER: 'local-gaze',
    VITE_CONTENT_PROVIDER: 'mock',
    VITE_MEDIA_PROVIDER: 'mock',
    VITE_ADAPTIVE_PROVIDER: 'local',
  },
});

child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 0; });
