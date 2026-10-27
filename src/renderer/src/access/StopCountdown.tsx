import { useEffect, useState } from 'react';
import { countdownLine } from '../../../shared/access';
import { AlertTriangle } from '../ui/icons';

/*
 * No answer from the access list (Session 54): the countdown to the stop, over the top of the controls in Pro and
 * Simple Mode alike, while the show goes on. The main process says how long is left at each change; the window counts
 * down on its own monotonic clock between them. Said to a screen reader once, as it starts; the seconds are not.
 */
export function StopCountdown({ stopsInMs }: { stopsInMs: number }) {
  const [from] = useState(() => ({ left: stopsInMs, at: performance.now() }));
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(performance.now());
    }, 250);
    return () => {
      clearInterval(t);
    };
  }, []);
  const left = Math.max(0, from.left - (now - from.at));
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-4"
      data-testid="access-countdown"
    >
      <div className="flex max-w-2xl items-center gap-2 rounded-lg border border-warning/60 border-l-4 border-l-warning bg-warning-bg px-4 py-2 text-base font-medium text-warning-fg shadow-lg">
        <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
        <span role="alert" className="sr-only">
          {countdownLine(stopsInMs)}
        </span>
        <span aria-hidden="true" data-testid="access-countdown-line">
          {countdownLine(left)}
        </span>
      </div>
    </div>
  );
}
