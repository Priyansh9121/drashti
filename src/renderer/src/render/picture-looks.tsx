import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { create } from 'zustand';
import { copyMediaId, sharpenedUrl } from '../../../shared/media';
import type { LiveZoom, PictureLook } from '../../../shared/picture-look';
import {
  copyStep,
  cssFilter,
  liveZoomAt,
  sharpenKernel,
  sharpenStep,
  ZOOM_GLIDE_MS,
} from '../../../shared/picture-look';
import { engineNow } from './clock';
import { useMediaAttempt } from './media-attempts';
import { PreviewsContext } from './previews';

/*
 * A picture drawn with its look (Session 26e, shared/picture-look.ts): zoomed
 * and moved within its box, its brightness, contrast and colour by the
 * screens' own CSS filters, and on the screens the live zoom of its showing,
 * gliding there by the engine's clock so every screen is at the same point.
 * A picture with neither is drawn exactly as before.
 *
 * Its sharpness (Session 26f) is a sharpened copy of the picture, made once
 * by the main process (src/main/media/sharpened.ts): drawn in its place once
 * the copy is ready and loaded in this page, the picture itself, unsharpened,
 * until then, so it is never blank or late. No screen draws a filter for it;
 * only the Picture editor's own preview does (lookFilter).
 *
 * On the screens (a Scene) the looks come with the engine's state, so every
 * screen, node, phone and the stream draw them alike; in the operator
 * window's thumbnails they come from the library.
 */

/** What a Scene's state says of its pictures: their looks, and the live zoom. */
export const ScreenPictures = createContext<{
  pictures: Record<string, PictureLook>;
  liveZoom: LiveZoom | null;
} | null>(null);

/** The library's looks, for the operator window's thumbnails (connectPictureLooks fills it). */
export const useLibraryLooks = create<{ looks: Record<string, PictureLook> }>(() => ({ looks: {} }));

let connected = false;

export function connectPictureLooks(): void {
  if (connected) return;
  connected = true;
  window.drashti.media.onLooks((looks) => {
    useLibraryLooks.setState({ looks });
  });
  void window.drashti.media.looks().then((looks) => {
    useLibraryLooks.setState({ looks });
  });
}

/** A picture's look: on the screens the state's, elsewhere the library's. */
export function usePictureLook(mediaId: string): PictureLook | null {
  const screen = useContext(ScreenPictures);
  const library = useLibraryLooks((s) => s.looks[mediaId] ?? null);
  return screen ? (screen.pictures[mediaId] ?? null) : library;
}

/**
 * Sharpened copies loaded in this page, by URL (Session 26f): held while anything draws them, and a few
 * seconds after (a picture going from up next to on the screens lets go and takes hold again at once).
 */
const COPY_GRACE_MS = 5000;
const loadedCopies = create<Record<string, true>>(() => ({}));
const heldCopies = new Map<
  string,
  { img: HTMLImageElement; users: number; drop: ReturnType<typeof setTimeout> | null }
>();

function holdCopy(url: string): () => void {
  let held = heldCopies.get(url);
  if (!held) {
    const img = new Image();
    const entry = { img, users: 0, drop: null as ReturnType<typeof setTimeout> | null };
    held = entry;
    heldCopies.set(url, entry);
    img.src = url;
    img.decode().then(
      () => {
        if (heldCopies.get(url) === entry) loadedCopies.setState({ [url]: true });
      },
      () => {
        // Not there (a node still copying it, say): the picture stays as it is; a later try is a new URL.
      },
    );
  }
  const entry = held;
  entry.users++;
  if (entry.drop) clearTimeout(entry.drop);
  entry.drop = null;
  return () => {
    entry.users--;
    if (entry.users > 0) return;
    // eslint-disable-next-line no-restricted-syntax -- lets go of a copy no screen has drawn for a few seconds: memory, never a frame
    entry.drop = setTimeout(() => {
      if (heldCopies.get(url) !== entry || entry.users > 0) return;
      heldCopies.delete(url);
      loadedCopies.setState((s) => {
        const { [url]: _gone, ...rest } = s;
        return rest;
      }, true);
    }, COPY_GRACE_MS);
  };
}

/** A copy's URL once it is loaded in this page (null until then). */
function useLoadedCopy(url: string | null): string | null {
  const loaded = loadedCopies((s) => (url ? s[url] === true : false));
  useEffect(() => (url ? holdCopy(url) : undefined), [url]);
  return url && loaded ? url : null;
}

/** On a phone: whether a copy's small preview has loaded (its id), so it is drawn only then. */
function usePreviewLoaded(id: string | null): boolean {
  const loader = useContext(PreviewsContext);
  const [loadedId, setLoadedId] = useState<string | null>(() => (id && loader?.cached(id) ? id : null));
  useEffect(() => {
    if (!id || !loader) return;
    let live = true;
    void loader.load(id).then((url) => {
      if (live && url) setLoadedId(id);
    });
    return () => {
      live = false;
    };
  }, [id, loader]);
  return id !== null && loadedId === id;
}

