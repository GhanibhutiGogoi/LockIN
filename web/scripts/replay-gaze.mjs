import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OffscreenMonitor } from '../../gaze-demo/backend/static/offscreen.js';

const preview = new URL(process.argv[2] ?? 'http://127.0.0.1:5180/');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(preview.hostname), 'Use a local LockIN preview URL.');
const artifacts = process.env.LOCKIN_REPLAY_ARTIFACTS;
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const modulePath = process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright');
const { chromium } = require(modulePath);
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.LOCKIN_CHROME_EXECUTABLE ?? (existsSync(macChrome) ? macChrome : undefined);

const workerScript = `
let calibrationId;
let evidence = 'screen';
let initialValidationComplete = false;
let rejectQuickCheck = false;
self.onmessage = ({data}) => {
  if (data.type === 'init') self.postMessage({type:'ready', protocolVersion:3, captureRounds:true});
  if (data.type === 'replay') {
    evidence = data.evidence ?? evidence;
    rejectQuickCheck = data.rejectQuickCheck ?? rejectQuickCheck;
  }
  if (data.type === 'reset') {
    calibrationId = data.calibrationId;
    initialValidationComplete = false;
    rejectQuickCheck = false;
  }
  if (data.type === 'point') {
    const p = data.point;
    const predicted = p.validation && initialValidationComplete && rejectQuickCheck ? [.95,.95] : [p.x,p.y];
    setTimeout(() => {
      self.postMessage({
        type:'pointDone', index:p.index, validation:p.validation, calibrationId:p.calibrationId,
        captureRound:p.captureRound, predicted,
      });
      if (p.validation && p.index === 2) initialValidationComplete = true;
    }, 220);
  }
  if (data.type === 'fit') self.postMessage({type:'fitted', calibrationId});
  if (data.type === 'frame') {
    if (evidence === 'stalled') return;
    const valid = evidence !== 'unknown';
    self.postMessage({
      type:'result', capturedAt:data.timestamp, captureRound:data.captureRound, face:valid, eyesOpen:valid,
      gaze:valid ? [0,0] : null, outside:evidence === 'away', calibrationId,
    });
  }
};
`;

async function openPage(browser, { fakeWorker = false } = {}) {
  const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1200, height: 850 } });
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === preview.origin) await route.continue();
    else await route.abort();
  });
  if (fakeWorker) {
    await context.route('**/tracker/gaze-worker.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: workerScript }));
  }
  await context.addInitScript(() => {
    localStorage.setItem('lockin.integrations.demo', JSON.stringify({ attention: { mode: 'local-gaze', url: '' } }));
    const replay = {
      workers: [], streams: [], focused: true, deviceId: 'replay-camera',
      deny: false, deferCamera: false, grantCamera: null, terminated: 0,
    };
    window.lockinReplay = replay;
    document.hasFocus = () => replay.focused;
    Math.random = () => 0.6;
    const BrowserWorker = window.Worker;
    window.Worker = class extends BrowserWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).endsWith('/tracker/gaze-worker.js')) replay.workers.push(this);
      }
      terminate() {
        if (replay.workers.includes(this)) replay.terminated++;
        super.terminate();
      }
    };
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (options) => {
      if (replay.deny) throw new DOMException('Replay camera denied', 'NotAllowedError');
      if (replay.deferCamera) await new Promise((resolve) => { replay.grantCamera = resolve; });
      const stream = await open(options);
      const id = replay.deviceId;
      for (const track of stream.getVideoTracks()) {
        const settings = track.getSettings.bind(track);
        track.getSettings = () => ({ ...settings(), deviceId: id });
      }
      replay.streams.push(stream);
      return stream;
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(12_000);
  return { context, page, errors };
}

async function openDeck(page) {
  await page.goto(preview.href);
  await page.getByRole('button', { name: 'Open development sample' }).click();
  const notifications = page.getByRole('checkbox', { name: /Call me back/ });
  if (await notifications.count()) await notifications.uncheck();
  await page.getByRole('button', { name: 'I agree, start studying' }).click();
}

async function screenshot(page, name) {
  if (artifacts) await page.screenshot({ path: join(artifacts, name) });
}

function checkSourceTimeBoundary() {
  const monitor = new OffscreenMonitor();
  const feed = (t, outside = true, valid = true, calibrated = true) =>
    monitor.observe({ t, valid, calibrated, outside });
  for (let t = 0; t <= 29_900; t += 100) feed(t);
  assert.equal(monitor.snapshot(29_900).count, 0);
  assert.equal(feed(30_000).count, 1);
  assert.equal(feed(30_100).count, 1);
  for (let t = 30_200; t <= 31_200; t += 100) feed(t, false);
  assert.equal(monitor.snapshot(31_200).away_ms, 0);
  for (let t = 31_300; t <= 61_200; t += 100) feed(t);
  assert.equal(monitor.snapshot(61_200).count, 1);
  assert.equal(feed(61_300).count, 2);

  monitor.clear();
  for (let t = 0; t <= 29_900; t += 100) feed(t);
  assert.equal(feed(30_000, null, false).away_ms, 29_900);
  assert.equal(feed(30_100).count, 0);
  assert.equal(monitor.snapshot(31_300).away_ms, 0);
  assert.equal(feed(31_400).away_ms, 0);
  assert.equal(feed(31_500).away_ms, 100);
  assert.equal(feed(31_600, null, false, false).away_ms, 0);
  assert.equal(feed(31_700).count, 0);
  console.log('Source-time rule: 29.9 s has no event, 30 s triggers once per excursion, returning rearms, invalid frames never accrue, a stalled or closed camera resets.');
}

