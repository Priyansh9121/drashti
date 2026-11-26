import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { offlineLine } from '../../../shared/access';
import { cx } from '../ui/cx';
import { AlertTriangle } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
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
 * moves when the line comes or goes, and it is never over a control. Its words, cut short with "…" there if they must
 * be, are whole in its tooltip and to a screen reader. It says how long is left, in the owner's own words, and goes
 * once the list answers again. The main process says how long is left at each change; the line counts down between
 * them on the window's own monotonic clock. It is read out politely (its place is a status region, there always).
 */
export function AccessOfflineNotice({ children }: { children: ReactNode }) {
  const view = useAccess((s) => s.view);
  const left = view?.phase === 'warning' ? view.stopsInMs : null;
  return (
    // The version's place: as tall as the bar, so the line has the bar's height; as wide as the version, always.
    <div className="relative flex items-center self-stretch">
      <div className={cx('flex items-center', left !== null && 'invisible')}>{children}</div>
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
  const left = Math.max(0, from.left - (now - from.at));
  return (
    <p
      // The status bar's warning look (as Sound output not connected's); its tooltip takes the mouse, nothing else.
      className="pointer-events-auto flex h-5 w-full min-w-0 items-center gap-1.5 rounded-sm bg-warning-bg px-1.5 text-warning-fg"
      data-testid="access-offline-notice"
    >
      <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
      <Truncate text={offlineLine(left)} />
    </p>
  );
}
