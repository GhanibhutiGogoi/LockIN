import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5180/');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
const offline = process.argv.includes('--offline');
const noMatch = process.argv.includes('--no-match');
const wide = process.env.LOCKIN_MEMORY_RERANK_PROFILE === 'wide';
assert.ok(!(offline && noMatch), 'Choose either the offline or the no-match fixture.');
const require = createRequire(import.meta.url);
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.LOCKIN_PLAYWRIGHT_MODULE ?? (existsSync(bundled) ? bundled : 'playwright'));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: process.env.LOCKIN_CHROME_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) });

const path = '/v1/web-memory';
const context = await browser.newContext({ reducedMotion: 'reduce' });
const priorTopic = {
  deck_title: 'Cellular respiration',
  slide_title: wide ? 'How cells make ATP' : 'Mitochondrial ATP production',
  slide_text: 'Mitochondria produce ATP from nutrients through oxidative phosphorylation. Electron transport creates a proton gradient across the inner membrane that drives ATP synthase.',
};
const queryText = 'Mitochondria convert energy from nutrients into ATP. Electron carriers create a proton gradient that powers the ATP-producing enzyme.';
const distractor = {
  deck_title: 'Mitochondrial inheritance',
  slide_title: 'Maternal transmission',
  slide_text: 'Mitochondria and mitochondrial DNA are inherited from the mother. The genetic lineage can trace family ancestry.',
};

function pdf(title, text) {
  const contents = `BT /F1 22 Tf 45 740 Td (${title}) Tj /F1 13 Tf 0 -35 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  return Buffer.from(body + `xref\n0 6\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF\n`);
}

try {
  // The browser uses a new anonymous replay identity in the supplied local DB.
  const identity = await context.request.post(new URL(path + '/identity', url).href);
  assert.equal(identity.status(), 201);
  const { token } = await identity.json();
  const headers = { Authorization: 'Bearer ' + token };
  const pdfBytes = pdf('ATP production', queryText);
  const fixtures = [
    ['unrelated', distractor, 'replay', false],
    ['live-only', priorTopic, 'live', false],
    ['skipped', priorTopic, 'replay', true],
  ];
  if (!noMatch) fixtures.unshift(['related', priorTopic, 'replay', false]);
  if (offline || noMatch) {
    fixtures.push(['same-deck', {
      deck_title: 'Bioenergetics', slide_title: 'ATP production', slide_text: queryText,
    }, 'replay', false]);
  }
  for (const [id, topic, source, skipped] of fixtures) {
    const written = await context.request.post(new URL(path + '/outcomes', url).href, {
      headers,
      data: {
        rescue_id: id, session_id: 'cross-deck-fixture',
        deck_id: id === 'same-deck' ? 'pdf-' + createHash('sha256').update(pdfBytes).digest('hex') : id,
        source, topic,
        style: id === 'same-deck' ? 'plain' : 'analogy', trigger: 'gaze', clip_seconds: 20, skipped,
        answer_count: 1, correct_count: 1, recovery_samples: 60, focused_share: .8,
      },
    });
    assert.equal(written.status(), 204);
  }
  await context.addInitScript(({ token }) => {
    document.hasFocus = () => true;
    localStorage.setItem('lockin.memoryBankIdentity', JSON.stringify(token));
    localStorage.setItem('lockin.integrations.demo', JSON.stringify({
      attention: { mode: 'mock', url: '' },
      adaptive: { mode: 'memory', url: '' },
    }));
  }, { token });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(url.href);
  await page.getByLabel('Open your slides').setInputFiles({
    name: 'Bioenergetics.pdf', mimeType: 'application/pdf', buffer: pdfBytes,
  });
  const notifications = page.getByRole('checkbox', { name: /Call me back/ });
  if (await notifications.count()) await notifications.uncheck();
  await page.getByRole('button', { name: 'I agree, start studying' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).waitFor();
  await page.clock.runFor(1000);
  const request = page.waitForResponse((response) =>
    new URL(response.url()).pathname === path + '/retrieve' &&
    response.request().postDataJSON()?.topic?.deck_title === 'Bioenergetics');
  // Keep the real network request and the browser's request deadline on wall time.
  await page.clock.resume();
  await page.keyboard.press('d');
  const response = await request;
  assert.equal(response.status(), 200);
  const recalled = await response.json();
  const expectRecall = !offline && !noMatch;
  assert.equal(recalled.semantic_status, offline ? 'unavailable' : noMatch ? 'no_match' : 'confirmed');
  assert.equal(recalled.evidence_count, expectRecall ? 0 : 1);
  assert.deepEqual(recalled.related_memories.map((hit) => hit.rescue_id), expectRecall ? ['related'] : []);
  assert.doesNotMatch(recalled.memo ?? '', /Mitochondrial inheritance/);
  if (expectRecall) {
    assert.match(recalled.memo, /Cellular respiration/);
    if (wide) assert.ok(recalled.related_memories[0].similarity >= .78 && recalled.related_memories[0].similarity < .80);
  }

  const another = await context.request.post(new URL(path + '/identity', url).href);
  assert.equal(another.status(), 201);
  const otherUser = await context.request.post(new URL(path + '/retrieve', url).href, {
    headers: { Authorization: 'Bearer ' + (await another.json()).token },
    data: response.request().postDataJSON(),
  });
  assert.equal(otherUser.status(), 200);
  const empty = await otherUser.json();
  assert.equal(empty.evidence_count, 0);
  assert.deepEqual(empty.related_memories, []);

  const rescue = page.getByRole('dialog', { name: 'Focus rescue' });
  await rescue.getByRole('button', { name: 'Flag a wrong fact' }).waitFor();
  await rescue.getByRole('button', { name: /Mute/ }).first().click();
  if (!expectRecall) await rescue.getByRole('button', { name: /I.m back/ }).click();
  else await page.clock.runFor(40_000);
  const back = rescue.getByRole('button', { name: 'Back to the slide' });
  if (!(await back.isVisible())) await rescue.getByRole('group', { name: /Answers/ }).getByRole('button').first().click();
  await back.click();
  await page.keyboard.press('d');
  await page.mouse.move(20, 10);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'See my report' }).click();
  if (!expectRecall) {
    const text = offline ? 'Cross-deck search was unavailable.' : 'No relevant memories from other decks.';
    await page.getByText(text, { exact: true }).waitFor();
    assert.equal(await page.getByText('Related memories from other decks', { exact: true }).count(), 0);
    await page.getByText('1 usable prior outcome', { exact: false }).waitFor();
  } else {
    await page.getByText('Related memories from other decks', { exact: true }).waitFor();
    await page.getByText(`Cellular respiration · ${priorTopic.slide_title} · Analogy · 80% focused`).waitFor();
  }
  assert.deepEqual(errors, []);
  const artifacts = process.env.LOCKIN_REPLAY_ARTIFACTS;
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await page.clock.resume();
    const screenshot = offline ? 'memory-offline-report.png' : noMatch ? 'memory-no-match-report.png' : 'cross-deck-memory-report.png';
    await page.screenshot({ path: join(artifacts, screenshot), fullPage: true, animations: 'disabled' });
  }
  console.log(JSON.stringify({
    query: 'Bioenergetics / ATP production',
    recall: recalled.related_memories,
    sameDeckEvidence: recalled.evidence_count,
    status: recalled.semantic_status,
    userIsolationVerified: true,
    reportVerified: true,
  }, null, 2));
} finally {
  await browser.close();
}
