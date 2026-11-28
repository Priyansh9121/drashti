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
function CuedFrame({ id, ready }: { id: string; ready: boolean }) {
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
      className="col-start-1 row-span-2 row-start-1 h-10 w-18 shrink-0 rounded-sm bg-black object-contain @max-[28rem]/cue:row-span-1 @max-[28rem]/cue:row-start-1 @max-[28rem]/cue:h-7 @max-[28rem]/cue:w-12"
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
  // At ordinary narrow widths the name and state share a row. At LIVE's minimum the state has its own full-width
  // row, with room for the first-frame error too. The buttons keep the same columns and top edge in every state.
  const row = !cue.error;
  return (
    <div className="@container/cue">
      <div
        data-testid="video-cue"
        className={cx(
          'grid grid-cols-[4.5rem_minmax(0,1fr)_auto_auto] grid-rows-[auto_auto] items-start gap-x-2 rounded-md border border-line bg-panel-2 p-2 text-xs',
          '@max-[28rem]/cue:grid-cols-[3rem_minmax(0,1fr)_auto_auto_auto] @max-[28rem]/cue:p-1',
          '@max-[22rem]/cue:grid-rows-[1.75rem_minmax(2rem,auto)] @max-[22rem]/cue:gap-y-1',
          cue.error && '@max-[28rem]/cue:gap-y-1',
        )}
      >
        <CuedFrame id={cue.id} ready={ready} />
        <div
          className={cx(
            'col-start-2 row-start-1 min-w-0 truncate font-semibold @max-[28rem]/cue:col-start-2 @max-[28rem]/cue:self-center @max-[22rem]/cue:col-span-2 @max-[22rem]/cue:col-start-2',
            cue.error && '@max-[28rem]/cue:col-span-2',
          )}
          title={said}
        >
          {said}
        </div>
        <div
          className={cx(
            'col-start-2 row-start-2 min-w-0',
            row
              ? '@max-[28rem]/cue:col-start-3 @max-[28rem]/cue:row-start-1 @max-[28rem]/cue:self-center @max-[28rem]/cue:whitespace-nowrap'
              : '@max-[28rem]/cue:col-span-full @max-[28rem]/cue:col-start-1 @max-[28rem]/cue:row-start-2',
            '@max-[22rem]/cue:col-span-full @max-[22rem]/cue:col-start-1 @max-[22rem]/cue:row-start-2 @max-[22rem]/cue:self-start @max-[22rem]/cue:whitespace-normal',
          )}
          role="status"
        >
          <div className={cue.error ? 'text-warning-fg' : 'text-muted'}>
            {cue.error ?? (ready ? 'Cue ready' : 'Preparing first frame…')}
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          aria-label="Go cued video"
          className="col-start-3 row-span-2 row-start-1 @max-[28rem]/cue:col-start-4 @max-[28rem]/cue:row-span-1 @max-[28rem]/cue:row-start-1"
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
          className="col-start-4 row-span-2 row-start-1 @max-[28rem]/cue:col-start-5 @max-[28rem]/cue:row-span-1 @max-[28rem]/cue:row-start-1"
          instant
          onClick={() => void dispatch({ type: 'cancelVideoCue' })}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
