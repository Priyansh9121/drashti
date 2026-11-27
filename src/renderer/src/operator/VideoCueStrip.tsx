import { useEffect, useRef } from 'react';
import { videoCueReady } from '../../../shared/video-cue';
import { addFileMenuItems, type FileTarget } from '../files/file-menu';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { dispatch } from './actions';
import { useMode } from './mode-store';

function cueMenu(target: FileTarget) {
  if (target.kind !== 'video' || !target.mediaId) return [];
  const mediaId = target.mediaId;
  const playlist =
    target.playlistId && target.itemId ? { playlistId: target.playlistId, itemId: target.itemId } : undefined;
  return [
    {
      label: 'Cue',
      onSelect: () => void dispatch({ type: 'cueVideo', mediaId, ...(playlist ? { playlist } : {}) }),
    },
  ];
}

/** One first-frame preview, copied from LIVE's already loaded element, never another decoder. */
function CuedFrame({ id, ready, small }: { id: string; ready: boolean; small: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const draw = () => {
      const video = document.querySelector<HTMLVideoElement>(`video[data-cue-id="${CSS.escape(id)}"]`);
      const canvas = ref.current;
      if (!canvas) return;
      if (
        !video ||
        video.seeking ||
        video.dataset['state'] !== 'ready' ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0
      ) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale,
        height = video.videoHeight * scale;
      canvas
        .getContext('2d')
        ?.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [id, ready]);
  return (
    <canvas
      ref={ref}
      width={128}
      height={72}
      aria-label="Cued first frame"
      className={cx(
        'h-10 w-18 shrink-0 rounded-sm bg-black object-contain',
        small && '@max-[28rem]/cue:h-7 @max-[28rem]/cue:w-12',
      )}
    />
  );
}

export function VideoCueStrip() {
  useEffect(() => addFileMenuItems(cueMenu), []);
  const cue = useEngine((s) => s.state?.videoCue);
  const mode = useMode((s) => s.mode);
  if (!cue || mode !== 'pro') return null;
  const ready = videoCueReady(cue);
  const said = `${cue.automatic ? 'Next video · Crossfade' : 'Cued video'} · ${cue.label}`;
  // One row in a narrow column (alpha.24, lead 2's liverows; a25 list item 46, CI's 1024 × 645): under 28 rem the first
  // frame is drawn smaller and the words go on one line (the name cut short, its state whole), so the card is some
  // 16 px shorter and its Go higher, nearer Next. An error keeps its own line.
  const row = !cue.error;
  return (
    <div className="@container/cue">
      <div
        data-testid="video-cue"
        className={cx(
          'flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel-2 p-2 text-xs',
          row && '@max-[28rem]/cue:flex-nowrap @max-[28rem]/cue:p-1.5',
        )}
      >
        <CuedFrame id={cue.id} ready={ready} small={row} />
        <div
          className={cx(
            'min-w-0 flex-1',
            row && '@max-[28rem]/cue:flex @max-[28rem]/cue:items-baseline @max-[28rem]/cue:gap-1.5',
          )}
          role="status"
        >
          <div
            className={cx('font-semibold', row && '@max-[28rem]/cue:min-w-0 @max-[28rem]/cue:truncate')}
            title={said}
          >
            {said}
          </div>
          <div
            className={cx(cue.error ? 'text-warning-fg' : 'text-muted', row && '@max-[28rem]/cue:shrink-0')}
          >
            {cue.error ?? (ready ? 'Cue ready' : 'Preparing first frame…')}
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          aria-label="Go cued video"
          // A show control (alpha.24, the bug hunt's S3-1): it changes the screens at once and never moves.
          instant
          disabled={!ready}
          onClick={() => void dispatch({ type: 'goVideoCue', cueId: cue.id })}
        >
          Go
        </Button>
        <Button
          size="sm"
          aria-label="Cancel video cue"
          instant
          onClick={() => void dispatch({ type: 'cancelVideoCue' })}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
