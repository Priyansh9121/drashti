import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreloadMedia } from '../../../shared/engine/preload';
import { mediaToPreload } from '../../../shared/engine/preload';
import type { UpNext } from '../../../shared/engine/state';
import { mediaUrl } from '../../../shared/media';
import { useMediaAttempt } from '../render/media-attempts';

type LoadState = 'loading' | 'ready' | 'failed';

/** An image fetched and decoded out of sight, so the slide that shows it paints it at once. */
function PreloadImage({ mediaId, attempt }: { mediaId: string; attempt: number }) {
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
  }, [mediaId, attempt]);
  return <img ref={ref} src={mediaUrl(mediaId, attempt)} alt="" data-preload={mediaId} data-state={state} />;
}

/** A video loaded up to its first frame out of sight (muted, never played). */
function PreloadVideo({ mediaId, attempt }: { mediaId: string; attempt: number }) {
  const [state, setState] = useState<LoadState>('loading');
  return (
    <video
      src={mediaUrl(mediaId, attempt)}
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

/** One file to load ahead; a node's copy that lands late is loaded again (a new element, a new URL). */
function PreloadOne({ media }: { media: PreloadMedia }) {
  const attempt = useMediaAttempt(media.mediaId);
  return media.media === 'image' ? (
    <PreloadImage key={attempt} mediaId={media.mediaId} attempt={attempt} />
  ) : (
    <PreloadVideo key={attempt} mediaId={media.mediaId} attempt={attempt} />
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
      {wanted.map((m) => (
        <PreloadOne key={`${m.media}:${m.mediaId}`} media={m} />
      ))}
    </div>
  );
}
