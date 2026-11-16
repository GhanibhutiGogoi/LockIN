import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir, platform, arch } from 'node:os';
import { join } from 'node:path';

const [fixture, previewUrl = 'http://127.0.0.1:5180/'] = process.argv.slice(2);
assert.ok(fixture, 'Usage: node scripts/compare-gaze.mjs <portrait.jpg> [local preview URL]');
const preview = new URL(previewUrl);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(preview.hostname), 'Use a local LockIN preview URL.');
const portrait = await readFile(fixture);
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.LOCKIN_CHROME_EXECUTABLE ?? (existsSync(macChrome) ? macChrome : undefined);

const browser = await chromium.launch({
  executablePath,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === preview.origin ? route.continue() : route.abort());
  await page.goto(preview.href);
  const { width, height, results } = await page.evaluate(async ({ portraitUrl, previewUrl }) => {
    const width = 640;
    const height = 480;
    const image = new Image();
    image.src = portraitUrl;
    await image.decode();
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#808080';
    context.fillRect(0, 0, width, height);
    const fit = Math.min(width / image.width, height / image.height);
    const [w, h] = [image.width * fit, image.height * fit];
    context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
    const faceFrame = context.getImageData(0, 0, width, height).data;
    context.fillRect(0, 0, width, height);
    const blankFrame = context.getImageData(0, 0, width, height).data;

    const baseUrl = new URL('tracker', previewUrl).href;
    async function compare(model) {
      const worker = new Worker(baseUrl + '/gaze-worker.js');
      function request(message, expect, transfer = []) {
        return new Promise((resolve, reject) => {
          const finish = (error, result) => {
            clearTimeout(timeout);
            worker.onmessage = null;
            worker.onerror = null;
            error ? reject(error) : resolve(result);
          };
          const timeout = setTimeout(() => finish(new Error(model + ' timed out on ' + message.type)), 45_000);
          worker.onerror = event => finish(new Error(event.message));
          worker.onmessage = ({ data }) => {
            if (data.type === 'error') finish(new Error(model + ': ' + data.message));
            if (data.type === expect) finish(null, data);
          };
          worker.postMessage(message, transfer);
        });
      }
      async function infer(pixels) {
        const buffer = pixels.slice().buffer;
        const captureRound = 1;
        const timestamp = performance.now();
        const { gaze, face, eyesOpen, ms, captureRound: replyRound } = await request({
          type: 'frame', captureRound, timestamp, width, height, buffer,
        }, 'result', [buffer]);
        if (replyRound !== captureRound) throw new Error(model + ' returned an incorrect capture round');
        return { gaze, face, eyesOpen, ms };
      }
      try {
        const start = performance.now();
        const ready = await request({ type: 'init', model, baseUrl }, 'ready');
        const initMs = performance.now() - start;
        if (ready.model !== model) throw new Error(model + ' initialized as ' + ready.model);
        for (let i = 0; i < 3; i++) await infer(faceFrame);
        const samples = [];
        for (let i = 0; i < 12; i++) samples.push(await infer(faceFrame));
        return { model, backend: ready.backend, initMs, samples, blank: await infer(blankFrame) };
      } finally {
        worker.terminate();
      }
    }
    return { width, height, results: [await compare('blazegaze'), await compare('eyetheia')] };
  }, { portraitUrl: 'data:image/jpeg;base64,' + portrait.toString('base64'), previewUrl: preview.href });

  const metrics = results.map(({ model, backend, initMs, samples, blank }) => {
    assert.ok(samples.every(sample => sample.face && sample.eyesOpen && sample.gaze?.length === 2 && sample.gaze.every(Number.isFinite)), model + ' missed a portrait frame');
    assert.deepEqual([blank.face, blank.eyesOpen, blank.gaze], [false, false, null], model + ' returned gaze on the blank control');
    const times = samples.map(sample => sample.ms).sort((a, b) => a - b);
    return {
      model, backend, initMs,
      validPortraitFrames: samples.length,
      medianMs: (times[5] + times[6]) / 2,
      p95Ms: times[Math.ceil(0.95 * times.length) - 1],
      exampleUncalibratedGaze: samples.at(-1).gaze,
      blankControl: blank,
      workerTimingsMs: samples.map(sample => sample.ms),
    };
  });
  const ui = [];
  const selector = page.locator('#mode-attention');
  async function openIntegrations() {
    await page.getByRole('button', { name: 'Integrations (`)' }).click();
  }
  async function startAndSkipCalibration(asset) {
    const requestedAsset = page.waitForResponse(response => response.ok() && new URL(response.url()).pathname.endsWith(asset));
    await page.getByRole('button', { name: 'Open development sample' }).click();
    const consent = page.getByRole('button', { name: 'I agree, start studying' });
    const calibration = page.getByText('Calibration · 1 of 9', { exact: true });
    await consent.or(calibration).first().waitFor({ timeout: 40_000 });
    if (await consent.isVisible()) {
      const notifications = page.getByRole('checkbox', { name: /Call me back/ });
      if (await notifications.count()) await notifications.uncheck();
      await consent.click();
    }
    await calibration.waitFor({ timeout: 40_000 });
    await requestedAsset;
    await page.getByRole('button', { name: 'Continue without calibrated gaze' }).click();
    await page.getByRole('button', { name: 'Finish', exact: true }).waitFor();
  }
  await openIntegrations();
  await selector.selectOption({ label: 'EyeTheia + MediaPipe' });
  await page.reload();
  await openIntegrations();
  assert.equal(await selector.inputValue(), 'eyetheia');
  ui.push('EyeTheia selection persisted across reload.');
  await page.getByRole('button', { name: 'Close integrations' }).click();
  await startAndSkipCalibration('/models/eyetheia-mpiiface.onnx');
  ui.push('EyeTheia loaded from Web with fake camera and entered calibration.');
  await page.goto(preview.href);
  await openIntegrations();
  await selector.selectOption({ label: 'BlazeGaze + MediaPipe' });
  await page.getByRole('button', { name: 'Close integrations' }).click();
  await startAndSkipCalibration('/web/model.json');
  ui.push('Switched back to BlazeGaze, loaded its own weights, and entered calibration.');

  console.log(JSON.stringify({
    chrome: browser.version(), host: platform() + '/' + arch(), width, height,
    fixtureSha256: createHash('sha256').update(portrait).digest('hex'),
    warmupFramesPerModel: 3,
    scope: 'Repeated static portrait and blank control. Timing covers MediaPipe, preprocessing and gaze inference. No gaze ground truth or calibration.',
    metrics,
    ui,
  }, null, 2));
} finally {
  await browser.close();
}
