import type { ScreenStatus } from '../../../shared/screens';
import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { usePlaylists } from '../playlists/playlist-store';
import { usePassageName } from '../shastra/passage-names';
import { useScreens } from '../screens/screens-store';
import { Badge, LiveBadge } from '../ui/Badge';
import { cx } from '../ui/cx';
import { Monitor, MonitorOff, Music } from '../ui/icons';
import { Truncate } from '../ui/Truncate';

const NO_STATUS: ScreenStatus[] = [];

/** What is on the screens, in words: the header says it at all times. */
export function LiveStatus() {
  const live = useEngine((s) => s.state?.live);
  const slideShown = useEngine((s) => s.state?.layers.slide !== null);
  const blackout = useEngine((s) => s.state?.blackout ?? false);
  const audio = useEngine((s) => s.state?.layers.audio?.title ?? null);
  const name = useLibrary((s) => s.presentations.find((p) => p.id === live?.presentationId)?.name);
  // A Shastra passage is not in the library's list: its reference instead.
  const passage = usePassageName(live?.presentationId);
  // A picture, video or sound from a playlist: its name, when that playlist is open.
  const itemLabel = usePlaylists((s) => s.items.find((i) => i.id === live?.playlist?.itemId)?.label);
  let text = 'Nothing live';
  if (live?.presentationId && live.slideIndex !== null) {
    text = `Live: ${name ?? passage ?? 'presentation'} · slide ${live.slideIndex + 1} of ${live.slideCount}${slideShown ? '' : ' (cleared)'}`;
  } else if (live?.playlist) {
    text = `Live: ${itemLabel ?? 'playlist item'}`;
  }
  const onAir =
    Boolean(live?.presentationId && slideShown) || Boolean(live?.playlist && !live.presentationId);
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm" data-testid="live-status" aria-live="polite">
      {onAir ? <LiveBadge /> : <Badge>Off</Badge>}
      <Truncate text={text} className={cx('font-medium', !onAir && 'text-muted')} data-testid="live-text" />
      {blackout && <Badge tone="live">Black-out</Badge>}
      {audio !== null && (
        <span
          className="flex min-w-0 items-center gap-1 text-xs text-muted"
          data-testid="audio-status"
          title="On the audio layer"
        >
          <Music size={13} aria-hidden="true" className="shrink-0" />
          <Truncate text={audio || 'Audio'} />
        </span>
      )}
    </div>
  );
}

/** "2 screens showing · 1 display not connected", so a volunteer notices a dead output. */
export function ScreensSummary({ onOpen }: { onOpen: (() => void) | null }) {
  // Select the stored array itself: a new [] per call would re-render forever.
  const status = useScreens((s) => s.snapshot?.status) ?? NO_STATUS;
  const showing = status.filter((s) => s.state === 'showing').length;
  const missing = status.filter((s) => s.state === 'missing-display').length;
  const text =
    status.length === 0
      ? 'No screens set up'
      : `${showing} ${showing === 1 ? 'screen' : 'screens'} showing${missing ? ` · ${missing} display${missing === 1 ? '' : 's'} not connected` : ''}`;
  const IconShape = missing ? MonitorOff : Monitor;
  // Without anything to open: the same words, not a button.
  if (!onOpen)
    return (
      <span
        className={cx(
          'flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5',
          missing ? 'bg-warning-bg text-warning-fg' : 'text-muted',
        )}
        data-testid="screens-summary"
      >
        <IconShape size={13} aria-hidden="true" />
        {text}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open the screens dashboard"
      className={cx(
        'flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5',
        missing ? 'bg-warning-bg text-warning-fg' : 'text-muted hover:text-fg',
      )}
      data-testid="screens-summary"
    >
      <IconShape size={13} aria-hidden="true" />
      {text}
    </button>
  );
}
