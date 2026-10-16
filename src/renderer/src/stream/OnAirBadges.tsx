import { useStream } from './stream-store';
import { cx } from '../ui/cx';
import { VolumeX } from '../ui/icons';

/*
 * ON AIR and REC: the stream is public now, and it is being recorded. Kept
 * apart from the slide's LIVE (which means "on the hall's screens"): ON AIR
 * has a colour of its own, REC is a red dot beside the word, and both say
 * so in words. Beside them, No sound (Session 31) when nothing has reached
 * the stream for 20 s, in the warning's amber (NoSoundNotice says why).
 */

export function OnAirBadges({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  const status = useStream((s) => s.status);
  const live = status?.live.state ?? 'off';
  const rec = status?.recording.state === 'recording';
  const onAir = live === 'live' || live === 'reconnecting';
  // Several places (Session 28): ON AIR while any is, with how many of them.
  const places = status?.live.destinations ?? [];
  const onCount = places.filter((d) => d.state === 'live').length;
  const noSound = status?.noSound ?? null;
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
          {live === 'reconnecting'
            ? 'On air · reconnecting'
            : places.length > 1
              ? `On air · ${String(onCount)} of ${String(places.length)}`
              : 'On air'}
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
      {noSound && (
        <span
          data-testid="no-sound"
          className={cx(
            'inline-flex items-center gap-1 rounded-sm border border-warning bg-warning-bg font-bold tracking-wide text-warning-fg uppercase',
            text,
          )}
        >
          <VolumeX aria-hidden="true" className={size === 'lg' ? 'h-4 w-4' : 'h-3 w-3'} />
          No sound
        </span>
      )}
    </div>
  );
}
