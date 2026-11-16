import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { arch, homedir, platform } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [cache, output, ...participants] = process.argv.slice(2);
assert.ok(cache && output && participants.length, 'Usage: node scripts/eval-eott.mjs <cache> <output> <P_01> [P_02...]');
assert.ok(participants.every(id => /^P_\d+$/.test(id)), 'Invalid EOTT participant ID.');
const tracker = fileURLToPath(new URL('../public/tracker/', import.meta.url));
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.LOCKIN_CHROME_EXECUTABLE ?? (existsSync(macChrome) ? macChrome : undefined);

const browser = await chromium.launch({ executablePath });
await mkdir(output, { recursive: true });
let prepared;
const contentTypes = { js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', wasm: 'application/wasm' };
// Same-origin loopback streams preserve exact bytes and avoid app HMR.
const assets = createServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<title>LockIN local EOTT replay</title>');
    return;
  }
  const url = request.url?.slice(1) ?? '';
  const modelPath = url.startsWith('tracker/') ? resolve(tracker, url.slice(8)) : null;
  const clip = /^(initial_dot|final_dot|reading)\.rgba$/.test(url) && prepared;
  const file = modelPath?.startsWith(resolve(tracker) + sep) ? modelPath : clip ? resolve(prepared, url) : null;
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => response.headersSent ? response.destroy() : response.writeHead(404).end());
  response.setHeader('Content-Type', contentTypes[file.split('.').at(-1)] ?? 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-store');
  stream.pipe(response);
});
async function sha256(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
try {
  await new Promise((resolve, reject) => {
    assets.once('error', reject);
    assets.listen(0, '127.0.0.1', resolve);
  });
  const assetOrigin = 'http://127.0.0.1:' + assets.address().port;
  const fingerprints = {
    harness: await sha256(fileURLToPath(import.meta.url)),
    preparation: await sha256(fileURLToPath(new URL('./eval-eott-prepare.py', import.meta.url))),
    worker: await sha256(resolve(tracker, 'gaze-worker.js')),
    faceLandmarker: await sha256(resolve(tracker, 'face_landmarker.task')),
    blazeModel: await sha256(resolve(tracker, 'web/model.json')),
    blazeWeights: await sha256(resolve(tracker, 'web/group1-shard1of1.bin')),
    eyetheiaWeights: await sha256(resolve(tracker, 'models/eyetheia-mpiiface.onnx')),
  };
  const page = await browser.newPage();
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === assetOrigin ? route.continue() : route.abort());
  await page.goto(assetOrigin);
  for (const participant of participants) {
    const target = join(output, participant + '.json');
    prepared = join(cache, 'prepared', participant);
    let report;
    let manifestHash;
    try {
      const manifestPath = join(prepared, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifestHash = await sha256(manifestPath);
      const provenance = { ...fingerprints, manifest: manifestHash };
      if (existsSync(target)) {
        const previous = JSON.parse(await readFile(target, 'utf8'));
        if (JSON.stringify(previous.provenance) === JSON.stringify(provenance) &&
          previous.models && Object.values(previous.models).every(model => !model.error)) {
          console.log(participant, 'already completed with identical input fingerprints');
          continue;
        }
      }
      if (manifest.error) throw new Error(manifest.error);
      report = await page.evaluate(async ({ manifest, assetOrigin }) => {
        const width = 640;
        const height = 480;
        const stride = width * height * 4;
        const baseUrl = new URL('tracker', assetOrigin).href;
        const calibrationId = 1;
        const captureRound = 1;
        const clips = {};
        for (const [task, clip] of Object.entries(manifest.clips)) {
          const response = await fetch(assetOrigin + '/' + clip.file);
          if (!response.ok) throw new Error('Cannot load ' + task);
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength !== clip.frames.length * stride) throw new Error('Unexpected image data length for ' + task);
          clips[task] = { ...clip, bytes };
        }

        async function compare(model) {
          const worker = new Worker(baseUrl + '/gaze-worker.js');
          const points = [];
          function request(message, expected) {
            return new Promise((resolve, reject) => {
              const progress = [];
              function finish(error, data) {
                clearTimeout(timeout);
                worker.onmessage = null;
                worker.onerror = null;
                error ? reject(error) : resolve({ data, progress });
              }
              const timeout = setTimeout(() => finish(new Error(model + ' timed out on ' + message.type)), 45000);
              worker.onerror = event => finish(new Error(event.message));
              worker.onmessage = ({ data }) => {
                if (data.type === 'error') finish(new Error(model + ': ' + data.message));
                if (data.type === expected) {
                  // A result is followed by pointProgress/pointDone in the same worker operation.
                  // Leave the listener attached until the capture caller has observed its paired events.
                  if (message.type === 'frame' && message.collecting && data.gaze && data.features) {
                    setTimeout(() => finish(null, data), 25);
                  } else {
                    finish(null, data);
                  }
                }
                if (data.type === 'pointProgress' || data.type === 'pointDone') progress.push(data);
              };
              worker.postMessage(message, message.buffer ? [message.buffer] : []);
            });
          }
          function frame(clip, index, collecting = false) {
            const source = clip.frames[index];
            const buffer = clip.bytes.slice(index * stride, (index + 1) * stride);
            return request({
              type: 'frame', width, height, buffer, timestamp: source.ptsMs, captureRound, collecting,
            }, 'result');
          }
          try {
            const start = performance.now();
            const { data: ready } = await request({ type: 'init', model, baseUrl }, 'ready');
            const initMs = performance.now() - start;
            if (ready.model !== model) throw new Error('Wrong worker model: ' + ready.model);
            const { initial_dot: initial, ...heldOut } = clips;
            await request({ type: 'reset', calibrationId }, 'resetDone');
            for (const [index, [x, y]] of initial.targets.entries()) {
              const frames = initial.frames.map((value, i) => value.target === index ? i : null).filter(i => i !== null);
              if (!frames.length) {
                points.push({ index, progress: 0, framesOffered: 0 });
                continue;
              }
              worker.postMessage({
                type: 'point',
                point: { index, x, y, validation: false, startedAt: initial.frames[frames[0]].ptsMs - 651, calibrationId, captureRound },
              });
              let progressCount = 0;
              let framesOffered = 0;
              for (const i of frames) {
                const tick = performance.now();
                const { progress } = await frame(initial, i, true);
                framesOffered++;
                const sampled = progress.find(event => event.type === 'pointProgress');
                if (sampled) progressCount = sampled.count;
                if (progress.some(event => event.type === 'pointDone')) break;
                await new Promise(resolve => setTimeout(resolve, Math.max(0, 112 - (performance.now() - tick))));
              }
              points.push({ index, progress: progressCount, framesOffered });
              worker.postMessage({ type: 'cancelPoint' });
            }
            const fitted = points.length === 9 && points.every(p => p.progress >= 7);
            let fitError = null;
            if (fitted) {
              try {
                await request({ type: 'fit', calibrationId }, 'fitted');
              } catch (error) {
                fitError = error.message;
              }
            }
            const records = {};
            for (const [task, clip] of Object.entries(heldOut)) {
              await request({ type: 'resetFilter' }, 'filterReset');
              records[task] = [];
              for (const [index, source] of clip.frames.entries()) {
                const { data } = await frame(clip, index);
                if (data.captureRound !== captureRound || data.capturedAt !== source.ptsMs) throw new Error('Worker returned a different frame ID');
                records[task].push({ ...source, gaze: data.gaze, face: data.face, eyesOpen: data.eyesOpen, outside: data.outside, workerMs: data.ms });
              }
            }
            return {
              backend: ready.backend, initMs, calibration: { fitted: fitted && !fitError, fitError, points }, records,
            };
          } catch (error) {
            return { error: error.message, points };
          } finally {
            worker.terminate();
          }
        }

        const models = {};
        // Counterbalance the model run order by fixed participant ID.
        const order = Number(manifest.participant.slice(2)) % 2 ? ['eyetheia', 'blazegaze'] : ['blazegaze', 'eyetheia'];
        for (const model of order) models[model] = await compare(model);
        const alignment = Object.fromEntries(Object.entries(clips).map(([task, clip]) => [task, { video: clip.video, ...clip.alignment }]));
        return { participant: manifest.participant, screen: manifest.screen, setting: manifest.setting, alignment, models, order };
      }, { manifest, assetOrigin });
    } catch (error) {
      report = { participant, error: error.message };
    }
    report.runtime = { chrome: browser.version(), host: platform() + '/' + arch() };
    report.provenance = { ...fingerprints, manifest: manifestHash };
    await writeFile(target + '.partial', JSON.stringify(report, null, 2) + '\n');
    await rename(target + '.partial', target);
    console.log(participant, report.error ?? Object.fromEntries(Object.entries(report.models).map(([model, result]) => [
      model, result.error ?? { fitted: result.calibration.fitted, pointCounts: result.calibration.points.map(p => p.progress), testCounts: Object.fromEntries(Object.entries(result.records).map(([task, rows]) => [task, rows.length])) },
    ])));
  }
} finally {
  await browser.close();
  assets.close();
}
