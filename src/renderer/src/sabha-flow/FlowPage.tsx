import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SabhaFlow } from '../../../shared/sabha-flow';
import { pagesCapped, pagesShown } from '../../../shared/sabha-flow-lines';
import { IconButton } from '../ui/Button';
import { Minimize2, ZoomIn, ZoomOut } from '../ui/icons';
import { Loading } from '../ui/States';

/*
 * The Sabha flow's PDF page view (alpha.23, QA23-FLOW-1): its pages as Main drew them when the PDF was chosen (the
 * app's own PDF page path, the hidden pictures window's pdf.js; the first 20, a line saying so when it has more), one
 * under another, at the panel's width to begin
 * with; Zoom in and Zoom out (and Cmd or Ctrl with the wheel, or a pinch) make them larger or smaller, scrolling
 * both ways, and Fit puts them back at the panel's width. Operator window only.
 */

/** The zoom steps, as a share of the panel's width. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
const FIT = 1;
const LEAST = 0.25;
const MOST = 4;

/** One step larger or smaller than `zoom` (the nearest step that way), kept within the steps. */
export function zoomStep(zoom: number, way: 1 | -1): number {
  if (way === 1) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? MOST;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? LEAST;
}

/** Refuse invalid input rather than silently changing it to a different zoom. */
export function parseZoom(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*%?$/u.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]) / 100;
  return value >= LEAST && value <= MOST ? value : null;
}

/** Keep the page coordinate under an anchor; padding is outside the scaled page. The browser caps the far edge. */
export function zoomPosition(
  scroll: number,
  anchor: number,
  before: number,
  after: number,
  padding = 0,
  afterAnchor = anchor,
): number {
  return Math.max(0, (scroll + anchor - padding) * (after / before) + padding - afterAnchor);
}

/** Whether the pages are larger than their box (either way), so a drag has somewhere to move them. */
function canMove(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
}

type PageImage = { url: string } | { url: null };

/**
 * The flow's pages as pictures: the pages Main drew (pagesShown, at most the first 20), each asked for once, one after
 * another; each URL let go when the flow changes or the view goes.
 */
function usePages(flow: SabhaFlow): (PageImage | undefined)[] {
  const count = pagesShown(flow);
  // Whose pages they are: another flow's are none of this one's (each still to come).
  const [got, setGot] = useState<{ id: string; pages: (PageImage | undefined)[] }>({ id: '', pages: [] });
  useEffect(() => {
    const run = { gone: false };
    const urls: string[] = [];
    void (async () => {
      for (let i = 0; i < count; i++) {
        let image: PageImage = { url: null };
        try {
          const bytes = await window.drashti.flow.page(flow.id, i);
          if (bytes !== null) {
            const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }));
            urls.push(url);
            image = { url };
          }
        } catch {
          // Said on the page as one that could not be drawn.
        }
        if (run.gone) break;
        setGot((was) => {
          const pages = was.id === flow.id ? [...was.pages] : Array.from({ length: count }, () => undefined);
          pages[i] = image;
          return { id: flow.id, pages };
        });
      }
    })();
    return () => {
      run.gone = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [flow.id, count]);
  return got.id === flow.id ? got.pages : Array.from({ length: count }, () => undefined);
}

