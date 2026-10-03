import { useEffect, useState } from 'react';
import { cx } from '../ui/cx';
import { useFeed } from './feed';

/** This device's own time, redrawn every second (the wait before trying again is on its clock). */
function useDeviceSecond(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);
  return now;
}

/**
 * Whether this device is connected to Drashti, always in sight: Connected,
 * Connecting…, or Not connected with when it tries again (it does by itself).
 */
export function ConnectionChip({ className }: { className?: string }) {
  const state = useFeed((s) => s.state);
  const retryAt = useFeed((s) => s.retryAt);
  const reason = useFeed((s) => s.reason);
  const now = useDeviceSecond();
  const wait = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="connection"
      data-state={state}
      title={reason ?? undefined}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm whitespace-nowrap',
        state === 'online'
          ? 'border-success/60 bg-success-bg text-success-fg'
          : state === 'connecting'
            ? 'border-line-strong bg-panel-2 text-muted'
            : 'border-warning/60 bg-warning-bg text-warning-fg',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'h-2 w-2 rounded-full',
          state === 'online' ? 'bg-success' : state === 'connecting' ? 'bg-muted' : 'bg-warning',
        )}
      />
      {state === 'online'
        ? 'Connected'
        : state === 'connecting'
          ? 'Connecting…'
          : wait > 0
            ? `Not connected · again in ${wait} s`
            : 'Not connected · trying again'}
    </span>
  );
}
