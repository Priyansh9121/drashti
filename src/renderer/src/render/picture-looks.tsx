import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { create } from 'zustand';
import type { LiveZoom, PictureLook } from '../../../shared/picture-look';
import {
  cssFilter,
  liveZoomAt,
  sharpenKernel,
  sharpenStep,
  ZOOM_GLIDE_MS,
} from '../../../shared/picture-look';
import { engineNow } from './clock';

/*
 * A picture drawn with its look (Session 26e, shared/picture-look.ts): zoomed
 * and moved within its box, its brightness, contrast, colour and sharpness
 * by the screens' own filters, and on the screens the live zoom of its
 * showing, gliding there by the engine's clock so every screen is at the
 * same point. A picture with neither is drawn exactly as before.
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

/** Sharpening filters, made once per page (one for each step of 5 %), as SVG the CSS filter names. */
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

/** The filter a look's enhancements draw with ('' for none). */
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
 * showing it is on the screens (its live zoom), or null; `children`: the plain picture, given its style.
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
  children: (style: CSSProperties) => ReactNode;
}) {
  const look = usePictureLook(mediaId);
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
  if (!look && !live) return <>{children(style)}</>;
  const filter = lookFilter(look);
  const at = live ? liveZoomAt(live, engineNow()) : (look ?? { zoom: 1, x: 0, y: 0 });
  return (
    <div data-look="" data-media-id={mediaId} style={{ ...boxOf(style), overflow: 'hidden' }}>
      <div
        ref={inner}
        data-look-picture=""
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '50% 50%',
          transform: frameTransform(at) || undefined,
          filter: filter || undefined,
        }}
      >
        {children({
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: style.objectFit,
        })}
      </div>
    </div>
  );
}