async function checkRulesDemo(browser) {
  const { context, page, errors } = await openPage(browser);
  try {
    await page.goto(new URL('gaze-plan-demo/', preview).href);
    await page.getByRole('heading', { name: '视线规则演示' }).waitFor();
    await page.getByRole('button', { name: '看向别处' }).click();
    await page.getByRole('button', { name: '推进 10 秒' }).click();
    await page.getByRole('button', { name: '遮挡摄像头' }).click();
    await page.getByRole('button', { name: '推进 0.5 秒' }).click();
    assert.equal(await page.locator('#away-seconds').textContent(), '10.0');
    await page.getByRole('button', { name: '推进 10 秒' }).click();
    assert.equal(await page.locator('#away-seconds').textContent(), '0.0');
    await page.getByRole('button', { name: '看向别处' }).click();
    const advance = page.getByRole('button', { name: '推进 10 秒' });
    await advance.click();
    await advance.click();
    assert.equal(await page.locator('#events li').count(), 0);
    await advance.click();
    assert.equal(await page.locator('#events li').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Rules demo: short occlusion pauses, long occlusion resets, 30 s triggers once.');
  } finally {
    await context.close();
  }
}

async function checkModel(browser) {
  const { context, page, errors } = await openPage(browser);
  try {
    const assets = new Set();
    page.on('response', (response) => {
      if (response.ok()) assets.add(new URL(response.url()).pathname);
    });
    await openDeck(page);
    await page.getByText('Calibration · 1 of 9', { exact: true }).waitFor({ timeout: 40_000 });
    for (const suffix of ['face_landmarker.task', 'web/model.json', 'web/group1-shard1of1.bin']) {
      assert.ok([...assets].some((asset) => asset.endsWith(suffix)), `Missing model asset ${suffix}`);
    }
    await page.getByRole('button', { name: 'Continue without calibrated gaze' }).click();
    await page.getByRole('button', { name: 'Finish', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.lockinReplay.streams.every((s) => s.getVideoTracks().every((t) => t.readyState === 'ended'))));
    assert.deepEqual(errors, []);
    console.log('Pretrained worker: local BlazeGaze and Face Landmarker assets loaded in Chrome.');
  } finally {
    await context.close();
  }
}

const active = async (page) => {
  try {
    await page.getByText('Gaze tracking active', { exact: true }).waitFor();
  } catch (error) {
    const details = await page.evaluate(() => ({
      calibration: document.querySelector('[aria-label="Gaze calibration"]')?.textContent,
      status: document.querySelector('[aria-label="Valid off-screen time"]')?.parentElement?.textContent,
      workers: window.lockinReplay.workers.length,
      streams: window.lockinReplay.streams.length,
    })).catch(() => null);
    console.error('Tracking readiness:', details);
    throw error;
  }
};
const send = (page, message) => page.evaluate(
  (m) => window.lockinReplay.workers.at(-1).postMessage({ type: 'replay', ...m }),
  message,
);

async function pause(page) {
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.lockinReplay.streams.length > 0 &&
    window.lockinReplay.streams.every((s) => s.getVideoTracks().every((t) => t.readyState === 'ended')));
}

async function checkResume(browser) {
  const { context, page, errors } = await openPage(browser, { fakeWorker: true });
  try {
    await openDeck(page);
    await active(page);
    await pause(page);
    await page.keyboard.press('p');
    await page.getByText('Quick check · 1 of 2', { exact: true }).waitFor();
    await screenshot(page, 'quick-check.png');
    await page.getByText('Quick check · 2 of 2', { exact: true }).waitFor();
    await active(page);
    assert.deepEqual(await page.evaluate(() => ({
      workers: window.lockinReplay.workers.length, streams: window.lockinReplay.streams.length,
    })), { workers: 1, streams: 2 });

    await pause(page);
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.keyboard.press('p');
    await page.getByText('Camera or window changed. Full calibration required.', { exact: true }).waitFor();
    await active(page);

    await send(page, { rejectQuickCheck: true });
    await pause(page);
    await page.keyboard.press('p');
    await page.getByText('Quick check did not pass. Full calibration required.', { exact: true }).waitFor();
    await active(page);

    await pause(page);
    await page.evaluate(() => { window.lockinReplay.deviceId = 'second-replay-camera'; });
    await page.keyboard.press('p');
    await page.getByText('Camera or window changed. Full calibration required.', { exact: true }).waitFor();
    await active(page);

    await pause(page);
    await page.evaluate(() => { window.lockinReplay.deny = true; });
    await page.keyboard.press('p');
    await page.getByText('App switches only', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.lockinReplay.streams.every((s) => s.getVideoTracks().every((t) => t.readyState === 'ended'))));
    assert.deepEqual(errors, []);
    console.log('Resume: camera off while paused, same-device 2-point check, full calibration after geometry/device change or failed validation, denied-camera fallback.');
  } finally {
    await context.close();
  }
}

