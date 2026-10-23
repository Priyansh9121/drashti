import { WORDS_IF_NARROWER } from '../operator/top-bar';
import { cx } from '../ui/cx';
import { Smartphone } from '../ui/icons';
import { useAnnouncements } from './announcements-store';
import { useNetwork } from './network-store';

/**
 * While the network is on, the operator window always says so, with how many
 * devices are connected and how many announcements wait for Pro Mode: in the
 * header and in Simple Mode. Its own quiet look, apart from LIVE and ON AIR.
 * Pro Mode's header leaves the count to its Announcements button beside it
 * (Sessions 31–36: the header at 1280 has room for one of them).
 */
export function NetworkBadge({
  className,
  waiting: sayWaiting = true,
  compact = false,
}: {
  className?: string;
  waiting?: boolean;
  /**
   * In a crowded top bar (Session 51, operator/top-bar.ts): below 1280 px wide, how many devices beside its icon,
   * its words for screen readers (and said when the mouse rests on it), so ON AIR and REC fit beside it.
   */
  compact?: boolean;
}) {
  const status = useNetwork((s) => s.status);
  const waiting = useAnnouncements((s) => s.view?.waiting.length ?? 0);
  if (!status?.on) return null;
  const failed = status.state === 'failed';
  const devices = status.connected === 1 ? ' device' : ' devices';
  const queue =
    !sayWaiting || waiting === 0
      ? ''
      : waiting === 1
        ? ' · 1 announcement waiting'
        : ` · ${String(waiting)} announcements waiting`;
  const words = compact ? WORDS_IF_NARROWER : undefined;
  return (
    <span
      role="status"
      data-testid="network-badge"
      title={compact && !failed ? `Network on · ${String(status.connected)}${devices}` : undefined}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 text-2xs leading-5 font-bold tracking-wide whitespace-nowrap uppercase',
        failed ? 'border-warning/60 bg-warning-bg text-warning-fg' : 'border-accent/60 bg-panel-2 text-fg',
        className,
      )}
    >
      <Smartphone size={11} aria-hidden="true" strokeWidth={2.5} />
      {/* Not listening is a warning: always in words. */}
      {failed ? (
        'Network: not listening'
      ) : (
        <span>
          <span className={words}>Network on · </span>
          {String(status.connected)}
          <span className={words}>{`${devices}${queue}`}</span>
        </span>
      )}
    </span>
  );
}
