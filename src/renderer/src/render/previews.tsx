import {
  createContext,
  type CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';

/*
 * Media on pages that load it over the network (a phone or tablet), where a
 * slow Wi-Fi must never be asked for a video: every picture and video in a
 * slide, a background or the logo shows as a picture fetched when it is on
 * the screen, and nothing plays. Since Session 54 (D1) each is fetched at the
 * width it is drawn on the device's screen (its device pixels), up to the
 * original, and again, sharper, when it is drawn bigger (a phone turned, a
 * picture zoomed on the phone); before that every one was a 320-pixel preview
 * (src/main/network/previews.ts). Drashti's own windows have no loader here
 * and draw media as they always do.
 */

export interface PreviewLoader {
  /**
   * The picture's URL (a blob), at least `width` device pixels wide where the picture is that wide (else the whole
   * picture), or null when there is none; loads it first if need be. Without a width: the smallest.
   */
  load(mediaId: string, width?: number): Promise<string | null>;
  /** The sharpest loaded so far: its URL (or null when there is none); undefined when not tried yet. */
  cached(mediaId: string): string | null | undefined;
  /** Told when a sharper one has come, wherever it was asked for; returns how to stop being told. */
  subscribe(mediaId: string, then: () => void): () => void;
  /** Held while a place draws it, so it is never let go under it; returns the letting go. */
  hold(mediaId: string): () => void;
  /** How wide a picture drawn really is: narrower than asked, it is the whole picture, and no wider is asked for. */
  measured(mediaId: string, url: string, naturalWidth: number): void;
}

export const PreviewsContext = createContext<PreviewLoader | null>(null);

/**
 * Changes when the pictures inside may be drawn at another size although their own boxes are not (Session 54,
 * D1): a phone's viewer zoomed, its zoom settled. Each picture then asks again for the width it is drawn at.
 */
export const PictureScaleContext = createContext(0);

/** True on pages where media shows as previews only. */
export const usePreviewsOnly = (): boolean => useContext(PreviewsContext) !== null;

/**
 * How many device pixels wide a picture is drawn in this box: the box's width on the screen (its transforms and
 * zoom included), or, filling a box of another shape, the picture's own width at that height.
 */
export function drawnWidth(
  box: { width: number; height: number },
  fit: CSSProperties['objectFit'],
  natural: { width: number; height: number } | null,
  pixelRatio: number,
): number {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const wide = natural && natural.width > 0 && natural.height > 0 ? natural.width / natural.height : null;
  const across = fit === 'cover' && wide !== null ? Math.max(box.width, box.height * wide) : box.width;
  return Math.ceil(across * ratio);
}

/**
 * A media item's picture filling its box: grey until it is on the screen and has loaded, then at the width it is
 * drawn on this screen, sharper as it is drawn bigger.
 */
export function PreviewPicture({
  mediaId,
  style,
  onSize,
}: {
  mediaId: string;
  style: CSSProperties;
  /** Told the picture's own size once it has loaded (a phone's viewer takes its shape, Session 54). */
  onSize?: (natural: { width: number; height: number }) => void;
}) {
  const loader = useContext(PreviewsContext);
  const scale = useContext(PictureScaleContext);
  // The sharpest there is, whichever place asked for it: every place drawing the picture is told when it comes.
  const subscribe = useCallback(
    (then: () => void) => loader?.subscribe(mediaId, then) ?? (() => undefined),
    [loader, mediaId],
  );
  const src = useSyncExternalStore(subscribe, () => loader?.cached(mediaId) ?? null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);
  // Not fetched until it is on the screen (a thumbnail far down a list waits until it is scrolled to).
  useEffect(() => {
    if (seen || !el) return;
    const watch = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      watch.disconnect();
      setSeen(true);
    });
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, [el, seen]);
  // Held while drawn here, so it is never let go under it.
  useEffect(() => loader?.hold(mediaId), [loader, mediaId]);
  // Asked for at the width it is drawn at now, and again whenever that may have changed.
  useEffect(() => {
    if (!seen || !loader || !el) return;
    const ask = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const natural =
        el instanceof HTMLImageElement && el.naturalWidth > 0
          ? { width: el.naturalWidth, height: el.naturalHeight }
          : null;
      void loader.load(mediaId, drawnWidth(r, style.objectFit, natural, window.devicePixelRatio));
    };
    ask();
    const sized = new ResizeObserver(ask);
    sized.observe(el);
    // A phone turned redraws everything at another scale, although each box keeps its own size.
    window.addEventListener('resize', ask);
    return () => {
      sized.disconnect();
      window.removeEventListener('resize', ask);
    };
  }, [seen, loader, el, mediaId, style.objectFit, scale]);
  if (src)
    return (
      <img
        ref={setEl}
        src={src}
        alt=""
        draggable={false}
        data-media-id={mediaId}
        data-preview="shown"
        onLoad={(e) => {
          const { naturalWidth, naturalHeight } = e.currentTarget;
          loader?.measured(mediaId, src, naturalWidth);
          if (naturalWidth > 0 && naturalHeight > 0) onSize?.({ width: naturalWidth, height: naturalHeight });
        }}
        style={style}
      />
    );
  return (
    <div
      ref={setEl}
      data-media-id={mediaId}
      data-preview="waiting"
      style={{ ...style, background: '#1f2937' }}
    />
  );
}
