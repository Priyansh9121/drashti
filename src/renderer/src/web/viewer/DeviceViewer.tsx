import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ZOOM } from '../../../../shared/picture-look';
import { useEngine } from '../../engine/engine-store';
import { PictureScaleContext } from '../../render/previews';
import { useElementSize } from '../../render/useElementSize';
import { LiveBadge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { useFocusTrap } from '../../ui/Dialog';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Tv, X, ZoomIn, ZoomOut } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { api } from '../device';
import { tap, useTapNotice } from '../taps';
import { type Framing, liveFramingOf, liveZoomFor, maxZoomOver, viewForLive } from './live-zoom';
import { closeOnStop, closeViewer, turnPage, useViewer } from './viewer-store';
import { ZoomSurface } from './ZoomSurface';
import { clampView, type View, WHOLE, zoomedAt } from './zoom-math';

/*
 * Looking closer on a phone or tablet (Session 54, D1 and D2): one page at a time, full screen, drawn sharp and
 * zoomed with two fingers on this device only, with the pages before and after it (a presentation looked
 * through). When the page is what the screens show and it is zoomed, a large button at the side puts that zoom
 * on the screens (the engine's live zoom, Session 26e), and Back to Whole undoes it; on anything not live there is
 * neither. Esc or Close goes back to the remote. Mounted once, by the remote (RemoteApp.tsx). Its bars keep clear of
 * a phone's notch and rounded corners however it is held (the safe areas, D1/D2 review).
 */

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

const near = (a: Framing, b: Framing) =>
  Math.abs(a.zoom - b.zoom) < 0.005 && Math.abs(a.x - b.x) < 0.005 && Math.abs(a.y - b.y) < 0.005;

/** The zoom buttons' step: half as big again, or back. */
const STEP = 1.5;
/** A zoom has settled once its short glide has (ZoomSurface's, --dur-hover): each picture then measures its size. */
const SETTLE_MS = 200;

export function DeviceViewer() {
  const open = useViewer((s) => s.pages.length > 0);
  // Drashti stopped: what plays here stops at once, and the viewer closes (D1/D2 review).
  const stopped = useEngine((s) => (s.state?.stopped ?? null) !== null);
  useEffect(() => closeOnStop(), []);
  return open && !stopped ? <Viewer /> : null;
}

