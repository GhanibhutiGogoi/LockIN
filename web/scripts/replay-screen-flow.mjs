// Browser orchestration with controlled gaze, real OCR/relevance, and a verified real MP4.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5181/';
const realMedia = process.argv.includes('--real-media');
const voiceUrl = process.env.LOCKIN_TEST_VOICE_URL ?? 'http://127.0.0.1:18114/';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const verified = JSON.parse(readFileSync(new URL('../../.runtime/windows/full-flow.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('lockin.integrations.v2', JSON.stringify({ attention: { mode: 'off', url: '' }, adaptive: { mode: 'local', url: '' } }));
    const study = ['Data Mining', 'Outlier detection identifies unusual observations.', 'A boxplot shows the median and interquartile range.'];
    const shopping = ['Shopping cart', 'Summer dresses 50 percent off. Buy two shirts.', 'Checkout now with your credit card.'];
    const state = { focus: false, gaze: 'screen', lines: study, emitters: new Set(), timer: null, since: Date.now() };
    window.flow = {
      state,
      look(value) { state.gaze = value; state.since = Date.now(); },
      content(value) { state.lines = value === 'study' ? study : shopping; },
      focus(value) { state.focus = value; window.dispatchEvent(new Event('focus')); },
    };
    document.hasFocus = () => state.focus;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = 'black'; ctx.font = '36px sans-serif';
        state.lines.forEach((line, i) => ctx.fillText(line, 45, 100 + i * 100));
      };
      draw(); clearInterval(state.timer); state.timer = setInterval(draw, 200);
      const stream = canvas.captureStream(5);
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), displaySurface: 'monitor' });
      return stream;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  const errors = [];
  const requests = new Map();
  const serviceTimings = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /:8013\/(scripts|media)$/.test(request.url())) requests.set(request, Date.now());
  });
  page.on('response', response => {
    const started = requests.get(response.request());
    if (started) {
      const timing = { endpoint: new URL(response.url()).pathname, seconds: (Date.now() - started) / 1000, status: response.status() };
      serviceTimings.push(timing); console.log('SERVICE TIMING', JSON.stringify(timing));
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED', request.url(), request.failure()?.errorText));
  page.on('console', message => { if (message.type() === 'error') console.log('BROWSER ERROR', message.text()); });
  if (!realMedia) {
    await page.route('http://127.0.0.1:8013/scripts', route => route.fulfill({ json: verified.script.result }));
    await page.route('http://127.0.0.1:8013/media', route => route.fulfill({ json: verified.media.result }));
  }
  await page.goto(url);
  await page.evaluate(async voiceUrl => {
    const { registerAttentionPlugin, registry } = await import('/src/providers/registry.ts');
    const { actions } = await import('/src/store.ts');
    const state = window.flow.state;
    let timer;
    const geometry = { width: 1280, height: 720, screenWidth: 1280, screenHeight: 720,
      windowX: 0, windowY: 0, pixelRatio: 1, fullscreen: true };
    const calibration = { id: 'replay-calibration', at: Date.now(), model: 'controlled-test',
      coordinateSpace: 'screen', geometry, validation: { passed: true, meanErrorPx: 100, maxErrorPx: 150 } };
    registerAttentionPlugin('flow-gaze', 'Controlled replay', () => ({
      name: 'Controlled replay', usesOffscreenRule: true,
      start: async () => {
        clearInterval(timer);
        timer = setInterval(() => {
          const away = state.gaze === 'away';
          const sample = { t: Date.now(), score: away ? 0 : 100, confidence: state.gaze === 'unknown' ? 0 : 1,
            gazeTracking: { state: state.gaze, awayMs: away ? Date.now() - state.since : 0, thresholdMs: 30000 },
            gazeTrace: { calibration, geometry, raw: { x: away ? 1.2 : .5, y: .5 }, valid: true, reason: state.gaze } };
          for (const emit of state.emitters) emit(sample);
        }, 200);
      },
      stop: async () => clearInterval(timer),
      onSample: emit => { state.emitters.add(emit); return () => state.emitters.delete(emit); },
    }));
    registry.set('attention', { mode: 'flow-gaze' });
    registry.setAI({ content: { mode: 'http', url: 'http://127.0.0.1:8013/' },
      media: { mode: 'http', url: 'http://127.0.0.1:8013/', voiceUrl } });
    actions.setSettings({ slangLevel: 'plain' });
  }, voiceUrl);

  async function start() {
    await page.locator('#screen-goal').fill('Study data mining and outlier detection');
    await page.getByRole('button', { name: 'Share your screen' }).click();
    const consent = page.getByRole('button', { name: 'I agree, start studying' });
    if (await consent.isVisible()) await consent.click();
    await page.locator('[data-screen-activity="related"]').waitFor({ timeout: 90_000 });
    console.log('PASS: external study screen read and classified.');
  }
  async function completeRescue() {
    const deadline = Date.now() + (realMedia ? 420_000 : 45_000);
    let phase;
    while (Date.now() < deadline) {
      phase = await page.evaluate(async () => (await import('/src/store.ts')).useApp.getState().rescue?.phase);
      const failure = await page.evaluate(async () => (await import('/src/lib/screenShare.ts')).getScreenTimeline()?.events.find(e => e.type === 'preparation-error'));
      if (failure) throw new Error(`Preparation failed: ${failure.detail}`);
      if (phase === 'loading') break;
      await page.waitForTimeout(250);
    }
    if (phase !== 'loading') {
      console.log(await page.evaluate(async () => ({ live: (await import('/src/store.ts')).useApp.getState().live,
        events: (await import('/src/lib/screenShare.ts')).getScreenTimeline()?.events })));
    }
    assert.equal(phase, 'loading');
    await page.evaluate(() => window.flow.focus(true));
    const video = page.getByLabel('Gameplay recap');
    await video.waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('video[aria-label="Gameplay recap"]')?.currentTime > 0, { timeout: 15_000 });
    await video.evaluate(element => { element.playbackRate = 16; });
    const answers = page.getByRole('group', { name: /Answers/ });
    await answers.waitFor({ timeout: 15_000 });
    await answers.getByRole('button').first().click();
    await page.getByRole('button', { name: /Back to/ }).click();
    await page.evaluate(() => { window.flow.look('screen'); window.flow.content('study'); window.flow.focus(false); });
    await page.locator('[data-screen-activity="related"]').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(6500);
    console.log('PASS: actual MP4 playback -> answer -> return to study.');
  }
  async function finish(name) {
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('button', { name: 'See my report' }).click();
    await page.getByRole('button', { name: 'Download report' }).waitFor({ timeout: 60_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download report' }).click();
    const stream = await (await download).createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.timestampUnit, 'unix-ms');
    assert.doesNotMatch(JSON.stringify(report), /"t":/);
    assert.ok(report.log.samples.length > 0);
    assert.ok(report.log.gazeTrace.samples.length > 0);
    assert.equal(report.log.rescues[0].context.trigger, name);
    assert.equal(report.questions.length, 1);
    assert.ok(report.log.screenAnalysis.windows.some(w => w.focusedMs > 0));
    const { summary, measurements, events } = report.log.screenAnalysis;
    assert.ok(summary.focusedMs > 5000);
    const returnedAt = events.findLast(e => e.type === 'returned-to-study').timestamp;
    const postRecapFocusMs = measurements.filter(m => m.timestamp >= returnedAt && m.evidence === 'focused')
      .reduce((total, m) => total + m.durationMs, 0);
    assert.ok(postRecapFocusMs >= 5000, `Only ${postRecapFocusMs}ms focused after returning to study`);
    await page.getByText(/After your last recap:/).waitFor();
    writeFileSync(new URL(`../../.runtime/windows/browser-${name}.json`, import.meta.url), JSON.stringify(report, null, 2));
    console.log(`PASS: ${name} report, aligned measurements and timestamp export.`);
  }

  await start();
  if (realMedia) {
    await page.evaluate(() => window.flow.look('away'));
    await page.waitForTimeout(35_000);
    await page.evaluate(() => window.flow.look('unknown'));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.flow.look('away'));
    await completeRescue();
    const events = await page.evaluate(async () => (await import('/src/lib/screenShare.ts')).getScreenTimeline().events);
    const started = events.find(e => e.type === 'preparation-started');
    const ready = events.find(e => e.type === 'preparation-ready');
    const requested = events.find(e => e.type === 'playback-requested');
    assert.ok(started && ready && requested);
    assert.equal(events.filter(e => e.type === 'preparation-started').length, 1);
    assert.ok(!events.some(e => e.type === 'preparation-cancelled'));
    const timing = { preparationToReadySeconds: (ready.timestamp - started.timestamp) / 1000,
      readyToPlaybackRequestSeconds: (requested.timestamp - ready.timestamp) / 1000, serviceTimings, events };
    writeFileSync(new URL('../../.runtime/windows/real-playback-timing.json', import.meta.url), JSON.stringify(timing, null, 2));
    console.log('REAL TIMING', JSON.stringify(timing));
    await finish('gaze');
    assert.deepEqual(errors, []);
    console.log('PASS: live script -> voice -> MP4 generation, brief tracking loss, continued distraction -> playback -> quiz.');
  } else {
  await page.evaluate(() => window.flow.look('away'));
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.flow.look('screen'));
  await page.waitForTimeout(1600);
  assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useApp.getState().live.recapPreparation), undefined);
  console.log('PASS: brief distraction prepares but recovery cancels interruption.');
  await page.evaluate(() => window.flow.content('shopping'));
  await page.locator('[data-screen-activity="off-topic"]').waitFor({ timeout: 60_000 });
  await completeRescue(); await finish('content');
  await page.getByRole('button', { name: 'New screen session' }).click();
  await start();
  await page.evaluate(() => window.flow.look('away'));
  await completeRescue(); await finish('gaze');
  assert.deepEqual(errors, []);
  console.log('PASS: both complete browser intervention paths. Gaze is controlled test input; OCR/classification and MP4 playback are real.');
  }
} finally { await browser.close(); }
