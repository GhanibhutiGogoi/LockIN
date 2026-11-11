import { chooseVideo } from './core/memory.ts';
import type { GenerationRequest, VideoAsset, VideoProvider } from './core/types.ts';

export class LocalVideoProvider implements VideoProvider {
  private assets: () => VideoAsset[];
  constructor(assets: () => VideoAsset[]) { this.assets = assets; }
  async prepare(request: GenerationRequest): Promise<VideoAsset> { return chooseVideo(request, this.assets()); }
}

export async function localFileAsset(file: File, goal: string, style: VideoAsset['style'], pace: VideoAsset['pace'], question: string): Promise<VideoAsset> {
  const url = URL.createObjectURL(file);
  try {
    const durationSeconds = await new Promise<number>((resolve, reject) => {
      const v = document.createElement('video');
      const timer = setTimeout(() => { v.removeAttribute('src'); v.load(); reject(new Error('视频读取超时')); }, 10000);
      v.preload = 'metadata';
      v.onloadedmetadata = () => { clearTimeout(timer); const d = v.duration; v.removeAttribute('src'); v.load(); Number.isFinite(d) && d > 0 ? resolve(d) : reject(new Error('无法读取视频时长')); };
      v.onerror = () => { clearTimeout(timer); reject(new Error('浏览器不能播放此文件，请使用 MP4 或 WebM')); };
      v.src = url;
    });
    return { id: crypto.randomUUID(), title: file.name, source: 'local', goal: goal.trim(), style, pace, url, durationSeconds, quiz: { kind: 'recall', question: question.trim() || '请用一句话回忆刚才视频中与本次学习目标有关的一个要点。' } };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

export function sampleAsset(): VideoAsset {
  return { id: 'sample-mean-v1', title: '平均值回顾（无声示例）', source: 'local', goal: '理解平均值的计算', style: 'plain', pace: 'normal', url: new URL('sample-recap.mp4', document.baseURI).href, durationSeconds: 12,
    quiz: { kind: 'choice', question: '2、4、6 的平均值是多少？', options: ['3', '4', '6'], correctIndex: 1 } };
}
