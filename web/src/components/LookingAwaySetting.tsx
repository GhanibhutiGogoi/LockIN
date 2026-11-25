import { useEffect, useState } from 'react';
import { actions, useApp } from '../store';
import { lookingAwaySeconds, MIN_LOOKING_AWAY_SEC, MAX_LOOKING_AWAY_SEC } from '../lib/lookingAway';

export function LookingAwaySetting() {
  const seconds = useApp(s => lookingAwaySeconds(s.settings.lookingAwaySec));
  const [draft, setDraft] = useState(String(seconds));
  useEffect(() => setDraft(String(seconds)), [seconds]);
  const value = draft.trim() ? Number(draft) : NaN;
  const valid = Number.isInteger(value) && value >= MIN_LOOKING_AWAY_SEC && value <= MAX_LOOKING_AWAY_SEC;
  const apply = () => { if (valid) actions.setSettings({ lookingAwaySec: value }); };
  return <div className="grid gap-3">
    <label htmlFor="looking-away-seconds" className="text-[16px] font-semibold">Looking away duration</label>
    <div className="flex items-center gap-3">
      <input id="looking-away-seconds" type="number" min={MIN_LOOKING_AWAY_SEC} max={MAX_LOOKING_AWAY_SEC} step={1}
        value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
        aria-invalid={!valid} aria-describedby="looking-away-help"
        className="w-24 rounded-lg border border-rule bg-sheet px-3 py-2 text-[16px]" />
      <span>seconds</span>
      <button type="button" className="btn btn-quiet btn-sm" disabled={!valid || value === seconds} onClick={apply}>Apply</button>
    </div>
    <p id="looking-away-help" className="text-[14px] text-graphite">
      Choose {MIN_LOOKING_AWAY_SEC}–{MAX_LOOKING_AWAY_SEC} seconds. Default: 30 seconds. Applies immediately and is saved on this browser.
      {' '}Screen sharing uses the same delay for off-topic pages. Playback also waits for the recap to be ready.
    </p>
    <p role="status" className="text-[14px] text-graphite">{valid ? `Current duration: ${seconds} seconds.` : `Enter a whole number from ${MIN_LOOKING_AWAY_SEC} to ${MAX_LOOKING_AWAY_SEC}.`}</p>
  </div>;
}
