import { useEffect, useRef, useState } from 'react';
import { checkAIConnection } from '../providers/connection';
import { registry, useIntegrationConfig } from '../providers/registry';
import { isRunning } from '../session/engine';
import { useApp } from '../store';

export function AIConnectionSettings() {
  const config = useIntegrationConfig();
  // Subscribe so finishing a session also releases the connection controls.
  useApp((s) => s.screen);
  const running = isRunning();
  const connected = config.media.mode === 'http';
  const [url, setUrl] = useState(connected ? config.media.url : '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (running || pending.current) return;
    const ctrl = new AbortController();
    pending.current = ctrl;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await checkAIConnection(url, ctrl.signal);
      if (ctrl.signal.aborted || isRunning()) return;
      const content = result.scripts
        ? { mode: 'http', url: result.url, deckImport: result.deckImport }
        : { mode: 'local', url: '' };
      const persisted = registry.setAI({ media: { mode: 'http', url: result.url }, content });
      setUrl(result.url);
      setMessage([
        result.scripts ? 'Connection saved. Narration is ready; scripts will be requested through this API.' : 'Narration connected. AI recaps still need the script service connected on the server.',
        result.videoCount ? `${result.videoCount} published video ${result.videoCount === 1 ? 'clip' : 'clips'} available.` : 'No video clips published yet; recaps will keep the slide visible.',
        !persisted ? 'Browser storage is unavailable. This address will need to be entered again after reload.' : '',
      ].filter(Boolean).join(' '));
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : 'Could not connect. Try again.');
    } finally {
      if (pending.current === ctrl) { pending.current = null; setBusy(false); }
    }
  }

  return (
    <section className="mb-10 grid gap-4" aria-labelledby="ai-connection-title">
      <h3 id="ai-connection-title" className="text-[17px]">AI connection</h3>
      <p className="text-[15px] text-graphite">Connect to your local computer or a hosted LockIn API. Slide text is sent there when you use AI recaps.</p>
      <form onSubmit={(e) => void connect(e)} className="grid min-w-0 gap-3">
        <label htmlFor="ai-api-url" className="text-[15px] font-semibold">API address</label>
        <input id="ai-api-url" type="url" required className="field w-full min-w-0" value={url}
          placeholder="https://your-server.example/media-api/" autoComplete="off" spellCheck={false}
          disabled={busy || running} aria-describedby="ai-api-help" aria-invalid={!!error}
          onChange={(e) => { setUrl(e.target.value); setError(''); setMessage(''); }} />
        <p id="ai-api-help" className="text-[15px] text-graphite">For a local service or SSH tunnel, use http://127.0.0.1:8011/. The connection check sends no slides.</p>
        {running && <p className="text-[15px] text-graphite">Finish your study session before changing the API connection.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" disabled={!url.trim() || busy || running}>{busy ? 'Checking connection…' : 'Test and save'}</button>
          {connected && <button type="button" className="btn btn-quiet" disabled={busy || running} onClick={() => {
            const persisted = registry.setAI({ media: { mode: 'off', url: '' }, content: { mode: 'local', url: '' } });
            setUrl(''); setError(''); setMessage(`AI disconnected. Slide study is still available.${persisted ? '' : ' Browser storage is unavailable; this change may not survive a reload.'}`);
          }}>Disconnect</button>}
        </div>
        {error && <p role="alert" className="text-[15px] break-words text-lapse">{error}</p>}
        <p role="status" className="text-[15px] break-words text-graphite">{message || (connected ? `Saved API: ${config.media.url} — test again to check current availability.` : 'No AI connection saved. You can keep studying your slides.')}</p>
      </form>
    </section>
  );
}
