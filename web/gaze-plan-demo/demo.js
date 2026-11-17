import { OffscreenMonitor } from '../../gaze-demo/backend/static/offscreen.js';
import { createMachine, DEFAULT_CONFIG, dispatch, step } from '../src/session/machine.ts';

const intervalMs = 100;
const monitor = new OffscreenMonitor();
const byId = (id) => document.getElementById(id);
const inputButtons = document.querySelectorAll('[data-mode]');
const tracking = byId('tracking');
const indicator = byId('indicator');
const awaySeconds = byId('away-seconds');
const progress = byId('away-progress');
const elapsed = byId('elapsed');
const rescue = byId('rescue');
const reason = byId('reason');
const play = byId('play');
const events = byId('events');
const empty = byId('empty');

let machine;
let now = 0;
let mode = 'screen';
let timer = null;
let lastOffscreenCount = 0;
let snapshot;

function render() {
  const labels = {
    screen: '正在追踪 · 看向屏幕',
    away: '正在追踪 · 视线离屏',
    unknown: snapshot.away_ms > 0 ? '追踪中断 · 计时暂停' : '追踪中断 · 等待有效画面',
    window: '学习窗口失焦 · 单独计时',
  };
  if (tracking.textContent !== labels[mode]) tracking.textContent = labels[mode];
  indicator.dataset.state = mode;
  const seconds = Math.min(snapshot.away_ms, snapshot.threshold_ms) / 1000;
  awaySeconds.textContent = seconds.toFixed(1);
  progress.value = seconds;
  elapsed.textContent = `${(now / 1000).toFixed(1)} 秒`;
  for (const button of inputButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
}

function record(event) {
  const label = event.trigger === 'gaze' ? '视线离屏满 30 秒' : '离开学习窗口';
  reason.textContent = `干预原因 · ${label}`;
  rescue.hidden = false;
  empty.hidden = true;
  const item = document.createElement('li');
  item.textContent = `${(now / 1000).toFixed(1)} 秒 · ${label}`;
  events.append(item);
}

function tick() {
  const outside = mode === 'away';
  const valid = mode !== 'unknown';
  snapshot = monitor.observe({ t: now, valid, calibrated: true, outside });
  const result = step(machine, {
    now,
    score: valid ? (outside ? 0 : 100) : null,
    windowActive: mode !== 'window',
    eyesClosed: false,
    noteTaking: false,
    offscreenRule: true,
    offscreenLapse: snapshot.count > lastOffscreenCount,
  }, DEFAULT_CONFIG);
  lastOffscreenCount = snapshot.count;
  machine = result.m;
  for (const event of result.events) if (event.type === 'lapse') record(event);
}

function advance(ms) {
  for (let elapsedMs = 0; elapsedMs < ms; elapsedMs += intervalMs) {
    now += intervalMs;
    tick();
  }
  render();
}

function stopClock() {
  clearInterval(timer);
  timer = null;
  play.textContent = '实时运行';
  play.setAttribute('aria-pressed', 'false');
}

function reset() {
  stopClock();
  now = 0;
  mode = 'screen';
  lastOffscreenCount = 0;
  monitor.clear();
  machine = dispatch(createMachine(now), { type: 'start' }, now).m;
  events.replaceChildren();
  empty.hidden = false;
  rescue.hidden = true;
  reason.textContent = '';
  tick();
  render();
}

for (const button of inputButtons) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    advance(intervalMs);
  });
}
for (const button of document.querySelectorAll('[data-advance]')) {
  button.addEventListener('click', () => advance(Number(button.dataset.advance)));
}
play.addEventListener('click', () => {
  if (timer !== null) { stopClock(); return; }
  timer = setInterval(() => advance(intervalMs), intervalMs);
  play.textContent = '暂停模拟';
  play.setAttribute('aria-pressed', 'true');
});
byId('reset').addEventListener('click', reset);
byId('return').addEventListener('click', () => {
  rescue.hidden = true;
  machine = dispatch(machine, { type: 'rescueFinished', clipMs: 0 }, now).m;
  mode = 'screen';
  advance(intervalMs);
});
window.addEventListener('pagehide', stopClock);
reset();
