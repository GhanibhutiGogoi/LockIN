// Browser orchestration with controlled gaze, real OCR/relevance, and actual media playback.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5181/';
const recoveryMode = process.argv.includes('--recovery');
const gridMode = process.argv.includes('--video-grid');
const scrollingMode = process.argv.includes('--scrolling') || gridMode;
const emailMode = process.argv.includes('--email') || scrollingMode;
const deadlineMode = process.argv.includes('--deadline') || recoveryMode;
const realMedia = deadlineMode || emailMode || process.argv.includes('--real-media');
const voiceFile = new URL('../../.runtime/windows/narration-url.txt', import.meta.url);
const voiceUrl = process.env.LOCKIN_TEST_VOICE_URL ?? (existsSync(voiceFile) ? readFileSync(voiceFile, 'utf8').trim() : 'http://127.0.0.1:18114/');
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const verified = realMedia ? null : JSON.parse(readFileSync(new URL('../../.runtime/windows/full-flow.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

try {
  const context = await browser.newContext();
  await context.addInitScript(({ scrollingMode, gridMode }) => {
    localStorage.setItem('lockin.integrations.v2', JSON.stringify({ attention: { mode: 'off', url: '' }, adaptive: { mode: 'local', url: '' } }));
    const study = ['Data Mining', 'Outlier detection identifies unusual observations.', 'A boxplot shows the median and interquartile range.'];
    const nextStudy = ['Density-based outlier detection', 'Local Outlier Factor compares neighborhood density.', 'Low density relative to neighbors signals an outlier.'];
    const shopping = ['Shopping cart', 'Summer dresses 50 percent off. Buy two shirts.', 'Checkout now with your credit card.'];
    const email = ['University Forum: HydroGym', 'Transferable flow-control priors',
      'Reinforcement learning for fluid flow control.', 'A lecture on laminar and turbulent flows.'];
    const novel = [
      ['Chapter One: The Moonlit Castle', 'Princess Mira opened the ancient wooden door.', 'A silver dragon slept beneath the tower.', 'The knight whispered: our journey begins tonight.'],
      ['Chapter Two: The Enchanted Forest', 'Mira followed the wizard into the dark woods.', 'An enchanted sword glowed beside the river.', 'The dragon promised to protect the lost kingdom.'],
      ['Chapter Three: The Hidden Crown', 'The knight found a golden crown under the stars.', 'Mira heard footsteps in the empty palace.', 'The wizard vanished through a secret passage.'],
    ];
    const state = { focus: false, gaze: 'screen', lines: study, studyVersion: 0, content: 'study', contentAt: Date.now(), emitters: new Set(), timer: null, since: Date.now() };
    window.flow = {
      state,
      look(value) { state.gaze = value; state.since = Date.now(); },
      nextLesson() { state.studyVersion = 1; },
      content(value) { state.content = value; state.contentAt = Date.now(); state.lines = value === 'study' ? (state.studyVersion ? nextStudy : study) : value === 'email' ? email : shopping; },
      focus(value) { state.focus = value; window.dispatchEvent(new Event('focus')); },
    };
    document.hasFocus = () => state.focus;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = 'black'; ctx.font = '36px sans-serif';
        if (scrollingMode) {
          ctx.font = '24px sans-serif';
          ctx.fillText(state.content === 'novel' ? 'Novel reader - The Moonlit Castle' : 'Course reader - Outlier detection', 35, 30);
          ctx.fillText(state.content === 'novel' ? 'https://reader.example/book/moonlit-castle' : 'https://course.example/outliers', 35, 65);
          // Reproduce a browser news widget and a changing LockIn recovery hint.
          // These used to break whole-header continuity on every capture.
          ctx.font = '18px sans-serif';
          ctx.fillText(`News update ${Math.floor(Date.now() / 500)}`, 850, 65);
          ctx.fillText(`Checking the shared page ${Math.floor(Date.now() / 1000)}`, 10, 100);
          ctx.font = '32px sans-serif';
          const elapsed = Date.now() - state.contentAt;
          const lines = state.content === 'novel' ? novel[Math.floor(elapsed / 2500) % novel.length] : state.lines;
          const offset = state.content === 'novel' ? (elapsed % 2500) / 40 : 0;
          if (gridMode && state.content === 'novel') {
            const titles = ['探访世界各地的美食与生活', '旅行纪录片：城市里的烟火人间', '谁能锻造最强武器挑战赛', '音乐现场：爵士乐的奇妙夜晚', '野生动物纪录片：森林的秘密', '跟着旅行家探索陌生的城市'];
            ctx.font = '18px "Microsoft YaHei", sans-serif';
            ctx.fillText('首页 番剧 直播 游戏中心 会员购 漫画 赛事 下载客户端', 30, 130);
            for (let row = 0; row < 6; row++) for (let col = 0; col < 4; col++) {
              const x = 25 + col * 310, y = 165 + row * 105 - offset;
              ctx.fillStyle = `hsl(${(row * 45 + col * 70 + Math.floor(elapsed / 2500) * 30) % 360} 45% 75%)`;
              ctx.fillRect(x, y, 290, 35);
              ctx.fillStyle = 'black';
              ctx.fillText(titles[(row + col + Math.floor(elapsed / 2500)) % titles.length], x, y + 55);
              ctx.fillText('UP主 旅行日记', x, y + 75);
              ctx.fillText('1.2万次观看 · 昨天发布', x, y + 95);
            }
          } else lines.forEach((line, i) => ctx.fillText(line, 45, 180 + i * 100 - offset));
        } else state.lines.forEach((line, i) => ctx.fillText(line, 45, 100 + i * 100));
      };
      draw(); clearInterval(state.timer); state.timer = setInterval(draw, 200);
      const stream = canvas.captureStream(5);
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), displaySurface: 'monitor' });
      return stream;
    };
  }, { scrollingMode, gridMode });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  const errors = [];
  const requests = new Map();
  const serviceTimings = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /:8013\/(scripts|media(?:\/live)?)$/.test(request.url())) requests.set(request, Date.now());
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
    await page.route('http://127.0.0.1:8013/media/live', route => route.fulfill({ json: verified.media.result }));
  }
  await page.goto(url);
  await page.evaluate(async ({ voiceUrl, recoveryMode }) => {
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
    actions.setSettings({ slangLevel: 'plain', ...(recoveryMode ? { cooldownSec: 0 } : {}) });
  }, { voiceUrl, recoveryMode });

  async function start() {
    await page.locator('#screen-goal').fill('Study data mining and outlier detection');
    await page.getByRole('button', { name: 'Share your screen' }).click();
    const consent = page.getByRole('button', { name: 'I agree, start studying' });
    const consented = await page.evaluate(async () => { const { useApp } = await import('/src/store.ts'); const { CONSENT_VERSION } = await import('/src/components/ConsentScreen.tsx'); return useApp.getState().consent === CONSENT_VERSION; });
    if (!consented) await consent.click();
    await page.locator('[data-screen-activity="related"]').waitFor({ timeout: 90_000 });
    console.log('PASS: external study screen read and classified.');
  }
  async function completeRescue(nextLesson = false) {
    const deadline = Date.now() + (realMedia ? 420_000 : 45_000);
    let lastStatus = Date.now();
    let phase;
    while (Date.now() < deadline) {
      phase = await page.evaluate(async () => (await import('/src/store.ts')).useApp.getState().rescue?.phase);
      const failure = await page.evaluate(async () => (await import('/src/lib/screenShare.ts')).getScreenTimeline()?.events.find(e => e.type === 'preparation-error'));
      if (failure) throw new Error(`Preparation failed: ${failure.detail}`);
      if (phase === 'loading' || (deadlineMode && phase === 'playing')) break;
      if (Date.now() - lastStatus > 20_000) {
        lastStatus = Date.now();
        console.log('WAITING', await page.evaluate(async () => ({ live: (await import('/src/store.ts')).useApp.getState().live,
          controls: (await import('/src/lib/screenShare.ts')).getScreenTimeline()?.controlSamples.slice(-1) })));
      }
      await page.waitForTimeout(250);
    }
    if (phase !== 'loading' && !(deadlineMode && phase === 'playing')) {
      console.log(await page.evaluate(async () => ({ live: (await import('/src/store.ts')).useApp.getState().live,
        events: (await import('/src/lib/screenShare.ts')).getScreenTimeline()?.events })));
    }
    assert.ok(phase === 'loading' || (deadlineMode && phase === 'playing'));
    await page.evaluate(() => window.flow.focus(true));
    const video = page.getByLabel(/^(Live gameplay recap|Gameplay recap)$/);
    await video.waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('video[aria-label="Gameplay recap"], video[aria-label="Live gameplay recap"]')?.currentTime > 0, { timeout: 15_000 });
    if (!realMedia) await video.evaluate(element => { element.playbackRate = 16; });
    const answers = page.getByRole('group', { name: /Answers/ });
    await answers.waitFor({ timeout: realMedia ? 120_000 : 15_000 });
    await answers.getByRole('button').first().click();
    await page.getByRole('button', { name: /Back to/ }).click();
    await page.evaluate(next => { if (next) window.flow.nextLesson(); window.flow.look('screen'); window.flow.content('study'); window.flow.focus(false); }, nextLesson);
    await page.locator('[data-screen-activity="related"]').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(6500);
    console.log('PASS: actual media playback -> answer -> return to study.');
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
    assert.equal(report.questions.length, recoveryMode ? 2 : 1);
    if (recoveryMode) assert.deepEqual(report.log.rescues.map(r => r.context.trigger), scrollingMode ? ['content', 'content'] : ['gaze', 'content']);
    if (scrollingMode && recoveryMode) assert.notEqual(report.log.rescues[0].context.slideIndex, report.log.rescues[1].context.slideIndex, 'Second recap must use the newer lesson');
    assert.ok(report.log.screenAnalysis.windows.some(w => w.focusedMs > 0));
    const { summary, measurements, events } = report.log.screenAnalysis;
    assert.ok(summary.focusedMs > 5000);
    const returnedAt = events.findLast(e => e.type === 'returned-to-study').timestamp;
    const postRecapFocusMs = measurements.filter(m => m.timestamp >= returnedAt && m.evidence === 'focused')
      .reduce((total, m) => total + m.durationMs, 0);
    assert.ok(postRecapFocusMs >= 5000, `Only ${postRecapFocusMs}ms focused after returning to study`);
    await page.getByText(/After your last recap:/).waitFor();
    writeFileSync(new URL(`../../.runtime/windows/browser-${gridMode ? 'video-grid' : scrollingMode ? 'scrolling' : recoveryMode ? 'recovery' : name}.json`, import.meta.url), JSON.stringify(report, null, 2));
    console.log(`PASS: ${name} report, aligned measurements and timestamp export.`);
  }

  await start();
  if (emailMode) {
    const openedAt = await page.evaluate(scrolling => { window.flow.content(scrolling ? 'novel' : 'email'); return Date.now(); }, scrollingMode);
    await page.waitForFunction(async () => (await import('/src/store.ts')).useApp.getState().live.screenDwellMs > 1000, { timeout: 90_000 });
    await completeRescue(scrollingMode && recoveryMode);
    const analysis = await page.evaluate(async () => {
      const t = (await import('/src/lib/screenShare.ts')).getScreenTimeline();
      return { events: t.events, scenes: t.scenes, controls: t.controlSamples };
    });
    const eventAt = type => analysis.events.find(e => e.type === type)?.timestamp;
    assert.ok(eventAt('playback-confirmed'), 'Real narration must actually start');
    assert.equal(analysis.events.find(e => e.type === 'playback-requested')?.detail, 'content');
    assert.ok(analysis.controls.some(c => c.dwellMs >= 30_000));
    const emailScene = analysis.scenes.find(s => s.timestamp >= openedAt && s.label === 'off-topic');
    assert.ok(emailScene);
    if (scrollingMode) {
      const frames = analysis.scenes.filter(s => s.documentId === emailScene.documentId);
      assert.ok(frames.length >= 10, 'Exercise repeated scrolling/page turns, not a static page');
      assert.ok(analysis.controls.some(c => c.dwellMs >= 30_000));
      console.log('SCROLLING FRAMES', frames.length, 'DOCUMENT', emailScene.documentId);
    }
    const timing = { openedAt, classificationSeconds: (emailScene.classifiedAt - openedAt) / 1000,
      playbackRequestSeconds: (eventAt('playback-requested') - openedAt) / 1000,
      actualPlaybackSeconds: (eventAt('playback-confirmed') - openedAt) / 1000,
      serviceTimings, events: analysis.events };
    writeFileSync(new URL(`../../.runtime/windows/${gridMode ? 'video-grid' : scrollingMode ? 'scrolling' : 'email'}-playback-timing.json`, import.meta.url), JSON.stringify(timing, null, 2));
    console.log(gridMode ? 'VIDEO GRID TIMING' : scrollingMode ? 'SCROLLING TIMING' : 'EMAIL TIMING', JSON.stringify(timing));
    if (scrollingMode && recoveryMode) {
      assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useApp.getState().live.state), 'focused');
      await page.evaluate(() => { window.flow.content('novel'); window.flow.focus(false); });
      await completeRescue();
      console.log('PASS: newer lesson -> second scrolling distraction -> second real recap. Test cooldown disabled.');
    }
    await finish('content');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${gridMode ? 'continuously scrolling a dense Chinese video grid' : scrollingMode ? 'continuously scrolling and turning novel pages' : 'looking at an unrelated lecture email'} -> real OCR/classification -> real media -> playback -> quiz -> recovery.`);
  } else if (realMedia) {
    const awayStartedAt = await page.evaluate(deadlineMode => { window.flow.look('away'); if (deadlineMode) window.flow.focus(true); return Date.now(); }, deadlineMode);
    if (!deadlineMode) {
      await page.waitForTimeout(35_000);
      await page.evaluate(() => window.flow.look('unknown'));
      await page.waitForTimeout(600);
      await page.evaluate(() => window.flow.look('away'));
    }
    await completeRescue();
    const events = await page.evaluate(async () => (await import('/src/lib/screenShare.ts')).getScreenTimeline().events);
    const started = events.find(e => e.type === 'preparation-started');
    const ready = events.find(e => e.type === 'preparation-ready');
    const requested = events.find(e => e.type === 'playback-requested');
    assert.ok(started && ready && requested);
    assert.equal(events.filter(e => e.type === 'preparation-started').length, 1);
    assert.ok(!events.some(e => e.type === 'preparation-cancelled'));
    const confirmed = events.find(e => e.type === 'playback-confirmed');
    assert.ok(confirmed, 'Actual audio playback must be confirmed');
    const timing = { awayStartedAt, awayToPlaybackSeconds: (confirmed.timestamp - awayStartedAt) / 1000,
      preparationToReadySeconds: (ready.timestamp - started.timestamp) / 1000,
      readyToPlaybackRequestSeconds: (requested.timestamp - ready.timestamp) / 1000, serviceTimings, events };
    writeFileSync(new URL(deadlineMode ? '../../.runtime/windows/deadline-playback-timing.json' : '../../.runtime/windows/real-playback-timing.json', import.meta.url), JSON.stringify(timing, null, 2));
    console.log('REAL TIMING', JSON.stringify(timing));
    if (recoveryMode) {
      assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useApp.getState().live.state), 'focused');
      console.log('PASS: confirmed reading completes recovery and clears the progress indicator.');
      await page.evaluate(() => { window.flow.content('shopping'); window.flow.focus(false); });
      await page.locator('[data-screen-activity="off-topic"]').waitFor({ timeout: 60_000 });
      await completeRescue();
      console.log('PASS: another off-topic page triggers a second real recap in the same session (test cooldown disabled).');
    }
    await finish('gaze');
    assert.deepEqual(errors, []);
    console.log(`PASS: live script -> real voice -> browser composition -> ${deadlineMode ? '30-second threshold' : 'brief tracking loss'} -> playback -> quiz.`);
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
