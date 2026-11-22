// Browser integration replay: real capture lifecycle and reports, synthetic gaze/OCR.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5181/');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const artifacts = process.env.LOCKIN_TRACE_ARTIFACTS;
const nativeSwitch = process.env.LOCKIN_NATIVE_SWITCH === '1';
if (artifacts) await mkdir(artifacts, { recursive: true });
const worker = `
let calibrationId, mode = 'valid', count = 0;
self.onmessage = ({ data }) => {
  if (data.type === 'init') setTimeout(() => self.postMessage({ type: 'ready', protocolVersion: 5, captureRounds: true }), 700);
  if (data.type === 'reset') calibrationId = data.calibrationId;
  if (data.type === 'replay') mode = data.mode;
  if (data.type === 'point') {
    const p = data.point;
    setTimeout(() => self.postMessage({ type: 'pointDone', index: p.index, validation: p.validation,
      calibrationId: p.calibrationId, captureRound: p.captureRound, predicted: [p.x, p.y] }), 100);
  }
  if (data.type === 'fit') self.postMessage({ type: 'fitted', calibrationId });
  if (data.type === 'frame') {
    const valid = mode !== 'missing';
    const angle = count++ * .16;
    const gaze = mode === 'outside' ? [.8, .2] : [Math.sin(angle) * .32, Math.cos(angle) * .3];
    self.postMessage({ type: 'result', capturedAt: data.timestamp, captureRound: data.captureRound,
      face: valid, eyesOpen: valid, gaze: valid ? gaze : null, outside: mode === 'outside', calibrationId,
      diagnostic: { model: 'replay', ruleVersion: 'replay', timing: {}, capturedAt: data.timestamp,
        reason: valid ? 'screen' : 'no_face', rawOutside: mode === 'outside', confirmedOutside: mode === 'outside',
        face: valid, eyesOpen: valid, eyeAspect: null, head: null, features: null, mappedGaze: valid ? gaze : null }
    });
  }
};`;

