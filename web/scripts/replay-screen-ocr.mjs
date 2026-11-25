// Exercise browser capture -> Vite proxy -> real local OCR without a webcam.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5181/');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const screenshot = process.env.LOCKIN_OCR_REPLAY_IMAGE
  ? `data:image/png;base64,${readFileSync(process.env.LOCKIN_OCR_REPLAY_IMAGE).toString('base64')}` : null;
const expected = process.env.LOCKIN_OCR_REPLAY_EXPECT ?? 'Data Mining';
try {
  const context = await browser.newContext();
  await context.addInitScript(({ screenshot }) => {
    localStorage.setItem('lockin.integrations.demo', JSON.stringify({
      attention: { mode: 'off', url: '' }, adaptive: { mode: 'local', url: '' },
    }));
    document.hasFocus = () => false;
    let lines = ['Data Mining', '\u6570\u636e\u6316\u6398', 'Outlier detection and clustering'];
    let track;
    let timer;
    let capturedImage;
    let initialImage;
    window.ocrReplay = { draw(value) { capturedImage = null; lines = value; }, restoreCapture() { capturedImage = initialImage; }, enabled() { return track?.enabled; }, state() { return track?.readyState; } };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 720;
      if (screenshot) {
        capturedImage = new Image();
        capturedImage.src = screenshot;
        await capturedImage.decode();
        initialImage = capturedImage;
        canvas.width = capturedImage.width; canvas.height = capturedImage.height;
      }
      const ctx = canvas.getContext('2d');
      const draw = () => {
        if (capturedImage) { ctx.drawImage(capturedImage, 0, 0); return; }
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'black'; ctx.font = '44px "Microsoft YaHei", sans-serif';
        lines.forEach((line, index) => ctx.fillText(line, 60, 100 + index * 95));
      };
      draw();
      const stream = canvas.captureStream(5);
      track = stream.getVideoTracks()[0];
      clearInterval(timer); timer = setInterval(draw, 200);
      return stream;
    };
  }, { screenshot });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href);
  await page.getByRole('button', { name: 'Share your screen' }).click();
  const notifications = page.getByRole('checkbox', { name: /Call me back/ });
  if (await notifications.count()) await notifications.uncheck();
  await page.getByRole('button', { name: 'I agree, start studying' }).click();
  // OCR content remains in session state; the UI now shows classification history.
  await page.evaluate(async () => { window.ocrTestStore = (await import('/src/store.ts')).useApp; });
  const detectedText = () => page.evaluate(() => {
    const s = window.ocrTestStore.getState();
    return s.decks.find(d => d.id === s.deckId)?.slides[s.slideIndex]?.text ?? '';
  });
  const waitForText = (text, timeout) => page.waitForFunction(expected => {
    const s = window.ocrTestStore.getState();
    const text = s.decks.find(d => d.id === s.deckId)?.slides[s.slideIndex]?.text ?? '';
    return ['ready', 'on-lockin'].includes(s.screenReading) && text.includes(expected);
  }, text, { timeout });
  await waitForText(expected, 120_000);
  if (!screenshot) assert.match(await detectedText(), /\u6570\u636e\u6316\u6398/);
  await page.evaluate(() => window.ocrReplay.draw(['Regression and classification']));
  await waitForText('Regression', 15_000);
  await page.keyboard.press('p');
  await page.getByText('Screen reading paused', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.ocrReplay.enabled()), false);
  await page.keyboard.press('p');
  await waitForText('Regression', 15_000);
  await page.evaluate(() => window.ocrReplay.draw([]));
  await page.getByText('No readable text on the shared screen.', { exact: true }).waitFor({ timeout: 15_000 });
  await page.route('**/v1/web-screen/status', route => route.fulfill({ status: 503, body: '{}' }));
  await page.locator('[data-screen-ocr]').filter({ hasText: 'unavailable' }).waitFor({ timeout: 10_000 });
  await page.unroute('**/v1/web-screen/status');
  await page.evaluate(() => window.ocrReplay.draw(['Recovery after service failure']));
  await waitForText('Recovery', 15_000);
  // Screen sessions retain the current text, not every previous captured page.
  if (screenshot) {
    await page.evaluate(() => window.ocrReplay.restoreCapture());
    await waitForText(expected, 40_000);
  }
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  assert.equal(await page.evaluate(() => window.ocrReplay.state()), 'ended');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'See my report' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report' }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.ok(report.deck.slides.length >= 3);
  assert.ok(report.deck.slides.some(slide => slide.text.includes(screenshot ? expected : 'Recovery')), 'The report must retain the current document text.');
  assert.ok(report.log.screenDiagnostics.samples.some(sample => sample.status === 'ready' && sample.lineCount > 0));
  assert.ok(report.log.screenDiagnostics.samples.some(sample => sample.status === 'error'));
  assert.deepEqual(report.log.samples, [], 'Camera-off OCR sessions must not claim measured focus.');
  assert.deepEqual(errors, []);
  console.log('PASS: real bilingual OCR, page change, pause/resume, blank frame, error recovery, stop, and report diagnostics.');
} finally {
  await browser.close();
}
