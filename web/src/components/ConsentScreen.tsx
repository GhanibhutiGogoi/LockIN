import { useState } from 'react';
import { askNotificationPermission, notificationsSupported } from '../lib/callback';
import { registry } from '../providers/registry';
import { actions } from '../store';

/** Bump when what is measured or kept changes: everyone sees the screen again. */
export const CONSENT_VERSION = '2026-11-v2';

/**
 * First-run consent, in plain language: what LockIn measures, what it keeps,
 * what it never keeps, and how to stop. Shown before the camera is asked for.
 */
export function ConsentScreen() {
  const usesCamera = registry.attention.needsCamera;
  const [notify, setNotify] = useState(false);
  const recaps = registry.canRecap();

  const agree = async () => {
    if (notify) await askNotificationPermission();
    actions.setConsent(CONSENT_VERSION);
  };

  return (
    <div className="fade-in fixed inset-0 z-50 overflow-auto bg-paper" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="mx-auto max-w-[620px] px-[max(20px,env(safe-area-inset-left))] pt-[10vh] pb-16 pr-[max(20px,env(safe-area-inset-right))]">
        <h1 id="consent-title" className="text-[clamp(28px,3vw,40px)]">
          Before you start
        </h1>
        <p className="mt-3 text-[17px] text-graphite">Your slides and session reports stay in this browser. Here is what is available for this session.</p>

        <dl className="mt-8 grid gap-6 text-[16px] leading-[1.55]">
          <div>
            <dt className="font-semibold">What LockIn measures</dt>
            <dd className="mt-1 text-graphite">
              {usesCamera
                ? 'About ten times a second, your webcam is used to estimate whether your eyes are on the slide. LockIn also notices when you switch to another tab or app.'
                : registry.config.attention.mode === 'off'
                  ? 'Study time, slides visited, and whether this tab is active. Gaze tracking is not connected, so this session will not estimate your attention.'
                  : 'A connected tracker provides focus estimates. LockIn also notices when this tab is active. Development simulations are labelled and excluded from saved history.'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">What it keeps</dt>
            <dd className="mt-1 text-graphite">Your uploaded PDFs and completed session reports are saved on this device. Focus measurements are included only when a tracker supplies them. Clearing this browser’s site data removes this library.</dd>
          </div>
          <div>
            <dt className="font-semibold">AI features</dt>
            <dd className="mt-1 text-graphite">{recaps ? 'When a manual or automatic recap starts, recap services receive that slide’s text to create narration and questions. Simply opening or paging through slides does not send their text. A connected personalization service may receive session measurements and quiz answers. This interface does not record camera video.' : 'AI recaps are not connected. You can read slides and save a session report without them. This interface does not record camera video.'}</dd>
          </div>
          <div>
            <dt className="font-semibold">You stay in control</dt>
            <dd className="mt-1 text-graphite">
              Press <kbd>P</kbd> to pause the session. If the camera is in use, it turns off. Delete saved decks from your library and session history in Settings. You can stop whenever you like.
            </dd>
          </div>
        </dl>

        {recaps && notificationsSupported() && Notification.permission !== 'denied' && (
          <label className="mt-8 flex items-start gap-3 text-[16px]">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>
              <span className="font-semibold">Call me back with a notification</span>
              <span className="block text-graphite">If you switch away and drift, LockIn plays a short sound and sends a notification instead of starting the recap where you can't see it.</span>
            </span>
          </label>
        )}

        <div className="mt-10 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => void agree()} autoFocus>
            I agree, start studying
          </button>
          <button type="button" className="btn btn-quiet btn-lg" onClick={() => actions.go('desk')}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
