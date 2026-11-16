import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5180/');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: process.env.LOCKIN_CHROME_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) });

const path = '/v1/web-memory';
const isMemory = (response, endpoint) => new URL(response.url()).pathname === path + endpoint && response.request().method() === 'POST';
const context = await browser.newContext({ reducedMotion: 'reduce' });
try {
  await context.addInitScript(() => {
    document.hasFocus = () => true;
    Math.random = () => .6;
    window.lockinSpoken = [];
    if (window.speechSynthesis) {
      const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (utterance) => {
        window.lockinSpoken.push(utterance.text);
        speak(utterance);
      };
    }
    localStorage.setItem('lockin.integrations', JSON.stringify({
      attention: { mode: 'mock', url: '' },
      adaptive: { mode: 'memory', url: '' },
    }));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(url.href);

  async function openStudy() {
    await page.getByRole('button', { name: /Try the sample deck/ }).click();
    const consent = page.getByRole('button', { name: 'I agree, start studying' });
    if (await consent.isVisible()) {
      const notifications = page.getByRole('checkbox', { name: /Call me back/ });
      if (await notifications.count()) await notifications.uncheck();
      await consent.click();
    }
    await page.getByRole('button', { name: 'Finish', exact: true }).waitFor();
    await page.clock.runFor(1000);
  }

  async function startRescue() {
    const lookup = page.waitForResponse((response) => isMemory(response, '/retrieve'));
    await page.keyboard.press('d');
    await page.clock.runFor(10_000);
    const response = await lookup;
    assert.equal(response.status(), 200);
    await page.getByRole('dialog', { name: 'Focus rescue' }).waitFor();
    return response.json();
  }

  async function finishSession() {
    await page.mouse.move(20, 10);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    const session = page.waitForResponse((response) => isMemory(response, '/sessions'));
    await page.getByRole('button', { name: 'See my report' }).click();
    assert.equal((await session).status(), 204);
    const report = page.getByRole('region', { name: 'Why each recap style was chosen' });
    await report.waitFor();
    return report;
  }

  const dialog = page.getByRole('dialog', { name: 'Focus rescue' });
  await openStudy();
  const first = await startRescue();
  assert.equal(first.evidence_count, 0);
  assert.equal(first.style, 'plain');
  assert.equal(first.reason, 'rotation');
  await dialog.getByRole('button', { name: /Mute/ }).first().click();
  await page.clock.runFor(35_000);
  await dialog.getByRole('button', { name: /ATP/ }).click();
  await dialog.getByRole('button', { name: 'Back to the slide' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const { simulator } = await import('/src/providers/mock/attention.ts');
    simulator.set('locked-in');
  });
  const outcome = page.waitForResponse((response) => isMemory(response, '/outcomes'));
  await page.clock.runFor(63_000);
  const outcomeResponse = await outcome;
  assert.equal(outcomeResponse.status(), 204);
  const payload = outcomeResponse.request().postDataJSON();
  assert.equal(payload.source, 'replay');
  assert.ok(payload.recovery_samples >= 45);
  assert.equal(payload.correct_count, 1);
  assert.equal(payload.skipped, false);
  assert.equal(payload.style, 'plain');
  let report = await finishSession();
  await report.getByText(/Rotating styles until each has 2 usable outcomes/).waitFor();
  await report.getByText(/0 usable prior outcomes/).waitFor();

  await page.reload();
  await openStudy();
  const second = await startRescue();
  assert.equal(second.evidence_count, 1);
  assert.equal(second.style, 'analogy');
  assert.equal(second.eligible_by_style.plain, 1);
  await dialog.getByRole('button', { name: /Mute/ }).first().waitFor();
  await page.waitForFunction(() => window.lockinSpoken.some((text) => text.startsWith('Picture it this way.')));
  await dialog.getByRole('button', { name: /I.m back/ }).click();
  await dialog.getByRole('button', { name: /ATP/ }).click();
  await dialog.getByRole('button', { name: 'Back to the slide' }).click();
  report = await finishSession();
  await report.getByText(/1 usable prior outcomes?/).waitFor();
  await report.getByText('This recap was skipped.').waitFor();

  await page.reload();
  await openStudy();
  const third = await startRescue();
  assert.equal(third.style, 'humor');
  assert.equal(third.evidence_count, 1);
  assert.equal(third.excluded.skipped, 1);
  assert.deepEqual(errors, []);
  console.log('Across three sessions, Direct → Analogy → Humor. Report showed rotation, prior evidence, and the skipped recap exclusion.');
} finally {
  await browser.close();
}