function Viewer() {
  const { pages, index, of, sizes } = useViewer();
  const page = pages[Math.min(index, pages.length - 1)] ?? pages[0];
  const state = useEngine((s) => s.state);
  const notice = useTapNotice((s) => s.text);
  const root = useRef<HTMLDivElement>(null);
  useFocusTrap(root, closeViewer);
  const surface = useRef<HTMLDivElement>(null);
  const screen = useElementSize(surface);
  // The pictures are asked for again, sharper, each time a zoom settles.
  const [scale, setScale] = useState(0);
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current);
    },
    [],
  );
  const [held, setHeld] = useState<{ key: string; view: View } | null>(null);
  const drawn = useMemo(() => page?.draw(), [page]);
  if (!page) return null;

  const content = sizes[page.key] ?? page.size;
  const onScreens = page.onScreens?.(state) ?? null;
  const live = onScreens !== null || (page.live?.(state) ?? false);
  const maxZoom = onScreens ? maxZoomOver(onScreens.kept) : ZOOM.max;
  // The screens' live zoom now (null: as the picture is kept), while this page is what they show.
  const screensAt = onScreens ? liveFramingOf(state) : null;
  // The view starts again for each page, and each new thing on the screens for a page that follows them; until
  // this device moves it, a page the screens show zoomed starts where they are.
  const viewKey = `${page.key}|${page.showing?.(state) ?? ''}`;
  const start = onScreens && screensAt ? viewForLive(screensAt, onScreens.frame, onScreens.kept) : WHOLE;
  const view = clampView(held?.key === viewKey ? held.view : start, content, screen, maxZoom);
  const setView = (v: View) => {
    setHeld({ key: viewKey, view: clampView(v, content, screen, maxZoom) });
  };
  const settle = () => {
    if (settling.current) clearTimeout(settling.current);
    settling.current = setTimeout(() => {
      setScale((n) => n + 1);
    }, SETTLE_MS);
  };
  const by = (factor: number) => {
    setView(zoomedAt(view, factor, { x: screen.width / 2, y: screen.height / 2 }, content, screen, maxZoom));
    settle();
  };

  // D2: this device's zoom as the screens' live zoom, and whether they show it now.
  const zoomedHere = view.zoom > 1.001;
  const mine = onScreens ? liveZoomFor(view, onScreens.frame, onScreens.kept) : null;
  const showsThis = mine !== null && screensAt !== null && near(mine, screensAt);
  // Where it is in what is looked through; one page alone says how it zooms.
  const place =
    pages.length > 1
      ? [`${String(index + 1)} of ${String(pages.length)}`, of].filter(Boolean).join(' · ')
      : 'Zoom with two fingers: on this device only';

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The arrows the zoomed picture did not take: the page before or after.
    if (e.defaultPrevented || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    if (e.target instanceof HTMLElement && e.target.getAttribute('role') === 'slider') return;
    e.preventDefault();
    turnPage(e.key === 'ArrowLeft' ? -1 : 1);
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="viewer-title"
      aria-describedby="viewer-place"
      className="fixed inset-0 z-40 flex flex-col bg-ink"
      data-testid="viewer"
      data-page={page.key}
      data-live={live ? 'true' : undefined}
      onKeyDown={onKeyDown}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <div className="min-w-0 flex-1">
          <h2 id="viewer-title" className="truncate text-base font-bold text-fg" data-testid="viewer-title">
            {page.title}
          </h2>
          <p id="viewer-place" className="truncate text-base text-muted">
            {place}
          </p>
        </div>
        {live && <LiveBadge />}
        <Button size="lg" icon={X} data-testid="viewer-close" onClick={closeViewer}>
          Close
        </Button>
      </header>
      {notice && (
        <div className="shrink-0 bg-panel pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] pt-2">
          <Notice tone="warning" onDismiss={() => useTapNotice.setState({ text: null })}>
            {notice}
          </Notice>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <PictureScaleContext.Provider value={scale}>
          <ZoomSurface
            ref={surface}
            screen={screen}
            content={content}
            view={view}
            maxZoom={maxZoom}
            label={`${page.title}: + and − zoom it here, and the arrows move it`}
            onView={setView}
            onSettle={settle}
          >
            {/* Each page its own: a video looked at stops as another page comes. */}
            <Fragment key={page.key}>{drawn}</Fragment>
          </ZoomSurface>
        </PictureScaleContext.Provider>
        {/* D2: at the side, while this page is what the screens show; never on anything else. */}
        {onScreens && (zoomedHere || screensAt) && (
          <div
            className="absolute top-1/2 right-[max(0.5rem,env(safe-area-inset-right))] flex w-40 -translate-y-1/2 flex-col gap-2"
            data-testid="viewer-screens"
          >
            {zoomedHere && (
              <Button
                size="lg"
                variant={showsThis ? 'live' : 'primary'}
                icon={Tv}
                className="h-auto min-h-16 py-2 text-left whitespace-normal"
                data-testid="viewer-show-zoom"
                onClick={() => {
                  if (mine) void tap(post('/api/v1/zoom', mine));
                }}
              >
                {showsThis ? 'This zoom is on the screens' : 'Show this zoom on the screens'}
              </Button>
            )}
            {screensAt && (
              <Button
                size="lg"
                icon={Minimize2}
                className="h-auto min-h-12 py-2 text-left whitespace-normal"
                data-testid="viewer-whole"
                onClick={() => {
                  setView(WHOLE);
                  settle();
                  void tap(post('/api/v1/zoom/whole'));
                }}
              >
                Back to Whole
              </Button>
            )}
          </div>
        )}
      </div>
      {page.below?.()}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-panel pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1" role="group" aria-label="Zoom on this device">
          <IconButton
            icon={ZoomOut}
            label="Zoom out"
            size="lg"
            variant="secondary"
            data-testid="viewer-zoom-out"
            disabled={view.zoom <= 1.001}
            onClick={() => {
              by(1 / STEP);
            }}
          />
          <span
            className="min-w-14 text-center text-base text-fg tabular-nums"
            data-testid="viewer-zoom-level"
          >
            {Math.round(view.zoom * 100)}%
          </span>
          <IconButton
            icon={ZoomIn}
            label="Zoom in"
            size="lg"
            variant="secondary"
            data-testid="viewer-zoom-in"
            disabled={view.zoom >= maxZoom - 0.001}
            onClick={() => {
              by(STEP);
            }}
          />
          <IconButton
            icon={Maximize2}
            label="All of it"
            size="lg"
            variant="secondary"
            data-testid="viewer-zoom-whole"
            disabled={view.zoom <= 1.001}
            onClick={() => {
              setView(WHOLE);
              settle();
            }}
          />
        </div>
        {pages.length > 1 && (
          <div className="flex items-center gap-1" role="group" aria-label="Look through">
            <IconButton
              icon={ChevronLeft}
              label="Previous"
              size="lg"
              variant="secondary"
              data-testid="viewer-previous"
              disabled={index === 0}
              onClick={() => {
                turnPage(-1);
              }}
            />
            <IconButton
              icon={ChevronRight}
              label="Next"
              size="lg"
              variant="secondary"
              data-testid="viewer-next"
              disabled={index >= pages.length - 1}
              onClick={() => {
                turnPage(1);
              }}
            />
          </div>
        )}
      </footer>
    </div>
  );
}
