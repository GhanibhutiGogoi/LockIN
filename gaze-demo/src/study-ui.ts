import './study.css';
import { StudySession } from './core/session.ts';
import { makeGenerationRequest, memoryForGoal } from './core/memory.ts';
import { LocalVideoProvider, localFileAsset, sampleAsset } from './local-video.ts';
import { StudyStore } from './storage.ts';
import { ProfileBank, type RecordStore } from './profile-bank.ts';
import type { EpisodeRecord, GenerationRequest, Observation, Pace, Profile, ScreenKind, SessionRecord, Style, VideoAsset } from './core/types.ts';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const pct = (n: number | null | undefined) => n === null || n === undefined ? '—' : `${(n * 100).toFixed(0)}%`;
const sec = (n: number | null | undefined) => n === null || n === undefined ? '未确认' : `${(n / 1000).toFixed(1)} s`;
const styleNames = { plain: '平实讲解', analogy: '类比讲解', humor: '轻松幽默' };
type StudyUIStore = RecordStore & { profiles(): Promise<Profile[]>; saveProfile(p: Profile): Promise<void> };

export class StudyUI {
  private store: StudyUIStore;
  private bank: ProfileBank;
  private profiles: Profile[] = [];
  private profile: Profile | null = null;
  private episodes: EpisodeRecord[] = [];
  private sessions: SessionRecord[] = [];
  private assets: VideoAsset[] = [];
  private provider = new LocalVideoProvider(() => this.assets);
  private session: StudySession | null = null;
  private lastInput = 0;
  private lastSave = 0;
  private lastPhase = '';
  private handled = new Set<string>();
  private pendingSave: Promise<void> = Promise.resolve();
  private lastRequest: GenerationRequest | null = null;
  private ready = false;
  private loading = false;
  private loadVersion = 0;
  private interval: ReturnType<typeof setInterval>;
  private player: HTMLVideoElement;
  private stopTracking: () => void;

