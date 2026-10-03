import { createContext, type CSSProperties, useContext, useEffect, useRef, useState } from 'react';

/*
 * Media on pages that load it over the network (a phone or tablet), where a
 * slow Wi-Fi must never be asked for a whole picture or a video: every
 * picture and video in a slide, a background or the logo shows as a small
 * preview (src/main/network/previews.ts), loaded only once it is on the
 * screen, and nothing plays. Drashti's own windows have no loader here and
 * draw media as they always do.
 */

export interface PreviewLoader {
  /** The preview's URL (a blob), or null when there is none; loads it first if need be. */
  load(mediaId: string): Promise<string | null>;
  /** Already loaded: its URL (or null when there is none); undefined when not tried yet. */
  cached(mediaId: string): string | null | undefined;
}

export const PreviewsContext = createContext<PreviewLoader | null>(null);

/** True on pages where media shows as previews only. */
export const usePreviewsOnly = (): boolean => useContext(PreviewsContext) !== null;

/** A media item's preview filling its box: grey until it is on the screen and has loaded. */
export function PreviewPicture({ mediaId, style }: { mediaId: string; style: CSSProperties }) {
  const loader = useContext(PreviewsContext);
  const [src, setSrc] = useState<string | null>(() => loader?.cached(mediaId) ?? null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (src || !loader || !el) return;
    let live = true;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      void loader.load(mediaId).then((url) => {
        if (live && url) setSrc(url);
      });
    });
    seen.observe(el);
    return () => {
      live = false;
      seen.disconnect();
    };
  }, [mediaId, src, loader]);
  if (src)
    return (
      <img src={src} alt="" draggable={false} data-media-id={mediaId} data-preview="shown" style={style} />
    );
  return (
    <div
      ref={box}
      data-media-id={mediaId}
      data-preview="waiting"
      style={{ ...style, background: '#1f2937' }}
    />
  );
}