/** The page view, drawn afresh for each flow (its parent keys it by the flow's id): a new PDF starts at the width. */
export function FlowPage({ flow }: { flow: SabhaFlow }) {
  const pages = usePages(flow);
  const capped = pagesCapped(flow);
  const [zoom, setZoom] = useState(FIT);
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('100%');
  const [error, setError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [movable, setMovable] = useState(false);
  const currentZoom = useRef(FIT);
  const renderedZoom = useRef(FIT);
  const pending = useRef<{
    left: number;
    top: number;
    before: number;
    x: number;
    y: number;
    paddingX: number;
    paddingY: number;
    point?: { x: number; y: number };
  } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  // The Zoom box handing the keyboard to the pages (Enter or Escape done): its blur then takes nothing more.
  const handingOver = useRef(false);
  // Whether a drag can move the pages now, read from the box as laid out.
  const measureMovable = useCallback(() => {
    const el = box.current;
    if (el) setMovable(canMove(el));
  }, []);
  const changeZoom = useCallback((next: number, point?: { x: number; y: number }) => {
    const el = box.current;
    const before = renderedZoom.current;
    if (el && before !== next) {
      const rect = el.getBoundingClientRect();
      const x = point ? point.x - rect.left - el.clientLeft : el.clientWidth / 2;
      const y = point ? point.y - rect.top - el.clientTop : el.clientHeight / 2;
      const style = getComputedStyle(el);
      pending.current = {
        left: el.scrollLeft,
        top: el.scrollTop,
        before,
        x,
        y,
        paddingX: parseFloat(style.paddingLeft),
        paddingY: parseFloat(style.paddingTop),
        point,
      };
    } else pending.current = null;
    currentZoom.current = next;
    setZoom(next);
    setDraft(`${String(Math.round(next * 100))}%`);
    setError(false);
  }, []);
  useLayoutEffect(() => {
    renderedZoom.current = zoom;
    const el = box.current;
    const move = pending.current;
    if (el && move) {
      // Scrollbars (and the error line going away) can change the viewport's centre during the layout.
      const rect = el.getBoundingClientRect();
      const x = move.point ? move.point.x - rect.left - el.clientLeft : el.clientWidth / 2;
      const y = move.point ? move.point.y - rect.top - el.clientTop : el.clientHeight / 2;
      el.scrollLeft = zoomPosition(move.left, move.x, move.before, zoom, move.paddingX, x);
      el.scrollTop = zoomPosition(move.top, move.y, move.before, zoom, move.paddingY, y);
      pending.current = null;
    }
    // The cursor says it with the zoom itself, before it is drawn: a ResizeObserver reports only at the next frame drawn.
    measureMovable();
  }, [zoom, measureMovable]);
  const applyDraft = () => {
    const next = parseZoom(draft);
    if (next === null) {
      setError(true);
      setDraft(`${String(Math.round(currentZoom.current * 100))}%`);
    } else changeZoom(next);
  };
  // After Enter or Escape the pages have the keyboard, so the show's keys move the show again (bughunt S3-3: left in
  // the box, the next arrow or Space was typed there and the slide did not move).
  const keysToThePages = () => {
    handingOver.current = true;
    box.current?.focus({ preventScroll: true });
    handingOver.current = false;
  };
  // Cmd or Ctrl with the wheel (a trackpad's pinch comes so too) zooms; a plain wheel scrolls. React's wheel listener
  // cannot keep the window from zooming the whole page, so this one is the element's own, not passive.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      changeZoom(zoomStep(currentZoom.current, e.deltaY < 0 ? 1 : -1), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [changeZoom]);
  // The grab cursor only while a drag can move the pages: measured as each zoom is laid out and as each page is drawn,
  // and kept current as the box or the pages change size otherwise (a scrollbar, the panel or the window resized).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const sizes = new ResizeObserver(measureMovable);
    sizes.observe(el);
    if (sheet.current) sizes.observe(sheet.current);
    return () => {
      sizes.disconnect();
    };
  }, [measureMovable]);
  const endDrag = (el: HTMLElement, pointerId: number) => {
    drag.current = null;
    setDragging(false);
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  };
  const percent = `${String(Math.round(zoom * 100))}%`;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="flow-page-view">
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 py-1">
        <IconButton
          icon={ZoomOut}
          size="sm"
          label="Zoom out"
          data-testid="flow-zoom-out"
          disabled={zoom <= LEAST}
          onClick={() => {
            changeZoom(zoomStep(currentZoom.current, -1));
          }}
        />
        <input
          aria-label="Zoom"
          aria-invalid={error}
          aria-describedby={error ? 'flow-zoom-error' : undefined}
          className="min-h-6 w-14 rounded border border-line-strong bg-panel text-center text-xs tabular-nums"
          data-testid="flow-zoom"
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(false);
          }}
          onBlur={() => {
            if (!handingOver.current) applyDraft();
          }}
          // Only its own two keys stop here, as in every field (PlaylistFind): the window lets a field's other keys go
          // by (isTyping) but still takes ⌘1 and ⌘2, which the Mac's View menu would act on (S2-6). Either of the two
          // then gives the keyboard to the pages (bughunt S3-3).
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              applyDraft();
              keysToThePages();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDraft(percent);
              setError(false);
              keysToThePages();
            }
          }}
        />
        <IconButton
          icon={ZoomIn}
          size="sm"
          label="Zoom in"
          data-testid="flow-zoom-in"
          disabled={zoom >= MOST}
          onClick={() => {
            changeZoom(zoomStep(currentZoom.current, 1));
          }}
        />
        <IconButton
          icon={Minimize2}
          size="sm"
          label="Fit to the panel"
          data-testid="flow-zoom-fit"
          disabled={zoom === FIT}
          onClick={() => {
            changeZoom(FIT);
          }}
        />
        {error && (
          <span id="flow-zoom-error" role="alert" className="text-xs text-muted">
            Type a zoom from 25% to 400%
          </span>
        )}
      </div>
      {/* It scrolls, so it takes the keyboard (its arrows then go to the show, as everywhere in the window). */}
      <div
        ref={box}
        role="region"
        aria-label={`PDF page of ${flow.fileName}, ${percent}`}
        tabIndex={0}
        className={`min-h-0 flex-1 select-none overflow-auto [scrollbar-gutter:stable] bg-panel-2 p-2 ${dragging ? 'cursor-grabbing' : movable ? 'cursor-grab' : ''}`}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return;
          const el = e.currentTarget;
          if (!canMove(el)) return;
          // Its default stays: cancelling it would also cancel the mouse press that closes an open menu (ui/Menu),
          // which would then keep the show's keys. select-none and the pictures' draggable={false} and
          // pointer-events-none already keep a drag from selecting or dragging anything out.
          el.focus({ preventScroll: true });
          el.setPointerCapture(e.pointerId);
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            left: el.scrollLeft,
            top: el.scrollTop,
          };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (start?.id !== e.pointerId) return;
          // Its button let go where this never heard it (a system box took the mouse): the drag is over.
          if ((e.buttons & 1) === 0) {
            endDrag(e.currentTarget, e.pointerId);
            return;
          }
          e.currentTarget.scrollLeft = start.left + start.x - e.clientX;
          e.currentTarget.scrollTop = start.top + start.y - e.clientY;
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          endDrag(e.currentTarget, e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          setDragging(false);
        }}
        data-testid="flow-pages"
      >
        <div ref={sheet} className="flex flex-col" style={{ width: `${String(zoom * 100)}%`, gap: 8 * zoom }}>
          {pages.map((page, i) => {
            const name = `Page ${String(i + 1)} of ${String(flow.pageCount)}`;
            if (page === undefined) return <Loading key={i} label={`Drawing page ${String(i + 1)}…`} />;
            if (page.url === null)
              return (
                <p key={i} className="text-xs text-muted">
                  Page {i + 1} couldn’t be drawn.
                </p>
              );
            return (
              <img
                key={i}
                src={page.url}
                alt={name}
                // Drawn as it comes into view, off the window's own thread (a22-review-flow S9: 20 large pages).
                loading="lazy"
                decoding="async"
                draggable={false}
                onLoad={measureMovable}
                data-testid="flow-page"
                className="pointer-events-none block h-auto w-full bg-white shadow-sm"
              />
            );
          })}
          {capped !== null && (
            <p className="text-xs text-muted" data-testid="flow-pages-capped">
              {capped}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