  constructor(options: { stopTracking: () => void; store?: StudyUIStore }) {
    this.store = options.store ?? new StudyStore();
    this.bank = new ProfileBank(this.store);
    this.stopTracking = options.stopTracking;
    el('study-app').innerHTML = `
      <div class="loop-status"><span id="session-phase">正在读取本地记忆…</span><span id="session-evidence">等待有效 gaze</span></div>
      <div id="study-alert" class="loop-alert" role="status"></div>
      <div class="loop-grid">
        <section class="loop-card"><h2>本次学习</h2>
          <label for="learning-goal">学习目标</label><input id="learning-goal" maxlength="200" placeholder="例如：理解平均值的计算" />
          <label for="study-context">正在学习的内容 / 最近一段上下文</label><textarea id="study-context" rows="3" maxlength="5000" placeholder="粘贴当前知识点。切到娱乐内容后仍使用这段学习上下文。"></textarea>
          <div class="loop-row"><div><label for="screen-kind">当前屏幕内容（人工标注）</label><select id="screen-kind"><option value="study">学习内容</option><option value="entertainment">娱乐内容</option><option value="unknown">不确定</option></select></div><div><label for="trigger-time">持续分心触发时间</label><select id="trigger-time"><option value="2000">2 秒（试验）</option><option value="5000">5 秒</option><option value="8000">8 秒</option></select></div></div>
          <div class="loop-actions"><button id="begin-study" class="button primary" disabled>开始学习会话</button><button id="end-study" class="button secondary" disabled>结束并保存</button><button id="test-rescue" class="button secondary" disabled>手动测试视频</button></div>
          <p class="loop-small" style="margin-top:12px">先启用摄像头并校准，再开始自动判断。手动测试也能跑通流程，但不用于学习视频偏好。屏幕内容目前由你标注，尚未接入自动识别。</p>
          <details id="video-setup" open><summary>本地视频库 <span id="asset-count">/ 0</span></summary>
            <button id="use-sample" class="loop-link">使用 12 秒示例：平均值回顾（同时填写示例学习目标）</button>
            <div class="loop-row"><div><label for="asset-style">视频讲解风格</label><select id="asset-style"><option value="plain">平实讲解</option><option value="analogy">类比讲解</option><option value="humor">轻松幽默</option></select></div><div><label for="asset-pace">视频节奏</label><select id="asset-pace"><option value="normal">正常</option><option value="slow">较慢</option><option value="fast">较快</option></select></div></div>
            <label for="local-question">视频后回忆问题（自选视频用，不自动评分）</label><input id="local-question" placeholder="例如：请回忆刚才解释的一个知识点" maxlength="500" />
            <label for="local-video">添加与上方学习目标相关的视频</label><input id="local-video" class="loop-file" type="file" accept="video/*,.mp4,.webm" />
            <div id="asset-list" class="asset-list">尚未选择视频。可以添加多种风格，系统按个人记忆选择已有视频。</div>
            <p class="loop-small">视频文件只在本页使用，刷新后需重新选择；偏好和干预记录会保留。本地模式不生成或改写视频。</p>
          </details>
          <dl class="loop-metrics"><div><dt>返回后持续恢复时间</dt><dd id="recovery-time">—</dd></div><div><dt>返回后任务相关注视 / 有效观测</dt><dd id="task-share">—</dd></div><div><dt>恢复观察有效覆盖率</dt><dd id="data-coverage">—</dd></div><div><dt>恢复后再次分心间隔</dt><dd id="relapse-time">—</dd></div></dl>
          <p id="recovery-detail" class="loop-small">答题返回后观察 120 秒；持续 4 秒任务相关注视才确认恢复。</p>
        </section>
        <section class="loop-card"><h2>个人 Memory Bank</h2>
          <label class="profile-select-label" for="profile-select"><span>本地用户</span><span id="storage-state">IndexedDB</span></label><select id="profile-select"></select>
          <div class="profile-new"><input id="new-profile" maxlength="40" placeholder="新用户名称" aria-label="新用户名称" /><button id="add-profile" class="button secondary">创建</button></div>
          <div class="memory-prefs"><div><label for="pref-style">偏好讲解</label><select id="pref-style"><option value="plain">平实讲解</option><option value="analogy">类比讲解</option><option value="humor">轻松幽默</option></select></div><div><label for="pref-pace">偏好节奏</label><select id="pref-pace"><option value="normal">正常</option><option value="slow">较慢</option><option value="fast">较快</option></select></div><div><label for="pref-language">语言</label><select id="pref-language"><option value="zh">中文</option><option value="en">English</option></select></div><div><label for="pref-seconds">偏好时长</label><select id="pref-seconds"><option value="20">20 秒</option><option value="40">40 秒</option><option value="60">60 秒</option></select></div></div>
          <button id="save-preferences" class="loop-link">保存本人偏好</button>
          <div id="memory-count" class="loop-small"></div><p id="memory-memo" class="loop-memo"></p>
          <div class="loop-bank-note"><p class="loop-small">本人设置与观察结果分开保存。只从完整、非误报且有效覆盖 ≥60% 的自动干预中统计；每种风格至少 3 次才影响选择。</p><div class="loop-actions"><button id="export-memory" class="button secondary">导出数据与标注</button><button id="export-request" class="button secondary" disabled>导出生成请求</button></div><p class="loop-small" style="margin-top:12px">仅当前浏览器保存，不含摄像头图像或视频文件。学习时不能切换用户；切换后需要重新校准。</p></div>
        </section>
      </div>`;
    el('study-history').innerHTML = '<div class="history-heading"><h2>干预记录与试用标注</h2><span class="loop-small">保留原始测量与人工修正</span></div><div id="episode-history"></div>';
    document.body.insertAdjacentHTML('beforeend', `<div id="rescue-overlay" class="rescue-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="rescue-title"><div class="rescue-card"><div class="rescue-heading"><div><h2 id="rescue-title">本地视频干预</h2><p id="rescue-subtitle"></p></div><button id="abort-rescue" class="button secondary">结束本次学习</button></div><video id="rescue-player" class="rescue-video" playsinline preload="auto"></video><div class="rescue-controls"><button id="video-play" class="button secondary">播放 / 暂停</button><span id="video-status">准备中</span></div><div id="rescue-quiz" class="rescue-quiz" hidden></div><p class="rescue-info">正常返回需要看完视频并回答问题。你始终可以结束本次学习；中途结束会记为未完成。</p></div></div>`);
    this.player = el<HTMLVideoElement>('rescue-player');
    this.bind();
    this.interval = setInterval(() => this.tick(), 250);
    this.render();
    void this.initialize();
  }