/** A picture's sharpened copy to draw in its place: its URL (its id on a phone), or null for the picture. */
export interface SharpCopy {
  url: string;
  id: string;
}

/** The sharpened copy of a picture with this look, once it is ready and loaded here (Session 26f). */
export function useSharpCopy(mediaId: string, look: PictureLook | null): SharpCopy | null {
  const step = copyStep(look);
  const id = step > 0 ? copyMediaId(mediaId, step) : null;
  const previews = useContext(PreviewsContext) !== null;
  // On a node, a copy that landed after it was first asked for: asked again (a new URL).
  const attempt = useMediaAttempt(id ?? '');
  const url = id && !previews ? sharpenedUrl(mediaId, step, attempt) : null;
  const loaded = useLoadedCopy(url);
  const previewLoaded = usePreviewLoaded(previews ? id : null);
  if (!id) return null;
  if (previews) return previewLoaded ? { url: '', id } : null;
  return loaded ? { url: loaded, id } : null;
}

/** Sharpening filters for the Picture editor's preview, made once per page (one for each step of 5 %), as SVG the CSS filter names. */
const made = new Set<number>();
export function sharpenFilter(percent: number): string {
  const id = `drashti-sharpen-${String(percent)}`;
  if (!made.has(percent) && typeof document !== 'undefined') {
    made.add(percent);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML = `<filter id="${id}" color-interpolation-filters="sRGB"><feConvolveMatrix order="3" preserveAlpha="true" edgeMode="duplicate" kernelMatrix="${sharpenKernel(percent).join(' ')}"/></filter>`;
    document.body.appendChild(svg);
  }
  return `url(#${id})`;
}

/**
 * The filter the Picture editor's preview draws a look's enhancements with, sharpening as an SVG filter (''
 * for none). The screens draw cssFilter and the sharpened copy instead.
 */
export function lookFilter(look: PictureLook | null): string {
  if (!look) return '';
  const step = sharpenStep(look.sharpness);
  return [cssFilter(look), step > 0 ? sharpenFilter(step) : ''].filter((f) => f !== '').join(' ');
}

/** The CSS transform of a zoom and a move ('' for none). */
export const frameTransform = (f: { zoom: number; x: number; y: number }) =>
  f.zoom === 1 && f.x === 0 && f.y === 0
    ? ''
    : `translate(${String(f.x * 100)}%, ${String(f.y * 100)}%) scale(${String(f.zoom)})`;

/** The box's own parts of a picture's style (where it is, its turn, how see-through), not how it fits. */
function boxOf(style: CSSProperties): CSSProperties {
  const { objectFit: _fit, ...box } = style;
  return box;
}

/**
 * A picture with its look. `style`: the box it is drawn in, as the plain picture had it; `showing`: which
 * showing it is on the screens (its live zoom), or null; `children`: the plain picture, given its style and
 * the sharpened copy to draw in its place (null: the picture itself).
 */
export function Looked({
  mediaId,
  showing,
  style,
  children,
}: {
  mediaId: string;
  showing: string | null;
  style: CSSProperties;
  children: (style: CSSProperties, copy: SharpCopy | null) => ReactNode;
}) {
  const look = usePictureLook(mediaId);
  const copy = useSharpCopy(mediaId, look);
  const screen = useContext(ScreenPictures);
  const z = screen?.liveZoom ?? null;
  const live = z && showing !== null && z.mediaId === mediaId && z.showing === showing ? z : null;
  const inner = useRef<HTMLDivElement>(null);
  // A live zoom glides to where it is going, frame by frame, by the clock every screen shares.
  useLayoutEffect(() => {
    if (!live) return;
    let frame = 0;
    const tick = () => {
      const now = engineNow();
      if (inner.current) inner.current.style.transform = frameTransform(liveZoomAt(live, now));
      if (now < live.at + ZOOM_GLIDE_MS) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [live]);
  if (!look && !live) return <>{children(style, null)}</>;
  const filter = cssFilter(look);
  const at = live ? liveZoomAt(live, engineNow()) : (look ?? { zoom: 1, x: 0, y: 0 });
  return (
    <div data-look="" data-media-id={mediaId} style={{ ...boxOf(style), overflow: 'hidden' }}>
      <div
        ref={inner}
        data-look-picture=""
        data-sharpened={copy ? copy.id : undefined}
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '50% 50%',
          transform: frameTransform(at) || undefined,
          filter: filter || undefined,
        }}
      >
        {children(
          {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: style.objectFit,
          },
          copy,
        )}
      </div>
    </div>
  );
}
