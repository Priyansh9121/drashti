import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Loader, Mic, Radio, ScreenShare, Settings, X } from '../ui/icons';

/*
 * The Stream panel's own drawing, warmed unseen with the LIVE picture's warm-up (Session 60, X21's second part; the
 * lead's ask after the owner's question Q60-4). Opened mid-show, the panel's first drawing in the operator window made
 * kinds of drawing this window had not drawn at that start (traced on CI's Mac, x21-1119-152307-74195 and -74205, and
 * the red x21-1119-155149-81097): in tiles that also hold an icon (which the graphics chip draws multisampled), a
 * fill under rounded corners and the primary button's gradient (Tailwind's three stops, mixed in oklab) under its
 * rounded corners; in tiles with no icon, a see-through fill, a fill under rounded corners, and a shadow with and
 * without rounded corners. A graphics chip makes each kind of drawing the first time it is asked for it, and every
 * window waits meanwhile: on a new CI Mac the gradient's first use held the GPU, and the hall's screens with it,
 * 357-461 ms.
 *
 * So while the LIVE picture warms up at the start (render/WarmUp.tsx, which the opening waits for), this draws the
 * panel's pieces in the LIVE picture's black box, black under brightness(0): once beside icons, once with none, each
 * in a layer of its own (so its tiles are its own), at their own size and on whole device pixels, as the panel draws
 * them (a box between pixels is drawn another way: with its edges smoothed). The pieces: the primary button with its
 * light and glow, the other buttons, a card and the sheet with their shadows, the dim, the sound meter, the Program
 * box with its picture (a canvas under rounded corners, which the compositor draws) and the spinner. It goes with the
 * warm-up. Nothing in it can be reached (inert) or read out (aria-hidden), its words are no button's, and nothing in
 * it asks Main for anything.
 */

/** How far to move a box at (`left`, `top`) CSS px so it starts on a whole device pixel (`ratio` device px a CSS px). */
export function onWholePixels(left: number, top: number, ratio: number): { dx: number; dy: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const by = (v: number) => (Number.isFinite(v) ? (Math.round(v * r) - v * r) / r : 0);
  return { dx: by(left), dy: by(top) };
}

/** One layer of pieces: `icons` beside them (multisampled tiles) or none (plain tiles). */
function Pieces({ icons, top }: { icons: boolean; top: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    // The Program box's picture: a canvas with something drawn in it, as the panel's preview has.
    const c = canvas.current?.getContext('2d');
    if (c) {
      c.fillStyle = '#3c4a5a';
      c.fillRect(0, 0, 64, 36);
    }
  }, []);
  const icon = (shape: ReactNode) => (icons ? shape : null);
  return (
    <div
      className="absolute left-2 flex h-[84px] w-[336px] flex-wrap content-start items-start gap-2 overflow-hidden text-fg will-change-transform [filter:brightness(0)]"
      style={{ top }}
    >
      {/* The primary button: its oklab gradient under its rounded corners, its light, ring and glow. */}
      {icons ? (
        <Button variant="primary" size="lg" icon={Radio} tabIndex={-1}>
          Aa
        </Button>
      ) : (
        <Button variant="primary" size="lg" tabIndex={-1}>
          Aa
        </Button>
      )}
      {/* The other buttons (the panel's header), each its edge and fill under rounded corners. */}
      {icons ? (
        <Button icon={ScreenShare} tabIndex={-1}>
          Aa
        </Button>
      ) : (
        <Button tabIndex={-1}>Aa</Button>
      )}
      {icon(
        <span className="flex h-8 w-8 items-center justify-center rounded-md">
          <X size={16} aria-hidden="true" />
          <Settings size={16} aria-hidden="true" />
        </span>,
      )}
      {/* A card with its shadow under rounded corners (the panel's figures and choices). */}
      <span className="flex h-8 w-12 items-center justify-center rounded-lg border border-line bg-panel-2 shadow-card">
        {icon(<Mic size={14} aria-hidden="true" />)}
      </span>
      {/* The sheet: square, its edge on the left, its shadow. */}
      <span className="flex h-10 w-8 items-center justify-center border-l border-line-strong bg-panel shadow-overlay">
        {icon(<Radio size={14} aria-hidden="true" />)}
      </span>
      {/* The dim over the window. */}
      <span className="flex h-4 w-8 items-center justify-center bg-black/60">
        {icon(<X size={12} aria-hidden="true" />)}
      </span>
      {/* The sound meter: its bar under the track's rounded ends. */}
      <span className="flex items-center gap-2">
        {icon(<Mic size={14} aria-hidden="true" className="shrink-0 text-muted" />)}
        <span className="relative block h-2.5 w-16 overflow-hidden rounded-full border border-line-strong bg-panel-3">
          <span className="block h-full w-8 bg-success" />
        </span>
        <span className="text-xs text-muted">Aa</span>
      </span>
      {/* The Program box: its picture under rounded corners, the spinner over it until the picture comes. */}
      <span className="relative block h-9 w-16 overflow-hidden rounded-lg border border-line-strong bg-black">
        <canvas ref={canvas} width={64} height={36} className="h-full w-full" />
        {icons && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader size={16} aria-hidden="true" className="animate-spin" />
          </span>
        )}
      </span>
      <span className="text-2xs font-bold tracking-wider text-heading uppercase">Aa</span>
    </div>
  );
}

export function PanelWarmUp() {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Measured once, before the pieces are first drawn: the LIVE box can sit between device pixels.
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const { dx, dy } = onWholePixels(box.left, box.top, window.devicePixelRatio);
    if (dx !== 0 || dy !== 0) el.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`;
  }, []);
  return (
    <div
      ref={root}
      aria-hidden="true"
      inert
      data-testid="panel-warm-up"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <Pieces icons top={8} />
      <Pieces icons={false} top={100} />
    </div>
  );
}
