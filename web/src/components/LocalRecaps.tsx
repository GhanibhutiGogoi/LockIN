import { useEffect, useRef, useState } from 'react';
import { normalizeApiUrl } from '../providers/connection';
import { call } from '../providers/http/client';
import { registry, useIntegrationConfig } from '../providers/registry';
import { isRunning } from '../session/engine';
import { clearPacks } from '../session/packs';
import { useApp } from '../store';

const STUDIO = 'http://127.0.0.1:8013/';
type SavedRecap = { id: string; title: string; videoUrl: string; bytes: number; durationSec: number; created: string; gameplay: string; music: string };

export function LocalRecaps() {
  const { media } = useIntegrationConfig();
  useApp((s) => s.screen);
  const [url, setUrl] = useState(media.voiceUrl ?? 'http://127.0.0.1:18114/');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const running = isRunning();
  useEffect(() => () => pending.current?.abort(), []);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || running) return;
    const ctrl = new AbortController();
    pending.current = ctrl;
    setBusy(true); setError(''); setStatus('');
    try {
      const voiceUrl = normalizeApiUrl(url, 'http:');
      const result = await call<{ writer: string; gameplay: number; music: number }>(STUDIO, 'connection', {
        body: { voiceUrl }, signal: ctrl.signal, timeoutMs: 20_000,
      });
      if (ctrl.signal.aborted || isRunning()) return;
      const saved = registry.setAI({ media: { mode: 'http', url: STUDIO, voiceUrl }, content: { mode: 'http', url: STUDIO, deckImport: false } });
      setUrl(voiceUrl);
      setStatus(`Connected with ${result.writer}, ${result.gameplay} gameplay clips and ${result.music} tracks.${saved ? '' : ' Browser settings will expire on reload.'}`);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      pending.current = null;
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }

  return <section className="mb-8 grid gap-3">
    <h3 className="text-[17px]">Local video recaps</h3>
    <p className="text-[15px] text-graphite">Your computer sends the current slide to your configured LLM. The voice API receives the narration text. Gameplay, music and saved videos stay on this computer.</p>
    <form className="grid gap-3" onSubmit={connect}>
      <label className="font-semibold" htmlFor="voice-url">Narration API address</label>
      <input id="voice-url" type="url" required className="field w-full" disabled={busy || running} value={url}
        onChange={(e) => { setUrl(e.target.value); setStatus(''); setError(''); }} />
      <p className="text-sm text-graphite">Start the local studio with <code>media/scripts/start-studio.sh</code>. The default voice address uses an SSH tunnel.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy || running}>{busy ? 'Checking…' : 'Connect narration'}</button>
        {media.voiceUrl && <button type="button" className="btn btn-quiet" disabled={busy || running} onClick={() => {
          registry.setAI({ media: { mode: 'off', url: '' }, content: { mode: 'local', url: '' } });
          setStatus('Narration disconnected.'); setError('');
        }}>Disconnect narration</button>}
      </div>
      {running && <p className="text-sm">Finish the session to change narration services.</p>}
      {error && <p role="alert" className="break-words text-lapse">{error}</p>}
      <p role="status" className="text-sm">{status || (media.voiceUrl ? `Saved narration API · ${media.voiceUrl}` : '')}</p>
    </form>
    <RecapLibrary running={running} />
  </section>;
}

function RecapLibrary({ running }: { running: boolean }) {
  const [items, setItems] = useState<SavedRecap[] | null>(null);
  const [playing, setPlaying] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function update(remove?: string) {
    setBusy(true); setError('');
    try {
      if (remove) {
        await call(STUDIO, `recaps/${remove}`, { method: 'DELETE' });
        if (remove === playing) setPlaying('');
        clearPacks();
      }
      setItems(await call<SavedRecap[]>(STUDIO, 'recaps'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start the local studio and try again.');
    } finally { setBusy(false); }
  }
  return <div className="grid gap-3">
    <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void update()}>{items ? 'Refresh saved videos' : 'View saved videos'}</button>
    {error && <p role="alert" className="break-words text-lapse">{error}</p>}
    {items && <p className="text-sm">{items.length} saved · {(items.reduce((sum, v) => sum + v.bytes, 0) / 1e6).toFixed(1)} MB on disk</p>}
    {items?.map(v => <article key={v.id} className="grid gap-2 border-t border-current/15 pt-3">
      <h4 className="font-semibold">{v.title}</h4>
      <p className="text-sm text-graphite">{Math.round(v.durationSec)}s · {(v.bytes / 1e6).toFixed(1)} MB · {v.music}</p>
      {playing === v.id && <video controls playsInline src={new URL(v.videoUrl, STUDIO).href} className="mx-auto max-h-80" />}
      <div className="flex gap-2">
        <button className="btn btn-quiet" onClick={() => setPlaying(playing === v.id ? '' : v.id)}>{playing === v.id ? 'Close video' : 'View video'}</button>
        <button className="btn btn-quiet" disabled={busy || running} onClick={() => void update(v.id)}>Delete video</button>
      </div>
    </article>)}
  </div>;
}
