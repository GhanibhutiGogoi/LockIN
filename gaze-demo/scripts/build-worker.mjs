import { build } from 'esbuild';
await build({
  entryPoints: ['src/gaze.worker.ts'],
  outfile: 'public/gaze-worker.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'warning',
});
