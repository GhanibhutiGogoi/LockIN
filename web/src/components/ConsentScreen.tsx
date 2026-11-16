import { useState } from 'react';
import { askNotificationPermission, notificationsSupported } from '../lib/callback';
import { registry } from '../providers/registry';
import { actions } from '../store';

/** Bump when what is measured or kept changes: everyone sees the screen again. */
export const CONSENT_VERSION = '2026-11-v7';

/**
 * First-run consent, in plain language: what LockIn measures, what it keeps,
 * what it never keeps, and how to stop. Shown before the camera is asked for.
 */
export function ConsentScreen({ screenStudy = false }: { screenStudy?: boolean }) {
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
              {screenStudy ? 'LockIn reads visible text and checks it against your goal on this Mac. With the camera calibrated, LockIn also estimates whether you are looking at the display.' : usesCamera
                ? 'About ten times a second, your webcam is used to estimate whether your eyes are on the slide. LockIn also notices when you switch to another tab or app.'
                : registry.config.attention.mode === 'off'
                  ? 'Study time, slides visited, and whether this tab is active. Gaze tracking is not connected, so this session will not estimate your attention.'
                  : 'A connected tracker provides focus estimates. LockIn also notices when this tab is active. Development simulations are labelled and excluded from saved history.'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">What it keeps</dt>
            <dd className="mt-1 text-graphite">
              {screenStudy
                ? 'The visible text and activity labels are used for this session. The local memory bank can keep recap outcomes and a short text excerpt when enabled.'
                : 'Your uploaded PDFs and completed reports are saved in this browser. Reports include focus measurements when available. The local memory bank can keep recap outcomes and a short text excerpt when enabled.'}
            </dd>
          </div>
          {registry.attention.calibrationModel && (
            <div>
              <dt className="font-semibold">Camera calibration</dt>
              <dd className="mt-1 text-graphite">This Mac keeps a diagnostic file with calibration progress, sample counts and validation errors.</dd>
            </div>
          )}
          <div>
            <dt className="font-semibold">Frames and recap services</dt>
            <dd className="mt-1 text-graphite">
              Camera frames {screenStudy && 'and shared screen frames '}are processed on this computer and discarded.
              {!screenStudy && recaps && ' Connected recap services receive slide text and may receive a short study history summary.'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">You stay in control</dt>
            <dd className="mt-1 text-graphite">
              Press <kbd>P</kbd> to pause. If the camera is in use, it turns off. {screenStudy && 'Stop sharing in LockIn or your browser to release the screen. '}You can delete saved decks from your library and session history in Settings.
            </dd>
          </div>
        </dl>

        {recaps && notificationsSupported() && Notification.permission !== 'denied' && (
          <label className="mt-8 flex items-start gap-3 text-[16px]">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>
              <span className="font-semibold">Call me back with a notification</span>
              <span className="block text-graphite">Receive a system notification if LockIn flags a distraction while you are outside the app.</span>
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
