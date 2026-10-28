import { useEffect, useState } from 'react';
import { endsBarShown, endsBarText, endsBarTitle } from '../../../shared/access';
import { Notice } from '../ui/Notice';
import { useAccess } from './access-store';

/*
 * When access ends (Session 54, the owner's decision of 28 Oct 2026): from 7 days before the end of the length the
 * owner gave (at once for a shorter one), a bar in the window's flow under the header, in Pro and Simple Mode alike,
 * so it never covers a control: when, how long is left, and to ask for more time. It cannot be closed; a new length
 * or Unlimited takes it away. The main process says how long was left as of the list's last signed answer (the
 * list's clock, never this computer's); the bar counts down from there on the window's own monotonic clock.
 */
export function AccessEndsNotice() {
  const view = useAccess((s) => s.view);
  if (view === null || (view.phase !== 'in' && view.phase !== 'warning')) return null;
  if (view.endsAt === null || view.endsInMs === null) return null;
  // A new end (a new length) counts down afresh.
  return <EndsBar key={view.endsAt} endsAt={view.endsAt} endsInMs={view.endsInMs} />;
}

function EndsBar({ endsAt, endsInMs }: { endsAt: number; endsInMs: number }) {
  const [from] = useState(() => ({ left: endsInMs, at: performance.now() }));
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
  if (!endsBarShown(left)) return null;
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="access-ends-notices">
      <Notice
        tone="warning"
        role="status"
        title={endsBarTitle(endsAt)}
        data-testid="access-ends-notice"
        data-ends-at={String(endsAt)}
      >
        {endsBarText(left)}
      </Notice>
    </div>
  );
}
