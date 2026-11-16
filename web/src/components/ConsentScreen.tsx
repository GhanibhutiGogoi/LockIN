import { useState } from 'react';
import { askNotificationPermission, notificationsSupported } from '../lib/callback';
import { registry } from '../providers/registry';
import { actions } from '../store';

/** Bump when what is measured or kept changes: everyone sees the screen again. */
export const CONSENT_VERSION = '2026-11-v6';

/**
 * First-run consent, in plain language: what LockIn measures, what it keeps,
 * what it never keeps, and how to stop. Shown before the camera is asked for.
 */
export function ConsentScreen({ screenStudy = false }: { screenStudy?: boolean }) {
  const usesCamera = registry.attention.needsCamera;
  const [notify, setNotify] = useState(notificationsSupported() && Notification.permission !== 'denied');

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
        <p className="mt-3 text-[17px] text-graphite">{screenStudy ? 'LockIn compares visible text with your study goal and can gently remind you when the shared page appears unrelated.' : 'LockIn notices when your attention leaves the slide and plays a short recap to bring you back.'}</p>

        <dl className="mt-8 grid gap-6 text-[16px] leading-[1.55]">
          <div>
            <dt className="font-semibold">What LockIn measures</dt>
            <dd className="mt-1 text-graphite">
              {screenStudy ? 'LockIn reads visible text and checks it against your goal on this Mac. With the camera calibrated, LockIn also estimates whether you are looking at the display.' : usesCamera
                ? 'About ten times a second, your webcam is used to estimate whether your eyes are on the slide. LockIn also notices when you switch to another tab or app.'
                : 'About ten times a second, LockIn receives a focus estimate from the gaze tracker, and notices when you switch to another tab or app.'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">What it keeps</dt>
            <dd className="mt-1 text-graphite">{screenStudy ? 'Your study goal and activity labels are used for the current session. The local memory bank can keep recap outcomes and a short text excerpt when memory is enabled.' : 'A focus score from 0 to 100 once a second, which slide you were on, when a recap played and for how long, and your answers to the recap questions. With Local memory bank selected, the local service stores recap outcomes, slide titles and a short text excerpt to find related memories across decks. A connected content service receives a short summary when requesting a personalized recap.'}</dd>
          </div>
          {registry.attention.calibrationModel && (
            <div>
              <dt className="font-semibold">Camera calibration</dt>
              <dd className="mt-1 text-graphite">This Mac keeps a diagnostic file with calibration progress, sample counts and validation errors.</dd>
            </div>
          )}
          <div>
            <dt className="font-semibold">What it never keeps</dt>
            <dd className="mt-1 text-graphite">Video, photos or sound. Camera frames {screenStudy && 'and shared screen frames '}are processed on this computer and discarded.</dd>
          </div>
          <div>
            <dt className="font-semibold">You stay in control</dt>
            <dd className="mt-1 text-graphite">
              Press <kbd>P</kbd> or the camera dot at any time to pause, and the camera turns fully off. {screenStudy && 'Screen reading pauses too. Stop sharing in LockIn or your browser to release the screen. '}You can delete your session history in Settings. Taking part in the study is voluntary, and you can stop whenever you like.
            </dd>
          </div>
        </dl>

        {notificationsSupported() && Notification.permission !== 'denied' && (
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