async function checkSkipPendingCamera(browser) {
  const { context, page, errors } = await openPage(browser, { fakeWorker: true });
  try {
    await openDeck(page);
    await active(page);
    await pause(page);
    await page.evaluate(() => { window.lockinReplay.deferCamera = true; });
    await page.keyboard.press('p');
    await page.waitForFunction(() => typeof window.lockinReplay.grantCamera === 'function');
    await page.getByRole('button', { name: 'Continue without calibrated gaze' }).click();
    await page.getByText('App switches only', { exact: true }).waitFor();
    await page.evaluate(() => window.lockinReplay.grantCamera());
    await page.waitForFunction(() => window.lockinReplay.streams.length === 2 &&
      window.lockinReplay.streams.every((s) => s.getVideoTracks().every((t) => t.readyState === 'ended')));
    assert.equal(await page.evaluate(() => window.lockinReplay.terminated), 1);
    assert.deepEqual(errors, []);
    console.log('Skip: released the retained worker and stopped the camera stream that arrived after cancellation.');
  } finally {
    await context.close();
  }
}

async function checkGazeRescue(browser) {
  const { context, page, errors } = await openPage(browser, { fakeWorker: true });
  try {
    await openDeck(page);
    await active(page);
    await send(page, { evidence: 'away' });
    await page.getByText('Looking away', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Valid off-screen time"]')?.textContent.includes('1 /'));
    await send(page, { evidence: 'unknown' });
    await page.getByText('Tracking interrupted · timer paused', { exact: true }).waitFor();
    assert.match(await page.locator('[aria-label="Valid off-screen time"]').textContent(), /[1-9]\d* \/ 30 s/);
    await page.getByText('Tracking interrupted', { exact: true }).waitFor();
    await send(page, { evidence: 'screen' });
    await active(page);

    const started = performance.now();
    await send(page, { evidence: 'away' });
    await page.getByText('Looking away', { exact: true }).waitFor();
    await page.waitForTimeout(9000);
    const dialog = page.getByRole('dialog', { name: 'Focus rescue' });
    assert.equal(await dialog.count(), 0);
    try {
      await dialog.getByText('Looked away for 30 seconds', { exact: true }).waitFor({ timeout: 30_000 });
    } catch (error) {
      const snapshot = await page.evaluate(async () => {
        const { useApp } = await import('/src/store.ts');
        const { live, rescue, camera } = useApp.getState();
        return {
          state: live.state, gaze: live.gazeTracking, windowActive: live.windowActive,
          camera, rescue: rescue && { phase: rescue.phase, trigger: rescue.trigger, error: rescue.error },
        };
      }).catch(() => null);
      console.error('Study state at gaze replay failure:', snapshot, errors);
      await screenshot(page, 'gaze-replay-failure.png');
      throw error;
    }
    const elapsed = Math.round(performance.now() - started);
    assert.ok(elapsed >= 30_000, `Early gaze rescue at ${elapsed} ms`);
    await screenshot(page, 'gaze-rescue.png');

    await dialog.getByRole('button', { name: 'Flag a wrong fact' }).waitFor();
    await dialog.getByRole('button', { name: /I.m back/ }).click();
    await dialog.getByRole('group', { name: /Answers/ }).getByRole('button').first().click();
    await dialog.getByRole('button', { name: 'Back to the slide' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.mouse.move(20, 10);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('button', { name: 'See my report' }).click();
    await page.waitForFunction(() => window.lockinReplay.streams.every((s) => s.getVideoTracks().every((t) => t.readyState === 'ended')));
    assert.equal(await page.evaluate(() => window.lockinReplay.terminated), 1);
    assert.deepEqual(errors, []);
    console.log(`Gaze rescue: triggered at ${elapsed} ms, reason visible, answered quiz and returned to the deck.`);
  } finally {
    await context.close();
  }
}

async function checkWindowRescue(browser) {
  const { context, page, errors } = await openPage(browser, { fakeWorker: true });
  try {
    await openDeck(page);
    await active(page);
    await send(page, { evidence: 'stalled' });
    await page.getByText('Tracking interrupted', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'Focus rescue' }).count(), 0);
    await page.evaluate(() => { window.lockinReplay.focused = false; });
    await page.getByRole('dialog', { name: 'Focus rescue' }).getByText('Left the study window', { exact: true }).waitFor();
    await screenshot(page, 'window-rescue.png');
    assert.deepEqual(errors, []);
    console.log('Window rescue: stalled gaze expires, window trigger still has its own reason.');
  } finally {
    await context.close();
  }
}

if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  checkSourceTimeBoundary();
  await checkRulesDemo(browser);
  await checkModel(browser);
  await checkResume(browser);
  await checkSkipPendingCamera(browser);
  await checkGazeRescue(browser);
  await checkWindowRescue(browser);
} finally {
  await browser.close();
}
