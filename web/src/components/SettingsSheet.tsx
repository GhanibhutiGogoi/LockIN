import { useEffect, useRef, useState } from 'react';
import type { SlangLevel } from '../contracts/types';
import { registry, useIntegrationConfig } from '../providers/registry';
import { isRunning, pauseSession } from '../session/engine';
import { clearPacks } from '../session/packs';
import { configForSensitivity } from '../session/machine';
import { actions, useApp, type Theme } from '../store';
import { CONSENT_VERSION } from './ConsentScreen';
import { Icon } from './Icon';
import { LocalRecaps } from './LocalRecaps';
import { AIConnectionSettings } from './AIConnectionSettings';

const SLANG_SAMPLE: Record<SlangLevel, string> = {
  plain: 'Direct explanations with everyday language.',
  mild: 'Conversational explanations with light humour.',
  unhinged: 'Playful explanations with energetic slang.',
};

export function SettingsSheet() {
  useIntegrationConfig();
  const open = useApp((s) => s.settingsOpen);
  const settings = useApp((s) => s.settings);
  const theme = useApp((s) => s.theme);
  const hasDeck = useApp((s) => s.decks.some((d) => d.id === s.deckId));
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [clear, setClear] = useState<'idle' | 'confirm' | 'done'>('idle');
  const panel = useRef<HTMLDivElement>(null);
  const close = () => useApp.setState({ settingsOpen: false });

  useEffect(() => {
    if (!open) return;
    setClear('idle');
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      // keep Tab inside the sheet while it is open
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const at = document.activeElement;
        if (e.shiftKey && (at === first || at === panel.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || !panel.current.contains(at))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  const cfg = configForSensitivity(settings.sensitivity);

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button type="button" className="fade-in absolute inset-0 h-full w-full cursor-default bg-black/25" onClick={close} aria-label="Close settings" tabIndex={-1} />
      <div
        ref={panel}
        tabIndex={-1}
        className="absolute top-0 right-0 flex h-full w-[min(440px,100%)] flex-col bg-paper shadow-[var(--shadow-float)] outline-none"
        style={{ animation: 'sheet-in 220ms var(--ease-out)' }}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 id="settings-title" className="text-[24px]">
            Settings
          </h2>
          <button type="button" className="icon-btn -mr-2" onClick={close} aria-label="Close">
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <LocalRecaps />
          <details className="mb-8">
            <summary className="cursor-pointer text-sm">Single-server AI connection</summary>
            <AIConnectionSettings />
          </details>
          <Group title="Clips">
            {!registry.canRecap() && <p className="text-[15px] text-graphite">AI recaps are unavailable on this installation. These preferences apply when they are connected.</p>}
            <Field label="How clips talk" htmlFor="slang">
              <div className="seg w-full" id="slang" role="group">
                {(['plain', 'mild', 'unhinged'] as SlangLevel[]).map((l) => (
                  <button key={l} type="button" aria-pressed={settings.slangLevel === l} onClick={() => actions.setSettings({ slangLevel: l })}>
                    {l[0].toUpperCase() + l.slice(1)}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[15px] text-graphite">{SLANG_SAMPLE[settings.slangLevel]}</p>
            </Field>
            <Toggle
              id="roasts"
              label="Roast wrong answers"
              hint="Allow playful feedback about incorrect answers."
              checked={settings.roastsEnabled}
              onChange={(v) => actions.setSettings({ roastsEnabled: v })}
            />
          </Group>

          <Group title="When LockIn steps in">
            <Field label="Sensitivity" htmlFor="sensitivity">
              <input
                id="sensitivity"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.sensitivity}
                onChange={(e) => actions.setSettings({ sensitivity: Number(e.target.value) })}
              />
              <div className="mt-1 flex justify-between text-[14px] text-graphite">
                <span>Patient</span>
                <span>Quick</span>
              </div>
              <p className="mt-2 text-[15px] text-graphite">
                With the relevant services connected, a recap can start after about <b className="text-ink">{cfg.driftToLapseSec} seconds</b> of looking away, or <b className="text-ink">{cfg.windowInactiveLapseSec} seconds</b> in another app. Changes apply to your next session.
              </p>
            </Field>
            <Toggle
              id="nudge-only"
              label="Glow only, no clips"
              hint="When focus slips you’ll only see the soft edge glow. Useful in a library or a lecture hall."
              checked={!!settings.nudgeOnly}
              onChange={(v) => actions.setSettings({ nudgeOnly: v })}
            />
            <Field label="Rest between clips" htmlFor="cooldown">
              <div className="seg" id="cooldown" role="group">
                {[60, 180, 300].map((s) => (
                  <button key={s} type="button" aria-pressed={settings.cooldownSec === s} onClick={() => actions.setSettings({ cooldownSec: s })}>
                    {s / 60} min
                  </button>
                ))}
              </div>

            </Field>
          </Group>

          <Group title="Appearance">
            <Field label="Theme" htmlFor="theme">
              <div className="seg" id="theme" role="group">
                {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                  <button key={t} type="button" aria-pressed={theme === t} onClick={() => actions.setTheme(t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </Field>
          </Group>

          <Group title="Camera and data">
            <div className="grid gap-3 text-[14px]">
              <button
                type="button"
                className="btn btn-quiet justify-start"
                disabled={!hasDeck || !registry.attention.calibratePoint}
                onClick={async () => {
                  // mid-session: pause (tracking off, session kept); the study screen resumes it afterwards
                  if (isRunning()) await pauseSession();
                  actions.setCalibrated(false);
                  close();
                  if (registry.attention.calibrate && useApp.getState().consent !== CONSENT_VERSION) {
                    actions.go('study');
                    return;
                  }
                  actions.go('setup');
                }}
              >
                <Icon name="eye" size={16} /> Recalibrate the camera
              </button>
              <button
                type="button"
                className={`btn justify-start ${clear === 'confirm' ? 'bg-lapse-soft text-ink hover:bg-lapse-soft' : 'btn-quiet'}`}
                disabled={clear === 'done' || deleting || isRunning()}
                aria-live="polite"
                onClick={async () => {
                  if (clear === 'idle') return setClear('confirm');
                  setDeleting(true);
                  setDeleteError(null);
                  try {
                    await actions.clearHistory();
                    clearPacks();
                    await registry.clearMemoryHistory();
                    setClear('done');
                  } catch {
                    setDeleteError('Could not finish deleting history. Check browser storage and the local memory service, then try again.');
                  } finally {
                    setDeleting(false);
                  }
                }}
                onBlur={() => clear === 'confirm' && setClear('idle')}
              >
                <Icon name={clear === 'done' ? 'check' : 'trash'} size={16} />
                {clear === 'done' ? 'Session history deleted' : deleting ? 'Deleting history…' : clear === 'confirm' ? 'Press again to delete it for good' : 'Delete my session history'}
              </button>
              {deleteError && <p role="alert" className="text-[15px] text-lapse">{deleteError}</p>}
              <p className="text-[15px] text-graphite">Saved PDFs and reports stay in this browser. History deletion clears saved reports and the local memory bank. Manage records held by other services separately.</p>
            </div>
          </Group>
        </div>
      </div>
      <style>{'@keyframes sheet-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}'}</style>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 grid gap-5">
      <h3 className="text-[17px]">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-[15px] font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="block text-[15px] font-semibold">
          {label}
        </label>
        <p className="mt-0.5 text-[15px] text-graphite">{hint}</p>
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} className="switch mt-0.5" onClick={() => onChange(!checked)} />
    </div>
  );
}
