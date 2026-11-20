import { useEffect, useRef } from 'react';
import { videoCueReady } from '../../../shared/video-cue';
import { addFileMenuItems, type FileTarget } from '../files/file-menu';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
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
      onSelect: () => dispatch({ type: 'cueVideo', mediaId, ...(playlist ? { playlist } : {}) }),
    },
  ];
}

/** One first-frame preview, copied from LIVE's already loaded element, never another decoder. */
function CuedFrame({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const video = document.querySelector<HTMLVideoElement>(`video[data-cue-id="${CSS.escape(id)}"]`);
      const canvas = ref.current;
      if (!canvas) return;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
        frame = requestAnimationFrame(draw);
        return;
      }
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [id]);
  return (
    <canvas
      ref={ref}
      width={128}
      height={72}
      aria-label="Cued first frame"
      className="h-10 w-18 shrink-0 rounded-sm bg-black object-contain"
    />
  );
}

export function VideoCueStrip() {
  useEffect(() => addFileMenuItems(cueMenu), []);
  const cue = useEngine((s) => s.state?.videoCue);
  const mode = useMode((s) => s.mode);
  if (!cue || mode !== 'pro') return null;
  const ready = videoCueReady(cue);
  return (
    <div
      data-testid="video-cue"
      className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel-2 p-2 text-xs"
    >
      <CuedFrame id={cue.id} />
      <div className="min-w-0 flex-1" role="status">
        <div className="font-semibold">
          {cue.automatic ? 'Next video · Crossfade' : 'Cued video'} · {cue.label}
        </div>
        <div className={cue.error ? 'text-warning-fg' : 'text-muted'}>
          {cue.error ?? (ready ? 'Cue ready' : 'Preparing first frame…')}
        </div>
      </div>
      <Button
        size="sm"
        variant="primary"
        aria-label="Go cued video"
        disabled={!ready}
        onClick={() => dispatch({ type: 'goVideoCue', cueId: cue.id })}
      >
        Go
      </Button>
      <Button size="sm" aria-label="Cancel video cue" onClick={() => dispatch({ type: 'cancelVideoCue' })}>
        Cancel
      </Button>
    </div>
  );
}
