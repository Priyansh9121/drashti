import { useEngine } from '../../engine/engine-store';
import { Badge, LiveBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Pause, Play } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { useMirror } from './mirror-store';
import { musicRowAction } from './music-row';

/*
 * The audio playlists (Session 54, D5), as the operator window's Music panel lists them: each by name with how many
 * tracks it has, the one playing marked. Play starts one from its first track; on the one playing, Pause, and while
 * it is paused, Play goes on where it was (music-row.ts, D5 review), as the window's Play and Pause do. Pause, Play
 * and the next and previous track are in Music, above, too. Making and changing them stay in Drashti.
 */

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

export function MusicList() {
  const list = useMirror((s) => s.music);
  const audio = useEngine((s) => s.state?.layers.audio ?? null);
  if (!list || list.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Audio playlists" data-testid="remote-music-list">
      {list.map((p) => {
        const action = musicRowAction(p.id, audio);
        const on = action !== 'play';
        return (
          <li
            key={p.id}
            data-testid="remote-music-playlist"
            data-playing={on ? 'true' : undefined}
            data-paused={action === 'resume' ? 'true' : undefined}
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
            {action === 'pause' && <LiveBadge label="Playing" />}
            {action === 'resume' && <Badge>Paused</Badge>}
            {action === 'pause' ? (
              <Button
                size="lg"
                className="min-h-12"
                icon={Pause}
                aria-label={`Pause ${p.name}`}
                onClick={() => void tap(post('/api/v1/music/pause'))}
              >
                Pause
              </Button>
            ) : (
              <Button
                size="lg"
                className="min-h-12"
                icon={Play}
                aria-label={`Play ${p.name}`}
                disabled={p.trackCount === 0}
                // Paused, on where it was (no playlist named); any other, from its first track.
                onClick={() =>
                  void tap(post('/api/v1/music/play', action === 'resume' ? undefined : { playlistId: p.id }))
                }
              >
                Play
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
