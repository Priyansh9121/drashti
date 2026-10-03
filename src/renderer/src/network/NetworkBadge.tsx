import { cx } from '../ui/cx';
import { Smartphone } from '../ui/icons';
import { useAnnouncements } from './announcements-store';
import { useNetwork } from './network-store';

/**
 * While the network is on, the operator window always says so, with how many
 * devices are connected and how many announcements wait for Pro Mode: in the
 * header and in Simple Mode. Its own quiet look, apart from LIVE and ON AIR.
 */
export function NetworkBadge({ className }: { className?: string }) {
  const status = useNetwork((s) => s.status);
  const waiting = useAnnouncements((s) => s.view?.waiting.length ?? 0);
  if (!status?.on) return null;
  const failed = status.state === 'failed';
  const devices =
    status.connected === 1 ? 'Network on · 1 device' : `Network on · ${status.connected} devices`;
  const queue =
    waiting === 0 ? '' : waiting === 1 ? ' · 1 announcement waiting' : ` · ${waiting} announcements waiting`;
  const text = failed ? 'Network: not listening' : `${devices}${queue}`;
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
