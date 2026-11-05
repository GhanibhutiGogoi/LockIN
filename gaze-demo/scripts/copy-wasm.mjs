import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/mediapipe', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', { recursive: true });
