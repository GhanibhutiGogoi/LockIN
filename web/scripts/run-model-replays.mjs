import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadConfigFromFile } from 'vite';

const web = fileURLToPath(new URL('../', import.meta.url));
const gaze = fileURLToPath(new URL('../../gaze-demo/', import.meta.url));
const args = process.argv.slice(2);
const output = resolve(args[0] ?? join(web, '../evaluation-results/web'));
const portrait = args[1] && args[1] !== '-' ? resolve(args[1]) : undefined;
const only = new Set(args.slice(2));
const cases = ['cross-deck', 'memory-no-match', 'style-rotation', 'gaze-policy', 'model-selector', 'memory-offline'];
if ([...only].some((name) => !cases.includes(name)) || (only.has('model-selector') && !portrait)) {
  throw new Error('Pass the output directory, portrait path (or -), and optional named replay cases.');
}
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'lockin-bench-web-'));
const results = [];

function startBackend(name, offline) {
  const log = createWriteStream(join(output, name + '-backend.log'));
  const env = { ...process.env, LOCKIN_DB: join(temp, name + '.sqlite'), PYTHONPATH: join(gaze, 'backend') };
  if (offline) env.LOCKIN_MEMORY_RERANKER_URL = 'http://127.0.0.1:1/v1/rerank';
  const processHandle = spawn(join(gaze, '.venv/bin/python'), [
    '-m', 'uvicorn', 'lockin.app:app', '--host', '127.0.0.1', '--port', '0',
  ], { cwd: gaze, env, stdio: ['ignore', 'pipe', 'pipe'] });
  processHandle.stdout.pipe(log, { end: false });
  processHandle.stderr.pipe(log, { end: false });
  const closed = new Promise((resolveClose) => processHandle.on('close', () => {
    log.end();
    resolveClose();
  }));
  const ready = new Promise((resolveReady, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('Evaluation backend did not start')), 20_000);
    processHandle.on('error', (error) => { clearTimeout(timer); reject(error); });
    processHandle.on('close', (code) => { clearTimeout(timer); reject(new Error(`Evaluation backend exited ${code}: ${stderr}`)); });
    processHandle.stderr.on('data', (chunk) => {
      stderr += chunk;
      const address = stderr.match(/Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (address) { clearTimeout(timer); resolveReady(address); }
    });
  });
  return { ready, stop: async () => { processHandle.kill(); await closed; } };
}

async function replay(name, script, argv) {
  if (only.size && !only.has(name)) return;
  const env = { ...process.env, LOCKIN_REPLAY_ARTIFACTS: output };
  const log = createWriteStream(join(output, name + '.log'));
  const start = performance.now();
  const child = spawn(process.execPath, [join(web, 'scripts', script), ...argv], {
    cwd: web, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const status = await new Promise((resolveExit) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('error', (error) => log.write(String(error) + '\n'));
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      log.end(() => resolveExit({ exitCode, signal }));
    });
  });
  results.push({ name, ...status, seconds: Math.round((performance.now() - start) / 100) / 10 });
  console.log(JSON.stringify(results.at(-1)));
}

async function withLocalApp(name, offline, run) {
  const backend = startBackend(name, offline);
  let vite;
  try {
    const target = await backend.ready;
    const configPath = join(web, 'vite.config.ts');
    const { config } = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configPath, web);
    vite = await createServer({
      ...config, configFile: false, root: web,
      server: {
        ...config.server, port: 5181, host: '127.0.0.1', strictPort: true, watch: null,
        proxy: {
          '/v1/web-memory': {
            target, changeOrigin: true,
            configure(proxy) {
              proxy.on('proxyReq', (outgoing, request) => {
                if (request.headers.origin === 'http://127.0.0.1:5181') {
                  outgoing.setHeader('origin', 'http://127.0.0.1:8000');
                }
              });
            },
          },
        },
      },
    });
    await vite.listen();
    await run('http://127.0.0.1:5181/');
  } finally {
    await vite?.close();
    await backend.stop();
  }
}

try {
  if (!only.size || [...only].some((name) => name !== 'memory-offline')) await withLocalApp('online', false, async (url) => {
    await replay('cross-deck', 'replay-cross-deck.mjs', [url]);
    await replay('memory-no-match', 'replay-cross-deck.mjs', [url, '--no-match']);
    await replay('style-rotation', 'replay-memory.mjs', [url]);
    await replay('gaze-policy', 'replay-gaze.mjs', [url]);
    if (portrait) await replay('model-selector', 'compare-gaze.mjs', [portrait, url]);
  });
  if (!only.size || only.has('memory-offline')) await withLocalApp('offline', true, async (url) => {
    await replay('memory-offline', 'replay-cross-deck.mjs', [url, '--offline']);
  });
} finally {
  await writeFile(join(output, 'replays.json'), JSON.stringify(results, null, 2) + '\n');
  await rm(temp, { recursive: true, force: true });
}
if (results.some(({ exitCode }) => exitCode !== 0)) process.exitCode = 1;
