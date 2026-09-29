import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreloadMedia } from '../../../shared/engine/preload';
import { mediaToPreload } from '../../../shared/engine/preload';
import type { UpNext } from '../../../shared/engine/state';
import { mediaUrl } from '../../../shared/media';

type LoadState = 'loading' | 'ready' | 'failed';

/** An image fetched and decoded out of sight, so the slide that shows it paints it at once. */
function PreloadImage({ mediaId }: { mediaId: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<LoadState>('loading');
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    let current = true;
    img.decode().then(
      () => {
        if (current) setState('ready');
      },
      () => {
        if (current) setState('failed');
      },
    );
    return () => {
      current = false;
    };
  }, [mediaId]);
  return <img ref={ref} src={mediaUrl(mediaId)} alt="" data-preload={mediaId} data-state={state} />;
}

/** A video loaded up to its first frame out of sight (muted, never played). */
function PreloadVideo({ mediaId }: { mediaId: string }) {
  const [state, setState] = useState<LoadState>('loading');
  return (
    <video
      src={mediaUrl(mediaId)}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      data-preload={mediaId}
      data-state={state}
      onLoadedData={() => {
        setState('ready');
      }}
      onError={() => {
        setState('failed');
      }}
    />
  );
}

/** Loads what Next will show (PLAN.md 4.3), so its images and videos are never a frame late. */
export function Preloader({ next }: { next: UpNext | null }) {
  const wanted: PreloadMedia[] = useMemo(() => mediaToPreload(next), [next]);
  return (
    <div
      data-testid="preload"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      {wanted.map((m) =>
        m.media === 'image' ? (
          <PreloadImage key={`image:${m.mediaId}`} mediaId={m.mediaId} />
        ) : (
          <PreloadVideo key={`video:${m.mediaId}`} mediaId={m.mediaId} />
        ),
      )}
    </div>
  );
}
