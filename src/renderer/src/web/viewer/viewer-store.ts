import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { EngineState } from '../../../../shared/engine/state';
import type { Framing, ZoomFrame } from './live-zoom';
import type { Size } from './zoom-math';

/*
 * What a phone or tablet looks at on its own (Session 54, D1): the screens' picture, a presentation's slides
 * (a deck's or a PDF's pages among them), a picture or a video, full screen, sharp and zoomed with two fingers,
 * on this device only. Any page can be looked at: it says what it draws, at what size, and (D2) whether it is
 * what the screens show now. A deck's steps (C2) and a shared playlist's files (D3) are pages like these.
 */

/** While a page is what the screens show (D2): where the live zoom's picture is in it, and how it is drawn. */
export interface OnScreens {
  frame: ZoomFrame;
  /** The picture's kept look as this page draws it (PLAIN where it draws the picture as it is). */
  kept: Framing;
}

export interface ViewerPage {
  /** Names what it shows; the phone's own zoom starts again from the whole when another page comes. */
  key: string;
  /** What it is, at the top: a slide's number and group, a picture's or video's name. */
  title: string;
  /** The size it is drawn at, until its own is known (a picture's or video's shape: setPageSize). */
  size: Size;
  /** What it draws, at its size, inside the zoom. */
  draw: () => ReactNode;
  /** Under it, outside the zoom: a video's time bar. */
  below?: () => ReactNode;
  /** Names what the screens show, where the page follows them: the zoom starts again when it changes. */
  showing?: (state: EngineState | null) => string;
  /** Whether the screens show this page now (LIVE at the top), with a picture to zoom or not. */
  live?: (state: EngineState | null) => boolean;
  /** D2: while this page is what the screens show, its live zoom's picture; null (no button) otherwise. */
  onScreens?: (state: EngineState | null) => OnScreens | null;
}

interface Viewer {
  pages: ViewerPage[];
  index: number;
  /** What is looked through ("Placeholder Kirtan"), said under each page's title; null for one page alone. */
  of: string | null;
  /** The pages' own sizes, as their pictures and videos load. */
  sizes: Record<string, Size>;
  /** How the page shown was come to: opened (0), or turned to by Next (1) or Previous (-1): a deck's step shows still. */
  movedBy: number;
}

export const useViewer = create<Viewer>(() => ({ pages: [], index: 0, of: null, sizes: {}, movedBy: 0 }));

/** Look at these pages, from this one, full screen on this device. */
export function openViewer(pages: ViewerPage[], index = 0, of: string | null = null): void {
  if (pages.length === 0) return;
  useViewer.setState({
    pages,
    index: Math.min(Math.max(0, index), pages.length - 1),
    of,
    sizes: {},
    movedBy: 0,
  });
}

export function closeViewer(): void {
  useViewer.setState({ pages: [], index: 0, of: null, sizes: {}, movedBy: 0 });
}

/** The page before or after, on this device only. */
export function turnPage(by: number): void {
  const { pages, index } = useViewer.getState();
  const to = index + by;
  if (to >= 0 && to < pages.length) useViewer.setState({ index: to, movedBy: Math.sign(by) });
}

/** A page's own size, once its picture or video says it. */
export function setPageSize(key: string, size: Size): void {
  if (size.width <= 0 || size.height <= 0) return;
  const known = useViewer.getState().sizes[key];
  if (known?.width === size.width && known.height === size.height) return;
  useViewer.setState((s) => ({ sizes: { ...s.sizes, [key]: size } }));
}
