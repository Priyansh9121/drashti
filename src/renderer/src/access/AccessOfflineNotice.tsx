import { useEffect, useState } from 'react';
import { OFFLINE_TEXT, offlineLine } from '../../../shared/access';
import { Notice } from '../ui/Notice';
import { useAccess } from './access-store';

/*
 * No internet (Session 54, the owner's decision of 28 Oct 2026): while the access list does not answer, Drashti keeps
 * working, the stream and recording included, for up to an hour from the last answer. A bar in the window's flow
 * under the header, in Pro and Simple Mode alike, so it never covers a control, says so and how long is left; it goes
 * once the list answers again. The main process says how long is left at each change; the bar counts down between them
 * on the window's own monotonic clock.
 */
export function AccessOfflineNotice() {
  const view = useAccess((s) => s.view);
  if (view?.phase !== 'warning' || view.stopsInMs === null) return null;
  // A new count at each change the main process sends (a sleep, say), from what it says is left.
  return <OfflineBar key={view.stopsInMs} stopsInMs={view.stopsInMs} />;
}

function OfflineBar({ stopsInMs }: { stopsInMs: number }) {
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
    <div className="shrink-0 px-3 pt-2" data-testid="access-offline-notices">
      <Notice tone="warning" role="status" title={offlineLine(left)} data-testid="access-offline-notice">
        {OFFLINE_TEXT}
      </Notice>
    </div>
  );
}
