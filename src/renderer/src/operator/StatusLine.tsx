import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { usePlaylists } from '../playlists/playlist-store';
import type { ScreenStatus } from '../../../shared/screens';
import { useScreens } from '../screens/screens-store';

const NO_STATUS: ScreenStatus[] = [];

export function LiveStatus() {
  const live = useEngine((s) => s.state?.live);
  const slideShown = useEngine((s) => s.state?.layers.slide !== null);
  const blackout = useEngine((s) => s.state?.blackout ?? false);
  const audio = useEngine((s) => s.state?.layers.audio?.title ?? null);
  const name = useLibrary((s) => s.presentations.find((p) => p.id === live?.presentationId)?.name);
  // A picture, video or sound from a playlist: its name, when that playlist is open.
  const itemLabel = usePlaylists((s) => s.items.find((i) => i.id === live?.playlist?.itemId)?.label);
  let text = 'Nothing live';
  if (live?.presentationId && live.slideIndex !== null) {
    text = `Live: ${name ?? 'presentation'} · slide ${live.slideIndex + 1} of ${live.slideCount}${slideShown ? '' : ' (cleared)'}`;
  } else if (live?.playlist) {
    text = `Live: ${itemLabel ?? 'playlist item'}`;
  }
  return (
    <p className="flex items-center gap-2 text-sm" data-testid="live-status" aria-live="polite">
      <span
        className={`h-2.5 w-2.5 rounded-full ${live?.presentationId && slideShown ? 'bg-live' : 'bg-line'}`}
        aria-hidden="true"
      />
      <span data-testid="live-text">{text}</span>
      {blackout && (
        <span className="rounded bg-live px-2 py-0.5 text-xs font-bold text-white">BLACK-OUT</span>
      )}
      {audio !== null && (
        <span className="truncate text-xs text-muted" data-testid="audio-status" title="On the audio layer">
          {`♪ ${audio || 'Audio'}`}
        </span>
      )}
    </p>
  );
}

/** "2 screens showing · 1 display not connected", so a volunteer notices a dead output. */
export function ScreensSummary({ onOpen }: { onOpen: () => void }) {
  // Select the stored array itself: a new [] per call would re-render forever.
  const status = useScreens((s) => s.snapshot?.status) ?? NO_STATUS;
  const showing = status.filter((s) => s.state === 'showing').length;
  const missing = status.filter((s) => s.state === 'missing-display').length;
  const text =
    status.length === 0
      ? 'No screens set up'
      : `${showing} ${showing === 1 ? 'screen' : 'screens'} showing${missing ? ` · ${missing} display${missing === 1 ? '' : 's'} not connected` : ''}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`rounded-md px-2 py-1 text-xs ${missing ? 'bg-amber-900/60 text-amber-100' : 'text-muted hover:text-white'}`}
      data-testid="screens-summary"
    >
      {text}
    </button>
  );
}
