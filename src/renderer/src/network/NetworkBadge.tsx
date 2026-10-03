import { cx } from '../ui/cx';
import { Smartphone } from '../ui/icons';
import { useNetwork } from './network-store';

/**
 * While the network is on, the operator window always says so, with how many
 * devices are connected: in the header and in Simple Mode. Its own quiet look,
 * apart from LIVE and ON AIR.
 */
export function NetworkBadge({ className }: { className?: string }) {
  const status = useNetwork((s) => s.status);
  if (!status?.on) return null;
  const failed = status.state === 'failed';
  const text = failed
    ? 'Network: not listening'
    : status.connected === 1
      ? 'Network on · 1 device'
      : `Network on · ${status.connected} devices`;
  return (
    <span
      role="status"
      data-testid="network-badge"
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 text-2xs leading-5 font-bold tracking-wide whitespace-nowrap uppercase',
        failed ? 'border-warning/60 bg-warning-bg text-warning-fg' : 'border-accent/60 bg-panel-2 text-fg',
        className,
      )}
    >
      <Smartphone size={11} aria-hidden="true" strokeWidth={2.5} />
      {text}
    </span>
  );
}
