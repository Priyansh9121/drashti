import { useEffect } from 'react';
import { YOUTUBE_STATE_WORDS, type YouTubeLink } from '../../../shared/youtube';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useStream } from './stream-store';
import { connectYouTube, useYouTube, youtubeAction } from './youtube-store';
import { linkWords } from './youtube-words';

/*
 * The Stream panel's YouTube lines (x31): which broadcast the profile in use streams to, what YouTube last said of
 * it, and, when ending it there could not be done, End it on YouTube. Going live never waits for any of it.
 */

/** The profile in use's broadcast, or none. */
export function useActiveLink(): YouTubeLink | undefined {
  const activeId = useStream((s) => s.profiles?.activeId ?? null);
  return useYouTube((s) => (activeId === null ? undefined : s.status?.links[activeId]));
}

/** Go live…'s question names the broadcast. */
export function YouTubeGoLiveLine() {
  const link = useActiveLink();
  return link ? <p data-testid="youtube-go-live-line">To the YouTube broadcast {linkWords(link)}.</p> : null;
}

/** End the stream…'s question says it ends there too. */
export function YouTubeEndLine() {
  const link = useActiveLink();
  return link ? <p data-testid="youtube-end-line">This also ends “{link.title}” on YouTube.</p> : null;
}

export function YouTubeOnAir({ on }: { on: boolean }) {
  useEffect(() => {
    connectYouTube();
  }, []);
  const activeId = useStream((s) => s.profiles?.activeId ?? null);
  const link = useActiveLink();
  const state = useYouTube((s) => s.status?.linkedState ?? null);
  const message = useYouTube((s) => s.status?.message ?? null);
  const busy = useYouTube((s) => s.busy);
  if (!link || activeId === null) return null;
  return (
    <div className="space-y-1" data-testid="youtube-on-air">
      <p className="text-sm text-muted" data-testid="youtube-panel-link">
        To YouTube: {linkWords(link)}
      </p>
      {state && (
        <p className="text-sm" data-testid="youtube-state" aria-live="polite">
          {YOUTUBE_STATE_WORDS[state]}
        </p>
      )}
      {!on && state === 'live' && (
        <Notice
          tone="warning"
          actions={
            <Button
              size="sm"
              disabled={busy}
              data-testid="youtube-end-there"
              onClick={() => void youtubeAction(() => window.drashti.youtube.endBroadcast(activeId))}
            >
              End it on YouTube
            </Button>
          }
        >
          {message ?? `YouTube may still show “${link.title}” as live.`}
        </Notice>
      )}
    </div>
  );
}
