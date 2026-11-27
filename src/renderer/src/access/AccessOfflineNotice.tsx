import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { OFFLINE_SHORT_TEXT, offlineLine } from '../../../shared/access';
import { cx } from '../ui/cx';
import { AlertTriangle } from '../ui/icons';
import { useAccess } from './access-store';

/*
 * Can't reach the access list (Session 54's No internet bar, made one line by the owner's decision of 29 Oct 2026):
 * while the list does not answer, Drashti keeps working, the stream and recording included, for up to 15 days from
 * the last answer (the owner's decision of 29 Oct 2026, in place of the hour). The main process says so only once there
 * has been no answer for about 2 minutes, three checks in a row (service.ts), so a check now and then that misses on a
 * working network says nothing.
 *
 * One line in the status bar, in Pro and Simple Mode alike, in place of the version (alpha.24, the owner's
 * QA24-ACCESS-STRIP A, 27 Nov 2026; Session 55 had kept a 24 px strip for it under the top bar, in every look): the
 * version keeps its room, unseen, and the line takes that room and no more, so nothing in the window or the status bar
 * moves when the line comes or goes, and it is never over a control. That room holds only a few words, so the eye gets
 * the short form, whole (OFFLINE_SHORT_TEXT, lead 2's decision inside the owner's A), and the whole line, in the
 * owner's own words with how long is left, is its tooltip and what a screen reader reads. It goes once the list
 * answers again. The main process says how long is left at each change; the line counts down between them on the
 * window's own monotonic clock. It is read out politely (its place is a status region, there always).
 */

/** The line's look: the status bar's warning (as Sound output not connected's), its words on one line. */
const LOOK = 'flex h-5 items-center gap-1 rounded-sm px-1 whitespace-nowrap';

export function AccessOfflineNotice({ children }: { children: ReactNode }) {
  const view = useAccess((s) => s.view);
  const left = view?.phase === 'warning' ? view.stopsInMs : null;
  return (
    // The version's place: as tall as the bar, so the line has the bar's height; as wide as the version, and never
    // narrower than the line's short words (their unseen copy below), always, so nothing moves when the line comes.
    <div className="relative grid items-center self-stretch">
      <div className={cx('col-start-1 row-start-1 flex items-center', left !== null && 'invisible')}>
        {children}
      </div>
      <span aria-hidden="true" className={cx(LOOK, 'invisible col-start-1 row-start-1')}>
        <AlertTriangle size={13} className="shrink-0" />
        <span>{OFFLINE_SHORT_TEXT}</span>
      </span>
      <div
        role="status"
        className="pointer-events-none absolute inset-0 flex items-center overflow-hidden"
        data-testid="access-offline-notices"
      >
        {/* A new count at each change the main process sends (a sleep, say), from what it says is left. */}
        {left !== null && <OfflineLine key={left} stopsInMs={left} />}
      </div>
    </div>
  );
}

function OfflineLine({ stopsInMs }: { stopsInMs: number }) {
  const [from] = useState(() => ({ left: stopsInMs, at: performance.now() }));
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(performance.now());
    }, 15_000);
    return () => {
      clearInterval(t);
    };
  }, []);
  const words = offlineLine(Math.max(0, from.left - (now - from.at)));
  return (
    <p
      // The whole line where the mouse rests on it; only its tooltip takes the mouse, nothing else here.
      title={words}
      className={cx(LOOK, 'pointer-events-auto w-full bg-warning-bg text-warning-fg')}
      data-testid="access-offline-notice"
    >
      <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
      {/* In sight, the short form; read out, the whole line. */}
      <span aria-hidden="true" className="min-w-0 truncate" data-testid="access-offline-short">
        {OFFLINE_SHORT_TEXT}
      </span>
      <span className="sr-only" data-testid="access-offline-words">
        {words}
      </span>
    </p>
  );
}