  private alert(message: string) { el('study-alert').textContent = message; }
  private isActive() { return !!this.session && this.session.phase !== 'ended'; }
  private async initialize() {
    try { this.profiles = await this.store.profiles(); }
    catch (e) { el('storage-state').textContent = '仅页面内存'; this.alert(`本地保存不可用：${String(e)}。请在关闭页面前导出。`); }
    if (!this.profiles.length) {
      const p: Profile = { id: crypto.randomUUID(), name: '学习者 1', createdAt: new Date().toISOString(), preferences: { style: 'plain', pace: 'normal', language: 'zh', maxSeconds: 40 } };
      this.profiles.push(p); await this.safeSave(() => this.store.saveProfile(p));
    }
    await this.selectProfile(this.profiles[0].id);
    this.ready = true; this.render();
  }
  private async safeSave(action: () => Promise<void>) {
    try { await action(); }
    catch (e) { el('storage-state').textContent = '保存失败'; this.alert(`记录仍在当前页面，但未能写入本地存储。请先导出备份。${e instanceof Error ? e.message : e}`); }
  }
  private async selectProfile(id: string) {
    if (this.isActive()) return;
    const version = ++this.loadVersion;
    const p = this.profiles.find(x => x.id === id);
    if (!p) return;
    this.loading = true; this.render();
    const snapshot = await this.bank.load(id);
    if (version !== this.loadVersion) return;
    this.profile = p; this.session = null; this.lastRequest = null;
    this.episodes = snapshot.episodes; this.sessions = snapshot.sessions;
    this.assets.forEach(a => { if (a.url.startsWith('blob:')) URL.revokeObjectURL(a.url); }); this.assets = [];
    this.stopTracking();
    if (snapshot.error) this.alert(`读取本地存储失败，当前页面中已有的记录仍保留，可导出备份。${snapshot.error}`);
    this.loading = false;
    el('profile-select').innerHTML = this.profiles.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    (el('profile-select') as HTMLSelectElement).value = id;
    for (const [field, value] of Object.entries({ style: p.preferences.style, pace: p.preferences.pace, language: p.preferences.language, seconds: p.preferences.maxSeconds })) (el(`pref-${field}`) as HTMLSelectElement).value = String(value);
    this.renderAssets(); this.renderMemory(); this.renderHistory(); this.render();
  }
  private mergeCurrent() {
    if (!this.session) return;
    const episodes = new Map(this.episodes.map(e => [e.id, e]));
    this.session.episodes.forEach(e => episodes.set(e.id, structuredClone(e))); this.episodes = [...episodes.values()];
    const sessions = new Map(this.sessions.map(s => [s.id, s])); sessions.set(this.session.record.id, structuredClone(this.session.record)); this.sessions = [...sessions.values()];
  }
  private persist() {
    if (!this.session) return;
    this.mergeCurrent();
    const record = structuredClone(this.session.record), episodes = structuredClone(this.session.episodes);
    this.pendingSave = this.safeSave(() => this.bank.saveBatch(record, episodes));
    this.lastSave = performance.now();
  }
  private renderAssets() {
    el('asset-count').textContent = `/ ${this.assets.length}`;
    el('asset-list').innerHTML = this.assets.length ? this.assets.map(a => `<div>${esc(a.title)} · ${styleNames[a.style]} · ${a.durationSeconds.toFixed(0)} 秒<br/><span class="loop-small">适用目标：${esc(a.goal)}</span></div>`).join('') : '尚未选择视频。可以添加多种风格，系统按个人记忆选择已有视频。';
  }
  private renderMemory() {
    if (!this.profile) return;
    this.mergeCurrent();
    const goal = this.session?.record.goal ?? (el('learning-goal') as HTMLInputElement).value;
    const memory = memoryForGoal(this.profile.id, goal, this.episodes);
    el('memory-count').textContent = `${this.profile.name} · ${this.episodes.length} 次干预记录 · 当前目标 ${memory.eligibleCount} 次可评估`;
    el('memory-memo').textContent = memory.memo;
  }
  private renderHistory() {
    this.mergeCurrent();
    el('episode-history').innerHTML = this.episodes.length ? [...this.episodes].reverse().map(e => {
      const s = e.summary;
      const state = !s ? '尚未完成 / 中断记录' : !s.completed ? `未完成：${s.censoredReason}` : s.coverage < .6 ? '观察完整，数据不足' : '观察完整';
      return `<article class="history-item" data-episode="${esc(e.id)}"><h3>${esc(e.video?.title ?? '视频准备请求')} <span class="status-badge">${esc(state)}</span></h3><p class="loop-small">${esc(e.goal)} · ${e.mode === 'manual' ? '手动测试，不参与偏好学习' : '自动触发'} · ${e.triggerReason === 'entertainment' ? '娱乐内容' : e.triggerReason === 'look-away' ? '看向屏外' : '手动'} · ${esc(new Date(e.createdAt).toLocaleString())}</p><div class="history-metrics"><span>看屏比例（播放中）：${pct(s?.watchOnScreenShare)}</span><span>恢复：${sec(s?.recoveredAfterMs)}</span><span>返回后任务相关：${pct(s?.onTaskShare)}</span><span>有效覆盖：${pct(s?.coverage)}</span><span>首次答题：${s?.quizCorrect === null || s?.quizCorrect === undefined ? '未评分' : s.quizCorrect ? '正确' : '错误'}</span></div><div class="history-form"><label>这次是否误报？<select data-field="falseAlarm"><option value="unknown" ${e.annotation.falseAlarm === null ? 'selected' : ''}>尚未标注</option><option value="false" ${e.annotation.falseAlarm === false ? 'selected' : ''}>确实脱离学习</option><option value="true" ${e.annotation.falseAlarm === true ? 'selected' : ''}>误报，我在学习</option></select></label><label>视频是否有帮助？<select data-field="helped"><option value="unknown" ${e.annotation.helped === null ? 'selected' : ''}>尚未标注</option><option value="1" ${e.annotation.helped === 1 ? 'selected' : ''}>有帮助</option><option value="0" ${e.annotation.helped === 0 ? 'selected' : ''}>不确定</option><option value="-1" ${e.annotation.helped === -1 ? 'selected' : ''}>没有帮助</option></select></label><label>备注<input data-field="note" maxlength="500" value="${esc(e.annotation.note)}" placeholder="例如：只是在思考，或视频太长" /></label><button data-save-annotation class="button secondary">保存标注</button></div></article>`;
    }).join('') : '<p class="loop-small">完成一次干预后，这里会保留测量结果和人工标注。</p>';
  }
  private render() {
    const s = this.session, active = this.isActive();
    const names = { studying: '学习中', preparing: '准备本地视频', video: '视频干预中', quiz: '等待答题', observing: '恢复观察中', ended: '会话已结束' };
    el('session-phase').textContent = this.loading ? '正在读取用户记忆…' : s ? `${names[s.phase]}${s.cooldownRemainingMs > 0 ? ` · 冷却 ${Math.ceil(s.cooldownRemainingMs / 1000)} 秒` : ''}` : this.ready ? '会话未开始' : '正在读取本地记忆…';
    const evidence = s?.detection;
    el('session-evidence').textContent = evidence ? `${evidence.kind === 'on-task' ? '任务相关注视' : evidence.kind === 'off-task' ? '脱离任务证据' : '数据未知'}${evidence.heldMs ? ` ${(evidence.heldMs / 1000).toFixed(1)} s` : ''} · 人工屏幕标注` : '等待有效 gaze';
    for (const id of ['learning-goal','study-context','profile-select','new-profile','add-profile','local-video','use-sample','trigger-time','asset-style','asset-pace','local-question']) (el(id) as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = active || !this.ready || this.loading;
    for (const id of ['pref-style','pref-pace','pref-language','pref-seconds','save-preferences','export-memory']) (el(id) as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = !this.ready || this.loading;
    (el('begin-study') as HTMLButtonElement).disabled = active || !this.ready || this.loading;
    (el('end-study') as HTMLButtonElement).disabled = !active;
    (el('test-rescue') as HTMLButtonElement).disabled = !active || s?.phase !== 'studying';
    (el('export-request') as HTMLButtonElement).disabled = !this.lastRequest || this.loading;
    const summary = s?.currentSummary(performance.now()) ?? s?.episodes.at(-1)?.summary;
    el('recovery-time').textContent = summary ? sec(summary.recoveredAfterMs) : '—';
    el('task-share').textContent = pct(summary?.onTaskShare);
    el('data-coverage').textContent = pct(summary?.coverage);
    el('relapse-time').textContent = summary ? sec(summary.relapseAfterMs) : '—';
    el('recovery-detail').textContent = summary ? `返回后已观察 ${(summary.observationMs / 1000).toFixed(0)} / 120 秒。${summary.completed ? '观察窗口已结束。' : summary.censoredReason ? '本次观察中断，不用于学习偏好。' : '持续 4 秒任务相关注视才确认恢复。'}${summary.coverage < .6 ? ' 有效数据不足时不作效果结论。' : ''}` : '答题返回后观察 120 秒；持续 4 秒任务相关注视才确认恢复。';
  }
  private tick() {
    const s = this.session;
    if (!s || s.phase === 'ended') return;
    const now = performance.now();
    if (now - this.lastInput > 1500) s.observe({ t: now, valid: false, visible: !document.hidden, onScreen: null, screen: 'unknown', source: 'manual' });
    s.tick(now);
    if (s.active && s.phase === 'preparing' && !this.handled.has(s.active.id)) void this.prepare(s, s.active);
    if (s.phase !== this.lastPhase) { this.lastPhase = s.phase; this.persist(); this.renderHistory(); this.renderMemory(); }
    else if (now - this.lastSave > 5000) this.persist();
    this.render();
  }
  observe(input: Omit<Observation, 'screen' | 'source' | 'visible'>) {
    if (!this.isActive()) return;
    this.lastInput = input.t;
    this.session!.observe({ ...input, visible: !document.hidden, screen: (el('screen-kind') as HTMLSelectElement).value as ScreenKind, source: 'manual' });
  }
  invalidate() { this.observe({ t: performance.now(), valid: false, onScreen: null }); }
  end(reason = 'session-ended') {
    if (!this.isActive()) return;
    this.session!.end(performance.now(), reason); this.persist();
    this.player.pause(); this.player.removeAttribute('src'); this.player.load(); el('rescue-overlay').hidden = true;
    this.render(); this.renderMemory(); this.renderHistory();
  }
  private async prepare(session: StudySession, episode: EpisodeRecord) {
    this.handled.add(episode.id);
    const p = this.profile;
    if (!p || p.id !== episode.profileId) return;
    this.mergeCurrent();
    const request = makeGenerationRequest(p, episode, memoryForGoal(p.id, episode.goal, this.episodes));
    this.lastRequest = request;
    try {
      const asset = await this.provider.prepare(request);
      if (this.session !== session || session.active?.id !== episode.id || session.phase !== 'preparing') return;
      session.videoReady(asset);
      el('rescue-title').textContent = asset.title;
      el('rescue-subtitle').textContent = `${episode.mode === 'manual' ? '手动流程测试' : '自动分心触发'} · ${styleNames[asset.style]} · ${episode.goal}`;
      el('rescue-quiz').hidden = true; el('rescue-overlay').hidden = false;
      (el('video-play') as HTMLButtonElement).disabled = false;
      el('video-status').textContent = '准备播放；若未自动开始，请点击播放';
      this.player.src = asset.url; this.player.currentTime = 0;
      await this.player.play().catch(() => { el('video-status').textContent = '请点击播放'; });
      this.persist(); this.renderHistory(); this.render();
    } catch (e) {
      if (this.session !== session || session.active?.id !== episode.id) return;
      session.failIntervention(performance.now(), 'video-prepare-error'); this.alert(e instanceof Error ? e.message : String(e));
      this.persist(); this.render(); this.renderHistory();
    }
  }
  private showQuiz() {
    const q = this.session?.active?.video?.quiz;
    if (!q) return;
    const box = el('rescue-quiz'); box.hidden = false;
    box.innerHTML = `<h3>${esc(q.question)}</h3>${q.kind === 'choice' ? q.options.map((o, i) => `<label><input type="radio" name="rescue-answer" value="${i}" /> ${esc(o)}</label>`).join('') : '<textarea id="recall-answer" maxlength="2000" aria-label="回忆要点" placeholder="写下一个要点；这类回答不自动评分"></textarea>'}<button id="submit-quiz" class="button primary">提交答案并返回学习</button><p id="quiz-error" class="loop-alert"></p>`;
    el('submit-quiz').onclick = () => {
      try {
        const selected = box.querySelector<HTMLInputElement>('input[name=rescue-answer]:checked');
        const answer = q.kind === 'choice' ? selected ? Number(selected.value) : NaN : (el('recall-answer') as HTMLTextAreaElement).value;
        const correct = this.session!.answer(performance.now(), answer);
        el('rescue-overlay').hidden = true;
        this.alert(`${correct === null ? '回忆回答已保存，未自动评分。' : correct ? '回答正确。' : `回答已保存。正确答案是「${q.kind === 'choice' ? q.options[q.correctIndex] : ''}」。`}现在返回原学习任务，开始 120 秒恢复观察；请按实际情况更新屏幕标注。`);
        this.persist(); this.renderHistory(); this.render();
      } catch (e) { el('quiz-error').textContent = e instanceof Error ? e.message : String(e); }
    };
  }
  private bind() {
    el('profile-select').addEventListener('change', () => { void this.selectProfile((el('profile-select') as HTMLSelectElement).value); });
    el('add-profile').onclick = async () => {
      const name = (el('new-profile') as HTMLInputElement).value.trim();
      if (!name || this.isActive() || this.loading) return;
      const p: Profile = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), preferences: { style: 'plain', pace: 'normal', language: 'zh', maxSeconds: 40 } };
      this.profiles.push(p); await this.safeSave(() => this.store.saveProfile(p)); await this.selectProfile(p.id); (el('new-profile') as HTMLInputElement).value = '';
    };
    el('save-preferences').onclick = () => {
      if (!this.profile || this.loading) return;
      this.profile.preferences = { style: (el('pref-style') as HTMLSelectElement).value as Style, pace: (el('pref-pace') as HTMLSelectElement).value as Pace, language: (el('pref-language') as HTMLSelectElement).value as 'zh' | 'en', maxSeconds: Number((el('pref-seconds') as HTMLSelectElement).value) };
      const p = structuredClone(this.profile); void this.safeSave(() => this.store.saveProfile(p)); this.alert('本人偏好已更新；下次视频请求会带上这些设置。本地视频不会自动改变语言或配音。'); this.renderMemory();
    };
    el('learning-goal').addEventListener('input', () => this.renderMemory());
    el('use-sample').onclick = () => {
      if (this.isActive()) return;
      const a = sampleAsset(); if (!this.assets.some(v => v.id === a.id)) this.assets.push(a);
      (el('learning-goal') as HTMLInputElement).value = a.goal;
      (el('study-context') as HTMLTextAreaElement).value = '平均值等于总和除以数量。例子：2、4、6 的总和是 12，共 3 个数，所以平均值是 4。';
      this.renderAssets(); this.renderMemory(); this.alert('已载入无声示例视频与配套问题。可先手动测试流程，也可以启用摄像头校准后试自动触发。');
    };
    el('local-video').addEventListener('change', async () => {
      const input = el<HTMLInputElement>('local-video'), file = input.files?.[0], goal = (el('learning-goal') as HTMLInputElement).value.trim();
      if (!file || this.isActive()) return;
      if (!goal) { this.alert('请先输入这个视频对应的学习目标。'); input.value = ''; return; }
      try { this.assets.push(await localFileAsset(file, goal, (el('asset-style') as HTMLSelectElement).value as Style, (el('asset-pace') as HTMLSelectElement).value as Pace, (el('local-question') as HTMLInputElement).value)); this.renderAssets(); }
      catch (e) { this.alert(e instanceof Error ? e.message : String(e)); }
      input.value = '';
    });
    el('begin-study').onclick = () => {
      if (!this.profile || this.isActive() || this.loading) return;
      const goal = (el('learning-goal') as HTMLInputElement).value.trim();
      if (!goal) { this.alert('请先输入学习目标。'); return; }
      if (!this.assets.some(a => a.goal.trim().toLowerCase() === goal.toLowerCase())) { this.alert('请先为这个学习目标添加本地视频，或点击使用示例。'); return; }
      const context = (el('study-context') as HTMLTextAreaElement).value;
      this.session = new StudySession({ id: crypto.randomUUID(), profileId: this.profile.id, goal, studyContext: context, startedAt: performance.now(), epoch: Date.now(), triggerHoldMs: Number((el('trigger-time') as HTMLSelectElement).value) });
      this.lastPhase = ''; this.lastInput = 0;
      const article = document.querySelector('.reading-stage article');
      if (article) article.innerHTML = `<span class="article-index">当前学习任务</span><h2>${esc(goal)}</h2><p style="white-space:pre-wrap">${esc(context || goal)}</p><div class="article-note"><span>↳</span><p>分心后的视频请求会保留这里的学习上下文。</p></div>`;
      this.alert('会话已开始。校准后可自动触发；尚无有效 gaze 时只记录未知。手动测试不计入偏好学习。'); this.persist(); this.render();
    };
    el('end-study').onclick = () => { this.end(); this.stopTracking(); };
    el('abort-rescue').onclick = () => { this.end('user-aborted'); this.stopTracking(); };
    el('test-rescue').onclick = () => { try { this.session?.requestIntervention(performance.now()); this.tick(); } catch (e) { this.alert(String(e)); } };
    el('video-play').onclick = () => { if (this.player.paused) void this.player.play().catch(e => this.alert(String(e))); else this.player.pause(); };
    this.player.addEventListener('playing', () => { try { this.session?.play(performance.now()); el('video-status').textContent = '播放中，结束后需要答题'; } catch (e) { this.alert(String(e)); } });
    for (const event of ['pause','waiting']) this.player.addEventListener(event, () => this.session?.pause(performance.now()));
    this.player.addEventListener('ended', () => { try { this.session?.endVideo(performance.now()); (el('video-play') as HTMLButtonElement).disabled = true; el('video-status').textContent = '视频结束，请回答问题'; this.showQuiz(); this.persist(); this.render(); } catch (e) { this.alert(String(e)); } });
    this.player.addEventListener('error', () => { if (!this.session?.active) return; this.session.failIntervention(performance.now(), 'playback-error'); el('rescue-overlay').hidden = true; this.alert('视频播放失败，本次结果已记为未完成。'); this.persist(); this.renderHistory(); this.render(); });
    el('episode-history').addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-save-annotation]')) return;
      const item = target.closest<HTMLElement>('[data-episode]');
      const e = this.episodes.find(x => x.id === item?.dataset.episode);
      if (!item || !e || e.profileId !== this.profile?.id || this.loading) return;
      const falseAlarm = item.querySelector<HTMLSelectElement>('[data-field=falseAlarm]')!.value;
      const helped = item.querySelector<HTMLSelectElement>('[data-field=helped]')!.value;
      e.annotation = { falseAlarm: falseAlarm === 'unknown' ? null : falseAlarm === 'true', helped: helped === 'unknown' ? null : Number(helped) as -1 | 0 | 1, note: item.querySelector<HTMLInputElement>('[data-field=note]')!.value };
      const current = this.session?.episodes.find(x => x.id === e.id); if (current) current.annotation = { ...e.annotation };
      const saved = structuredClone(e); void this.safeSave(() => this.bank.saveEpisode(saved)); this.renderMemory(); this.alert('标注已更新并排队保存。被标记为误报的记录会从观察偏好统计中排除。');
    });
    el('export-memory').onclick = async () => {
      if (!this.profile || this.loading) return;
      const profile = structuredClone(this.profile), goal = this.session?.record.goal ?? (el('learning-goal') as HTMLInputElement).value;
      this.persist(); await this.pendingSave;
      const snapshot = await this.bank.load(profile.id);
      this.download(`lockin-${profile.id}.json`, { schemaVersion: 1, exportedAt: new Date().toISOString(), profile, sessions: snapshot.sessions, episodes: snapshot.episodes, memory: memoryForGoal(profile.id, goal, snapshot.episodes), measurement: { screenSource: 'manual', trainedAttentionModel: false, validatedAccuracy: false, sampleIntervalMs: 1000, timestamps: 'monotonic milliseconds; align with session.startedAtT and session.startedAt' } });
    };
    el('export-request').onclick = () => { if (this.lastRequest) this.download('lockin-generation-request.json', this.lastRequest); };
    window.addEventListener('pagehide', () => this.end('page-closed'));
  }
  private download(name: string, data: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
