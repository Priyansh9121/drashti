import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PreloadMedia } from '../../../shared/engine/preload';
import { mediaToPreload } from '../../../shared/engine/preload';
import type { UpNext } from '../../../shared/engine/state';
import { mediaUrl, displayMediaId, displayUrl } from '../../../shared/media';
import type { PictureLook } from '../../../shared/picture-look';
import { deckClip, pointedBeside, usePointedClip } from '../render/clips-ahead';
import { DeckClipAhead } from '../render/DeckStep';
import { useMediaAttempt } from '../render/media-attempts';
import { useSharpCopy } from '../render/picture-looks';
import { decodeSlideImage } from '../render/slide-image-decoding';
import {
  initialPictureReadyToHandOver,
  keepInitialPicturePriority,
  prepareInitialPicture,
  settleInitialPicture,
  startInitialPicturePriority,
  type CurrentPictureSelection,
} from './initial-picture-preload';

type LoadState = 'loading' | 'ready' | 'failed';
type PictureSettled = (mediaId: string, outcome: 'ready' | 'failed') => void;
type PictureStarting = (mediaId: string) => void;

/** An image fetched and decoded out of sight, so the slide that shows it paints it at once. */
function PreloadImage({
  mediaId,
  attempt,
  source,
  first = false,
  onStarting,
  onSettled,
}: {
  mediaId: string;
  attempt: number;
  source?: string;
  first?: boolean;
  onStarting?: PictureStarting;
  onSettled?: PictureSettled;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<LoadState>('loading');
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    let current = true;
    onStarting?.(mediaId);
    const settled = (outcome: 'ready' | 'failed') => {
      if (!current) return;
      setState(outcome);
      onSettled?.(mediaId, outcome);
    };
    decodeSlideImage(img).then(
      () => settled('ready'),
      () => settled('failed'),
    );
    return () => {
      current = false;
    };
  }, [mediaId, attempt, source, onStarting, onSettled]);
  return (
    <img
      ref={ref}
      src={source ?? mediaUrl(mediaId, attempt)}
      alt=""
      data-preload={first ? undefined : mediaId}
      data-current-preload={first ? mediaId : undefined}
      data-state={state}
    />
  );
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

/** The shared copy loader has already completed its native decode. */
function DecodedPreload({ mediaId, onSettled }: { mediaId: string; onSettled: PictureSettled }) {
  useEffect(() => {
    onSettled(mediaId, 'ready');
  }, [mediaId, onSettled]);
  return null;
}

/**
 * A picture's sharpened copy (Session 26f) loaded ahead, held until the slide shows it; the picture itself
 * is loaded ahead until the copy is in, in case it never comes.
 */
function PreloadPicture({
  mediaId,
  look,
  first = false,
  onStarting,
  onSettled,
}: {
  mediaId: string;
  look: PictureLook | null;
  first?: boolean;
  onStarting?: PictureStarting;
  onSettled?: PictureSettled;
}) {
  const descriptor = look?.display;
  const sourceId = descriptor ? displayMediaId(mediaId, descriptor.key) : mediaId;
  const attempt = useMediaAttempt(sourceId);
  const source = descriptor ? displayUrl(mediaId, descriptor.key, attempt) : mediaUrl(mediaId, attempt);
  const copy = useSharpCopy(mediaId, look);
  return copy ? (
    <span
      data-preload={first ? undefined : mediaId}
      data-current-preload={first ? mediaId : undefined}
      data-state="ready"
      data-sharpened={copy.id}
    >
      {onSettled && <DecodedPreload mediaId={mediaId} onSettled={onSettled} />}
    </span>
  ) : (
    <PreloadImage
      key={source}
      mediaId={mediaId}
      attempt={attempt}
      source={source}
      first={first}
      onStarting={onStarting}
      onSettled={onSettled}
    />
  );
}

