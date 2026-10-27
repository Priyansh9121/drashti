import { useEngine } from '../../engine/engine-store';
import { LiveBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Play } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { useMirror } from './mirror-store';

/*
 * The audio playlists (Session 54, D5), as the operator window's Music panel lists them: each by name with how many
 * tracks it has, Play starting it from its first track, the one playing marked. Pause, Play and the next and
 * previous track are in Music, above. Making and changing them stay in Drashti.
 */

export function MusicList() {
  const list = useMirror((s) => s.music);
  const playing = useEngine((s) => s.state?.layers.audio?.music?.playlistId ?? null);
  if (!list || list.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Audio playlists" data-testid="remote-music-list">
      {list.map((p) => {
        const on = p.id === playing;
        return (
          <li
            key={p.id}
            data-testid="remote-music-playlist"
            data-playing={on ? 'true' : undefined}
            className={cx(
              'flex items-center gap-2 rounded-lg border bg-panel-2 py-1 pr-1 pl-3',
              on ? 'border-live' : 'border-line',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base text-fg">{p.name}</span>
              <span className="block text-base text-muted">
                {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
              </span>
            </span>
            {on && <LiveBadge label="Playing" />}
            <Button
              size="lg"
              className="min-h-12"
              icon={Play}
              aria-label={`Play ${p.name}`}
              disabled={p.trackCount === 0}
              onClick={() =>
                void tap(() =>
                  api<{ rev?: number }>('/api/v1/music/play', { method: 'POST', body: { playlistId: p.id } }),
                )
              }
            >
              Play
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
