import { useEffect, useRef, useState } from 'react';
import type { SabhaFlow } from '../../../shared/sabha-flow';
import { IconButton } from '../ui/Button';
import { Minimize2, ZoomIn, ZoomOut } from '../ui/icons';
import { Loading } from '../ui/States';

/*
 * The Sabha flow's PDF page view (alpha.23, QA23-FLOW-1): its pages as Main drew them when the PDF was chosen (the
 * app's own PDF page path, the hidden pictures window's pdf.js), one under another, at the panel's width to begin
 * with; Zoom in and Zoom out (and Cmd or Ctrl with the wheel, or a pinch) make them larger or smaller, scrolling
 * both ways, and Fit puts them back at the panel's width. Operator window only.
 */

/** The zoom steps, as a share of the panel's width. */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
const FIT = 1;
const LEAST = 0.5;
const MOST = 4;

/** One step larger or smaller than `zoom` (the nearest step that way), kept within the steps. */
export function zoomStep(zoom: number, way: 1 | -1): number {
  if (way === 1) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? MOST;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? LEAST;
}

type PageImage = { url: string } | { url: null };

/** The flow's pages as pictures, fetched once for this flow; each URL let go when the flow changes or the view goes. */
function usePages(flow: SabhaFlow): (PageImage | undefined)[] {
  // Whose pages they are: another flow's are none of this one's (each still to come).
  const [got, setGot] = useState<{ id: string; pages: (PageImage | undefined)[] }>({ id: '', pages: [] });
  useEffect(() => {
    const run = { gone: false };
    const urls: string[] = [];
    void (async () => {
      const pages: (PageImage | undefined)[] = Array.from({ length: flow.pageCount }, () => undefined);
      for (let i = 0; i < flow.pageCount; i++) {
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
        pages[i] = image;
        setGot({ id: flow.id, pages: [...pages] });
      }
    })();
    return () => {
      run.gone = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [flow.id, flow.pageCount]);
  return got.id === flow.id ? got.pages : Array.from({ length: flow.pageCount }, () => undefined);
}

/** The page view, drawn afresh for each flow (its parent keys it by the flow's id): a new PDF starts at the width. */
export function FlowPage({ flow }: { flow: SabhaFlow }) {
  const pages = usePages(flow);
  const [zoom, setZoom] = useState(FIT);
  const box = useRef<HTMLDivElement>(null);
  // Cmd or Ctrl with the wheel (a trackpad's pinch comes so too) zooms; a plain wheel scrolls. React's wheel listener
  // cannot keep the window from zooming the whole page, so this one is the element's own, not passive.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => zoomStep(z, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, []);
  const percent = `${String(Math.round(zoom * 100))}%`;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="flow-page-view">
      <div className="flex shrink-0 items-center gap-1 px-3 py-1">
        <IconButton
          icon={ZoomOut}
          size="sm"
          label="Zoom out"
          data-testid="flow-zoom-out"
          disabled={zoom <= LEAST}
          onClick={() => {
            setZoom((z) => zoomStep(z, -1));
          }}
        />
        <span className="min-w-10 text-center text-xs text-muted tabular-nums" data-testid="flow-zoom">
          {percent}
        </span>
        <IconButton
          icon={ZoomIn}
          size="sm"
          label="Zoom in"
          data-testid="flow-zoom-in"
          disabled={zoom >= MOST}
          onClick={() => {
            setZoom((z) => zoomStep(z, 1));
          }}
        />
        <IconButton
          icon={Minimize2}
          size="sm"
          label="Fit to the panel"
          data-testid="flow-zoom-fit"
          disabled={zoom === FIT}
          onClick={() => {
            setZoom(FIT);
          }}
        />
      </div>
      {/* It scrolls, so it takes the keyboard (its arrows then go to the show, as everywhere in the window). */}
      <div
        ref={box}
        role="region"
        aria-label={`PDF page, ${percent}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto bg-panel-2 p-2"
        data-testid="flow-pages"
      >
        <div className="flex flex-col gap-2" style={{ width: `${String(zoom * 100)}%` }}>
          {pages.map((page, i) => {
            const name = `Page ${String(i + 1)} of ${String(flow.pageCount)}, ${flow.fileName}`;
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
                draggable={false}
                data-testid="flow-page"
                className="block h-auto w-full bg-white shadow-sm"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
