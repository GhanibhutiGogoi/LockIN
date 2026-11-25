import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5180/');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
const artifacts = process.env.LOCKIN_REPLAY_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.LOCKIN_CHROME_EXECUTABLE ?? (existsSync(macChrome) ? macChrome : undefined);
const browser = await chromium.launch({ executablePath });

try {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const outbound = [];
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === url.origin) await route.continue();
    else {
      outbound.push(new URL(route.request().url()).hostname);
      await route.abort();
    }
  });
  await context.addInitScript(() => {
    localStorage.setItem('lockin.integrations.demo', JSON.stringify({
      attention: { mode: 'mock', url: '' },
      adaptive: { mode: 'memory', url: '' },
    }));
    document.hasFocus = () => false;

    let content = ['Cellular respiration', 'Cells convert glucose into ATP.'];
    let currentTrack;
    let drawTimer;
    let cancelled = false;

    window.screenReplay = {
      draw(lines) { content = lines; },
      cancelNext() { cancelled = true; },
      trackState() { return currentTrack?.readyState; },
      enabled() { return currentTrack?.enabled; },
      end() {
        currentTrack.stop();
        currentTrack.dispatchEvent(new Event('ended'));
      },
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (cancelled) {
        cancelled = false;
        throw new DOMException('Cancelled', 'NotAllowedError');
      }
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#000';
        ctx.font = '48px sans-serif';
        content.forEach((line, i) => ctx.fillText(line, 70, 100 + i * 90));
      };
      draw();
      const stream = canvas.captureStream(5);
      currentTrack = stream.getVideoTracks()[0];
      clearInterval(drawTimer);
      drawTimer = setInterval(draw, 200);
      return stream;
    };
  });

  const page = await context.newPage();
  const errors = [];
  const screenResponses = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/v1/web-screen/text') screenResponses.push(response.status());
  });
  await page.goto(url.href);
  const share = page.getByRole('button', { name: 'Share your screen' });
  await page.evaluate(() => window.screenReplay.cancelNext());
  await share.click();
  assert.ok(await share.isVisible());

  await share.click();
  assert.equal(await page.evaluate(() => window.screenReplay.enabled()), false);
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
  await waitForText('Cellular respiration', 15_000);
  assert.match(await detectedText(), /glucose into ATP/i);
  if (artifacts) await page.screenshot({ path: join(artifacts, 'reading-english.png') });

  await page.evaluate(() => window.screenReplay.draw(['线性代数', '矩阵乘法与向量空间']));
  await waitForText('矩阵乘法', 15_000);
  if (artifacts) await page.screenshot({ path: join(artifacts, 'reading-chinese.png') });

  assert.equal(await page.getByRole('dialog', { name: 'Focus rescue' }).count(), 0);
  const { active, score } = await page.evaluate(async () => {
    const { useApp } = await import('/src/store.ts');
    const { live } = useApp.getState();
    return { active: live.windowActive, score: live.effective };
  });
  assert.ok(active && score >= 65, 'Studying outside the LockIn tab should not lower focus.');

  await page.evaluate(() => window.screenReplay.draw([]));
  await page.getByText('No readable text on the shared screen.').waitFor({ timeout: 15_000 });
  assert.equal(await page.locator('[data-screen-text]').count(), 0);
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'Resume P', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.screenReplay.enabled()), false);
  await page.waitForTimeout(350);
  const whilePaused = screenResponses.length;
  await page.waitForTimeout(2400);
  assert.equal(screenResponses.length, whilePaused);

  await page.evaluate(() => window.screenReplay.draw(['Photosynthesis', 'Chlorophyll absorbs light to power photosynthesis.']));
  await page.getByRole('button', { name: 'Resume P', exact: true }).click();
  await waitForText('Chlorophyll', 15_000);

  const retrieval = page.waitForResponse((response) => {
    if (!new URL(response.url()).pathname.endsWith('/web-memory/retrieve')) return false;
    return /Chlorophyll/.test(response.request().postDataJSON()?.topic?.slide_text ?? '');
  });
  await page.keyboard.press('d');
  assert.equal((await retrieval).status(), 200);
  const rescue = page.getByRole('dialog', { name: 'Focus rescue' });
  await rescue.locator('[data-recap-playing]').waitFor({ timeout: 15_000 });
  assert.match(await rescue.innerText(), /Photosynthesis/);
  if (artifacts) {
    await page.screenshot({ path: join(artifacts, 'recap.png'), animations: 'disabled' });
  }
  await rescue.getByRole('button', { name: /I’m back/ }).click();
  await rescue.getByRole('group', { name: /Answers/ }).getByRole('button').first().click();
  await rescue.getByRole('button', { name: /Back to/ }).click();
  await page.keyboard.press('d');

  await page.evaluate(() => window.screenReplay.end());
  await page.getByText('Screen sharing stopped', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-screen-text]').count(), 0);
  await page.getByRole('button', { name: 'Share a screen' }).click();
  await waitForText('Chlorophyll', 15_000);
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  assert.equal(await page.evaluate(() => window.screenReplay.trackState()), 'ended');
  await page.getByRole('button', { name: 'Share a screen' }).click();
  await waitForText('Chlorophyll', 15_000);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'See my report' }).click();
  await page.getByRole('heading', { name: 'Screen moments recapped' }).waitFor();
  assert.equal(await page.evaluate(() => window.screenReplay.trackState()), 'ended');
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  // Apple Vision can time out while warming up. Once OCR is serving frames,
  // it must stay healthy across pause, resume and re-sharing.
  const firstSuccess = screenResponses.indexOf(200);
  assert.ok(firstSuccess === 0 || (firstSuccess === 1 && screenResponses[0] === 503), screenResponses.join(', '));
  const afterWarmup = screenResponses.slice(firstSuccess);
  assert.ok(afterWarmup.length >= 5 && afterWarmup.every((status) => status === 200), screenResponses.join(', '));
  if (artifacts) await page.screenshot({ path: join(artifacts, 'report.png') });

  console.log('PASS: no-file start; real English and Chinese OCR; no app-switch false lapse; blank frame abstention; pause/resume; screen recap and local memory; browser stop, in-app stop, re-share, and report.');
} finally {
  await browser.close();
}
