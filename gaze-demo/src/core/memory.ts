import type { EpisodeRecord, GenerationRequest, MemoryView, Profile, VideoAsset } from './types.ts';
const goalKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function memoryForGoal(profileId: string, goal: string, records: EpisodeRecord[]): MemoryView {
  const latest = new Map(records.filter(e => e.profileId === profileId).map(e => [e.id, e]));
  const eligible = [...latest.values()].filter(e => {
    const s = e.summary;
    return goalKey(e.goal) === goalKey(goal) && e.mode === 'automatic' && e.annotation.falseAlarm !== true && e.video && s?.completed && !s.censoredReason && s.observationMs >= 120000 && s.coverage >= .6 && s.coverage <= 1 && s.validMs >= 30000 && s.validMs <= s.observationMs && s.onTaskShare !== null && Number.isFinite(s.onTaskShare) && s.onTaskShare >= 0 && s.onTaskShare <= 1;
  });
  const styles = (['plain', 'analogy', 'humor'] as const).flatMap(style => {
    const es = eligible.filter(e => e.video!.style === style);
    if (!es.length) return [];
    const recovery = es.map(e => e.summary!.recoveredAfterMs).filter((x): x is number => x !== null && Number.isFinite(x));
    return [{ style, count: es.length, meanOnTaskShare: es.reduce((s, e) => s + e.summary!.onTaskShare!, 0) / es.length, meanRecoveryMs: recovery.length ? recovery.reduce((a, b) => a + b, 0) / recovery.length : null }];
  });
  const names = { plain: '平实讲解', analogy: '类比讲解', humor: '轻松幽默' };
  const memo = !eligible.length ? '当前学习目标暂无完整且质量足够的自动干预记录，先按本人设置选择。' : styles.map(s => `${names[s.style]}：${s.count} 次可评估记录，返回后任务相关注视比例均值 ${(s.meanOnTaskShare * 100).toFixed(0)}%${s.count < 3 ? '；不足 3 次，暂不用于改变选择' : ''}。`).join(' ') + ' 这些是观察结果，不证明视频造成了改善。';
  return { eligibleCount: eligible.length, styles, memo };
}

export function makeGenerationRequest(profile: Profile, episode: EpisodeRecord, memory: MemoryView): GenerationRequest {
  if (profile.id !== episode.profileId) throw new Error('用户与干预记录不匹配');
  return {
    schemaVersion: 1, requestId: episode.id, userId: profile.id, goal: episode.goal,
    studyContext: { text: episode.studyContext, source: 'user', capturedAt: episode.createdAt },
    trigger: { reason: episode.triggerReason, mode: episode.mode, detectedAt: episode.createdAt },
    personalization: { preferences: { ...profile.preferences }, evidence: memory.styles.map(s => ({ ...s })), memo: memory.memo },
    constraints: { mustAnswerQuiz: true }, mode: 'local-video',
  };
}

export function chooseVideo(request: GenerationRequest, assets: VideoAsset[]): VideoAsset {
  const candidates = assets.filter(a => goalKey(a.goal) === goalKey(request.goal));
  if (!candidates.length) throw new Error('当前学习目标没有可用本地视频，请选择视频或使用示例学习目标。');
  const p = request.personalization.preferences;
  const score = (a: VideoAsset) => {
    const e = request.personalization.evidence.find(s => s.style === a.style && s.count >= 3);
    const observed = e ? (e.meanOnTaskShare * e.count + 1) / (e.count + 2) - .5 : 0;
    return (a.style === p.style ? .2 : 0) + (a.pace === p.pace ? .05 : 0) + observed - (a.durationSeconds > p.maxSeconds ? .1 : 0);
  };
  return [...candidates].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}
