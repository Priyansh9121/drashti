import { useEffect, useState } from 'react';
import { offlineLine } from '../../../shared/access';
import { AlertTriangle } from '../ui/icons';
import { useAccess } from './access-store';

/*
 * Can't reach the access list (Session 54's No internet bar, made one line by the owner's decision of 29 Oct 2026):
 * while the list does not answer, Drashti keeps working, the stream and recording included, for up to an hour from
 * the last answer. The main process says so only once there has been no answer for about 2 minutes, three checks in a
 * row (service.ts), so a check now and then that misses on a working network says nothing.
 *
 * One line under the top bar, in Pro and Simple Mode alike, in a strip kept for it there: nothing in the window moves
 * when the line comes or goes, and it is never over a control. It says how long is left, in the owner's own words, and
 * goes once the list answers again. The main process says how long is left at each change; the line counts down
 * between them on the window's own monotonic clock. It is read out politely (the strip is a status region).
 */
export function AccessOfflineNotice() {
  const view = useAccess((s) => s.view);
  const left = view?.phase === 'warning' ? view.stopsInMs : null;
  return (
    <div
      role="status"
      className="h-6 shrink-0 overflow-hidden border-b border-line bg-panel"
      data-testid="access-offline-notices"
    >
      {/* A new count at each change the main process sends (a sleep, say), from what it says is left. */}
      {left !== null && <OfflineLine key={left} stopsInMs={left} />}
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
      className="flex h-full items-center gap-2 border-l-4 border-l-warning bg-warning-bg px-3 text-[13px] leading-5 font-semibold text-warning-fg"
      data-testid="access-offline-notice"
    >
      <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">{offlineLine(left)}</span>
    </p>
  );
}
