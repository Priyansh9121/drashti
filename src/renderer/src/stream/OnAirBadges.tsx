import { useStream } from './stream-store';
import { cx } from '../ui/cx';

/*
 * ON AIR and REC: the stream is public now, and it is being recorded. Kept
 * apart from the slide's LIVE (which means "on the hall's screens"): ON AIR
 * has a colour of its own, REC is a red dot beside the word, and both say
 * so in words.
 */

export function OnAirBadges({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  const status = useStream((s) => s.status);
  const live = status?.live.state ?? 'off';
  const rec = status?.recording.state === 'recording';
  const onAir = live === 'live' || live === 'reconnecting';
  if (!onAir && !rec) return null;
  const text = size === 'lg' ? 'text-sm px-2.5 py-1' : 'text-2xs px-1.5 leading-5';
  return (
    <div className={cx('flex shrink-0 items-center gap-1.5', className)} role="status" aria-live="polite">
      {onAir && (
        <span
          data-testid="on-air"
          className={cx(
            'inline-flex items-center gap-1 rounded-sm border border-onair bg-onair font-bold tracking-wide text-white uppercase',
            text,
          )}
        >
          {live === 'reconnecting' ? 'On air · reconnecting' : 'On air'}
        </span>
      )}
      {rec && (
        <span
          data-testid="rec"
          className={cx(
            'inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-panel-2 font-bold tracking-wide text-fg uppercase',
            text,
          )}
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-rec" />
          Rec
        </span>
      )}
    </div>
  );
}
