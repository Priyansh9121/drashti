import { formatDuration } from '../../../shared/format';
import { playbackLeftMs } from '../../../shared/media';
import { playlistLeftMs, playlistTotals, type PlaylistPlayback } from '../../../shared/playlist-playback';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { useNow } from '../render/useNow';
import { plural } from '../ui/text';

/** The only clock here ticks once a second, in this small operator-only line. */
export function PlaylistTiming({
  playlistId,
  items,
  playback,
}: {
  playlistId: string;
  items: readonly PlaylistItemInfo[];
  playback?: PlaylistPlayback;
}) {
  const now = useNow(1000);
  const state = useEngine((s) => s.state);
  const totals = playlistTotals(items, playback);
  const cursor = state?.live.playlist;
  const item = cursor?.playlistId === playlistId ? items.find((i) => i.id === cursor.itemId) : null;
  const bg = state?.layers.background;
  const audio = state?.layers.audio;
  const layer =
    item?.kind !== 'media'
      ? null
      : item.media === 'video' && bg?.kind === 'media' && bg.mediaId === item.mediaId && !state?.layers.slide
        ? bg
        : item.media === 'audio' && audio?.mediaId === item.mediaId && !audio.music
          ? audio
          : null;
  const duration = layer?.durationMs ?? (item?.kind === 'media' ? item.durationMs : null);
  const left =
    layer &&
    duration != null &&
    !layer.loop &&
    !layer.seek?.paused &&
    !('pausedAtMs' in layer && layer.pausedAtMs !== undefined)
      ? playbackLeftMs(layer, duration, now)
      : null;
  const chain =
    item && left !== null
      ? playlistLeftMs(
          items,
          playback?.playOrder ?? [],
          item.id,
          left,
          playback?.repeatAll ?? false,
          playback?.crossfadeMs ?? 0,
        )
      : null;
  const endsAt = chain !== null && chain > 0 ? now + chain : null;
  return (
    <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-0.5 border-b border-line px-3 py-1 text-xs text-muted">
      <span data-testid="playlist-totals">
        {plural(totals.rows, 'row')} · videos and sounds {formatDuration(totals.durationMs)}
        {totals.unknown
          ? ` · ${String(totals.unknown)} length${totals.unknown === 1 ? '' : 's'} not known yet`
          : ''}
      </span>
      {endsAt !== null && (
        <span data-testid="playlist-ends-at" data-ends-at={Math.round(endsAt)}>
          Ends at {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(endsAt)}
        </span>
      )}
    </div>
  );
}