/** One file to load ahead; a node's copy that lands late is loaded again (a new element, a new URL). */
function PreloadOne({ media, look }: { media: PreloadMedia; look: PictureLook | null }) {
  const attempt = useMediaAttempt(media.mediaId);
  return media.media === 'image' ? (
    <PreloadPicture mediaId={media.mediaId} look={look} />
  ) : (
    <PreloadVideo key={attempt} mediaId={media.mediaId} attempt={attempt} />
  );
}

const PRELOAD_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
} as const;

/** This bounded fetch ordering uses elapsed time; the scene keeps its existing display deadline and clock. */
const preloadNow = (): number => {
  // eslint-disable-next-line no-restricted-properties -- startup fetch ordering only, never a drawing clock
  return performance.now();
};

/**
 * Loads what Next will show (PLAN.md 4.3), and the first clip of the pointed deck slide (C3).
 * On a page's first show, its current pictures decode first; their consumers stay until the scene can take over.
 */
export function Preloader({
  next,
  pictures = {},
  currentPictures,
  sceneReady = true,
}: {
  next: UpNext | null;
  pictures?: Record<string, PictureLook>;
  /** Read only while preparing the first picture; later presses never restart this priority. */
  currentPictures?: () => CurrentPictureSelection | null;
  sceneReady?: boolean;
}) {
  const [priority, setPriority] = useState(() =>
    startInitialPicturePriority(currentPictures?.() ?? null, preloadNow()),
  );
  // The snapshot holds only image addresses and a small identity; an obsolete show releases Next at this render.
  const initial = priority
    ? keepInitialPicturePriority(priority, currentPictures?.()?.key ?? null, preloadNow())
    : null;
  if (initial !== priority) setPriority(initial);
  const until = initial?.until ?? null;
  const onStarting = useCallback<PictureStarting>((mediaId) => {
    setPriority((pending) => prepareInitialPicture(pending, mediaId));
  }, []);
  const onSettled = useCallback<PictureSettled>((mediaId, outcome) => {
    setPriority((pending) => settleInitialPicture(pending, mediaId, outcome));
  }, []);
  useEffect(() => {
    if (until === null) return;
    // eslint-disable-next-line no-restricted-syntax -- releases startup preload ordering; it never holds a scene
    const timer = setTimeout(
      () => {
        setPriority(null);
      },
      Math.max(0, until - preloadNow()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [until]);
  useEffect(() => {
    if (!initialPictureReadyToHandOver(initial, sceneReady)) return;
    let afterPaint = 0;
    const beforePaint = requestAnimationFrame(() => {
      afterPaint = requestAnimationFrame(() => {
        setPriority(null);
      });
    });
    return () => {
      cancelAnimationFrame(beforePaint);
      cancelAnimationFrame(afterPaint);
    };
  }, [initial, sceneReady]);
  const wanted: PreloadMedia[] = useMemo(() => mediaToPreload(next), [next]);
  const clip = useMemo(() => deckClip(next), [next]);
  const pointed = pointedBeside(usePointedClip(), clip);
  return (
    <>
      {initial && (
        <div data-testid="current-preload" aria-hidden="true" style={PRELOAD_STYLE}>
          {initial.current.media.map((m) => (
            <PreloadPicture
              key={m.mediaId}
              mediaId={m.mediaId}
              look={pictures[m.mediaId] ?? null}
              first
              onStarting={onStarting}
              onSettled={onSettled}
            />
          ))}
        </div>
      )}
      <div data-testid="preload" aria-hidden="true" style={PRELOAD_STYLE}>
        {!initial &&
          wanted.map((m) => {
            if (m.media === 'video' && m.mediaId === clip?.mediaId)
              return clip.first ? <DeckClipAhead key={`deck:${m.mediaId}`} mediaId={m.mediaId} /> : null;
            return (
              <PreloadOne key={`${m.media}:${m.mediaId}`} media={m} look={pictures[m.mediaId] ?? null} />
            );
          })}
        {!initial && pointed && (
          <DeckClipAhead
            key={`pointed:${pointed.mediaId}@${String(pointed.fromMs)}`}
            mediaId={pointed.mediaId}
            fromMs={pointed.fromMs}
            role="pointed"
          />
        )}
      </div>
    </>
  );
}
