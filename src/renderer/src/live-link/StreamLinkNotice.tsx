import { formatClock, formatDuration } from '../../../shared/format';
import { STREAM_LINK_WALLPAPER_MS } from '../../../shared/live-link';
import { dispatch } from '../operator/actions';
import { useNow } from '../render/useNow';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useStreamLinkUi } from './live-link-store';

/*
 * How the stream link stands (alpha.20, the playback set's slice 8; the owner's Q60-39 P3 A), in the window's flow under
 * the header, as Show a Window…'s notice is: connecting (Stop); up (Drashti's own stream shows the Wallpaper meanwhile;
 * Take it off); reconnecting, with how long since its pictures stopped (the screens keep its last picture; the
 * Wallpaper after 20 seconds); gone, with the Wallpaper up since when (it comes back by itself, unless something else
 * goes up; Stop trying); ended, or not put back, with why (Close).
 */

export function StreamLinkNotice() {
  const status = useStreamLinkUi((s) => s.status);
  const now = useNow(1000);
  if (status.state === 'off' || status.name === null) return null;
  const name = status.name;
  const since = status.since ?? now;
  const takeOff = (
    <Button
      variant="primary"
      size="sm"
      // A show control (alpha.24, the bug hunt's S3-1): it changes the screens at once and never moves.
      instant
      data-testid="stream-link-off"
      onClick={() => void dispatch({ type: 'clearLayer', layer: 'background' })}
    >
      Take it off
    </Button>
  );
  const stopTrying = (
    <Button
      size="sm"
      data-testid="stream-link-stop-trying"
      onClick={() => void window.drashti.liveLink.stop()}
    >
      {status.state === 'ended' ? 'Close' : status.state === 'connecting' ? 'Stop' : 'Stop trying'}
    </Button>
  );
  const body =
    status.state === 'connecting'
      ? {
          tone: 'info' as const,
          title: `Connecting to the stream link from “${name}”…`,
          text: 'It goes up on the screens as soon as its pictures come.',
          actions: stopTrying,
        }
      : status.state === 'playing'
        ? {
            tone: 'info' as const,
            title: `The stream link from “${name}” is on the screens`,
            text: 'Its sound plays in the hall. Drashti’s own stream shows the Wallpaper while it is up, with none of its sound.',
            actions: takeOff,
          }
        : status.state === 'reconnecting'
          ? {
              tone: 'warning' as const,
              title: `The stream link from “${name}” stopped ${formatDuration(Math.max(0, now - since))} ago: reconnecting…`,
              text: `The screens keep its last picture while Drashti connects again by itself. The Wallpaper goes up after ${String(STREAM_LINK_WALLPAPER_MS / 1000)} seconds.${status.note ? ` ${status.note}` : ''}`,
              actions: takeOff,
            }
          : status.state === 'wallpaper'
            ? {
                tone: 'warning' as const,
                title: `The stream link from “${name}” is gone: the Wallpaper has been up since ${formatClock(since, null)}`,
                text: `Drashti is still connecting again. It comes back on the screens by itself when the link does, unless something else goes up meanwhile.${status.note ? ` ${status.note}` : ''}`,
                actions: stopTrying,
              }
            : {
                tone: 'info' as const,
                title: `The stream link from “${name}” has stopped`,
                text: status.note ?? 'It is no longer on the screens.',
                actions: stopTrying,
              };
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="stream-link-notice" data-state={status.state}>
      <Notice tone={body.tone} title={body.title} actions={body.actions}>
        {body.text}
      </Notice>
    </div>
  );
}