async function download(page, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const stream = await (await pending).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

let nativeChrome;
async function launchNative() {
  const executable = process.env.LOCKIN_CHROME_EXECUTABLE ?? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].find(existsSync);
  assert.ok(executable, 'Set LOCKIN_CHROME_EXECUTABLE for the native switch test.');
  const profile = await mkdtemp(join(tmpdir(), 'lockin-gaze-switch-'));
  nativeChrome = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome debugging endpoint timed out.')), 15_000);
    let output = '';
    nativeChrome.stderr.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    nativeChrome.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return chromium.connectOverCDP(endpoint, { noDefaults: true });
}
const browser = nativeSwitch ? await launchNative() : await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
let activePage;
try {
  for (const withOcr of nativeSwitch ? [true] : [false, true]) {
    const context = nativeSwitch ? browser.contexts()[0] : await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 900 },
      screen: withOcr ? { width: 1280, height: 900 } : { width: 1920, height: 1080 } });
    await context.route('**/tracker/gaze-worker.js', route => route.fulfill({ contentType: 'text/javascript', body: worker }));
    await context.route('**/v1/web-screen/**', route => {
      const path = new URL(route.request().url()).pathname;
      const body = path.endsWith('/status') ? { status: withOcr ? 'ready' : 'loading', engine: 'replay', message: 'Replay OCR' }
        : path.endsWith('/text') ? { lines: ['Data Mining study notes'], durationMs: 10, engine: 'replay' }
        : path.endsWith('/activity') ? { label: 'related' } : {};
      return route.fulfill({ json: body });
    });
    await context.addInitScript(({ nativeSwitch }) => {
      localStorage.setItem('lockin.integrations.demo', JSON.stringify({ attention: { mode: 'local-gaze', url: '' }, adaptive: { mode: 'local', url: '' } }));
      if (!nativeSwitch) document.hasFocus = () => false;
      const workers = [];
      const videos = [];
      const createElement = document.createElement.bind(document);
      document.createElement = (name, ...args) => {
        const element = createElement(name, ...args);
        if (name === 'video') videos.push(element);
        return element;
      };
      window.traceReplay = { videos, set: mode => workers.at(-1).postMessage({ type: 'replay', mode }) };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) { super(url, options); if (String(url).endsWith('/tracker/gaze-worker.js')) workers.push(this); }
      };
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext('2d');
        const draw = () => { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = 'black'; ctx.fillText('Data Mining', 20, 40); };
        draw(); setInterval(draw, 200);
        return canvas.captureStream(5);
      };
    }, { nativeSwitch });
    const page = await context.newPage();
    activePage = page;
    if (nativeSwitch) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15_000);
    await page.goto(url.href);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Share your screen', exact: true }).click();
    await page.getByRole('button', { name: 'I agree, start studying' }).click();
    await page.getByRole('button', { name: withOcr ? 'Calibrate in fullscreen' : 'Use window coordinates' }).click();
    await page.getByRole('button', { name: 'Start calibration', exact: true }).click();
    await page.getByRole('button', { name: 'Start validation', exact: true }).click();
    await page.getByRole('button', { name: 'Start learning', exact: true }).click();
    await page.getByRole('button', { name: 'Finish', exact: true }).waitFor();
    let backgroundAt, foregroundAt;
    if (nativeSwitch) {
      console.log('NATIVE_SWITCH_READY: activate WPS now; the replay will observe background capture for 12 seconds.');
      await page.waitForFunction(() => !document.hasFocus(), null, { timeout: 60_000, polling: 100 });
      backgroundAt = Date.now();
      await page.waitForTimeout(12_000);
      foregroundAt = Date.now();
      await page.bringToFront();
    }
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.traceReplay.set('missing'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.traceReplay.set('outside'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.traceReplay.set('valid'));
    await page.waitForTimeout(3500);
    const transitionAt = Date.now();
    if (withOcr) await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    const cdp = await context.newCDPSession(page);
    if (nativeSwitch) {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1100, height: 750 } });
    } else {
      const screen = await page.evaluate(() => ({ width: window.screen.width, height: window.screen.height, ratio: devicePixelRatio }));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 750, screenWidth: screen.width, screenHeight: screen.height, deviceScaleFactor: screen.ratio, mobile: false });
    }
    await page.waitForTimeout(2500);
    const scaleChangedAt = Date.now();
    if (withOcr) {
      await page.evaluate(() => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: devicePixelRatio + .5 }));
      await page.waitForTimeout(1500);
    }
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('button', { name: 'See my report', exact: true }).click();
    await page.getByRole('heading', { name: 'Gaze trajectory', exact: true }).waitFor();
    const chart = page.getByRole('img', { name: 'Gaze movement in the calibrated viewport', exact: true });
    await chart.scrollIntoViewIfNeeded();
    const report = nativeSwitch
      ? await page.evaluate(async () => (await import('/src/store.ts')).useApp.getState().report)
      : JSON.parse(await download(page, 'Download report'));
    const trace = report.log.gazeTrace;
    assert.ok(trace.samples.filter(s => s.status === 'valid').length >= 15);
    assert.ok(trace.samples.some(s => s.status === 'invalid'));
    assert.ok(trace.samples.some(s => s.status === 'outside' && s.raw.x > 1 && s.display === null));
    assert.ok(new Set(trace.samples.filter(s => s.status === 'valid').map(s => s.segment)).size >= 2);
    assert.equal(trace.calibrations[0].geometry.fullscreen, withOcr);
    assert.equal(report.log.samples.length > 0, withOcr);
    assert.equal(trace.calibrations[0].coordinateSpace, withOcr ? 'screen' : 'viewport');
    assert.ok(trace.samples.some(s => s.reason === 'geometry_changed'));
    if (withOcr) {
      assert.ok(trace.samples.some(s => s.capturedAt > transitionAt + 500 && s.capturedAt < scaleChangedAt && s.status === 'valid'), 'Screen calibration must survive fullscreen exit and browser resize.');
      assert.ok(trace.samples.filter(s => s.capturedAt > scaleChangedAt + 500).every(s => s.display === null));
      assert.ok(trace.geometryEvents.some(e => !e.invalidates));
    }
    assert.ok(trace.geometryEvents.some(e => e.invalidates));
    if (nativeSwitch) {
      const background = trace.samples.filter(s => s.capturedAt > backgroundAt + 500 && s.capturedAt < foregroundAt);
      assert.ok(background.filter(s => s.status === 'valid').length >= 10, 'Real background window must continue receiving gaze samples.');
      assert.ok(!background.some(s => s.reason === 'geometry_changed'));
      console.log(`PASS: real app switch retained ${background.filter(s => s.status === 'valid').length} valid background samples.`);
    }
    const svg = nativeSwitch ? await chart.evaluate(node => new XMLSerializer().serializeToString(node))
      : await download(page, 'Download trajectory SVG');
    assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /data-gaze-path/);
    assert.ok(svg.includes('L'), 'The export must include real connected path segments.');
    await page.getByRole('checkbox', { name: 'Smooth path' }).uncheck();
    await page.getByLabel('Trajectory start time', { exact: true }).fill('1000');
    assert.match(await chart.textContent(), /1.0s/);
    if (artifacts) {
      const name = withOcr ? 'combined' : 'gaze-only';
      await chart.screenshot({ path: join(artifacts, `${name}.png`) });
      await writeFile(join(artifacts, `${name}.svg`), svg);
      await writeFile(join(artifacts, `${name}.json`), JSON.stringify(report, null, 2));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(el => el.getBoundingClientRect().right > innerWidth + 1)
      .map(el => `${el.tagName}.${el.className?.baseVal ?? el.className}`).slice(0, 12));
    assert.deepEqual(overflow, [], 'Report elements must fit the narrow viewport.');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${withOcr ? 'fullscreen + combined focus' : 'window + no OCR'} → trajectory, gaps, out-of-bounds, filters, ${nativeSwitch ? 'SVG and JSON serialization' : 'SVG and JSON downloads'}.`);
    if (!nativeSwitch) await context.close();
  }
} catch (error) {
  console.error('Replay page:', await activePage?.locator('body').innerText().catch(() => 'unavailable'));
  console.error('Capture state:', await activePage?.evaluate(() => ({ focus: document.hasFocus(), visibility: document.visibilityState,
    videos: window.traceReplay?.videos.map(v => ({ paused: v.paused, readyState: v.readyState, width: v.videoWidth, height: v.videoHeight,
      tracks: v.srcObject?.getVideoTracks().map(t => ({ state: t.readyState, muted: t.muted, enabled: t.enabled })) })) })).catch(() => null));
  throw error;
} finally {
  await browser.close();
  nativeChrome?.kill();
}
