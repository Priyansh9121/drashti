import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { buttonClass } from '../ui/Button';
import { Loader, Mic, Radio, ScreenShare, Settings, X } from '../ui/icons';

/*
 * The Stream panel's own drawing, warmed unseen with the LIVE picture's warm-up (Session 60, X21's second part; the
 * lead's ask after the owner's question Q60-4). Opened mid-show, the panel's first drawing in the operator window made
 * kinds of drawing this window had not drawn at that start (traced on CI's Mac, x21-1119-152307-74195 and -74205, and
 * the red x21-1119-155149-81097): in tiles that also hold a path (an icon, or a rounded box's inset light), which the
 * graphics chip draws multisampled, a see-through fill under rounded corners and the primary button's gradient
 * (Tailwind's three stops, mixed in oklab) under its rounded corners; in tiles with no path, a see-through fill, one
 * under rounded corners, and a shadow with and without rounded corners. A graphics chip makes each kind of drawing the
 * first time it is asked for it, and every window waits meanwhile: on a new CI Mac the gradient's first use held the
 * GPU, and the hall's screens with it, 357-461 ms.
 *
 * So while the LIVE picture warms up at the start (render/WarmUp.tsx, which the opening waits for), this draws the
 * panel's pieces in the LIVE picture's black box, black under brightness(0), twice: once beside icons and once with no
 * path at all (no icon, no inset light), each in a layer of its own so its tiles are its own; at their own size and on
 * whole device pixels, as the panel draws them (a box between pixels is drawn another way: its edges smoothed); and,
 * beneath them, unfiltered and black, the preview's picture as the compositor draws it. It goes with the warm-up.
 * Nothing in it can be reached (inert) or read out (aria-hidden), nothing in it is a button (its buttons are drawn as
 * buttons look: the window keeps its one primary), its words are no button's, and nothing in it asks Main for
 * anything.
 */

/** How far to move a box at (`left`, `top`) CSS px onto a whole device pixel (`ratio` device px a CSS px). */
export function onWholePixels(left: number, top: number, ratio: number): { dx: number; dy: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const by = (v: number) => (Number.isFinite(v) ? (Math.round(v * r) - v * r) / r : 0);
  return { dx: by(left), dy: by(top) };
}

/** A layer of its own (its tiles its own), black under brightness(0), `top` CSS px down the box. */
function Layer({ top, children }: { top: number; children: ReactNode }) {
  return (
    <div
      className="absolute left-2 flex h-[84px] w-[336px] flex-wrap content-start items-start gap-2 overflow-hidden text-fg will-change-transform [filter:brightness(0)]"
      style={{ top }}
    >
      {children}
    </div>
  );
}

/** The Program box: its picture, a canvas under rounded corners (the compositor draws it), as the panel's preview. */
function ProgramBox({ children }: { children?: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = canvas.current?.getContext('2d');
    if (!c) return;
    c.fillStyle = '#3c4a5a';
    c.fillRect(0, 0, 64, 36);
  }, []);
  return (
    <span className="relative block h-9 w-16 overflow-hidden rounded-lg border border-line-strong bg-black">
      <canvas ref={canvas} width={64} height={36} className="h-full w-full" />
      {children}
    </span>
  );
}

/**
 * The Program box's picture as the compositor draws it (the panel's preview: a canvas the graphics chip draws, a layer
 * of its own, scaled, under the box's rounded corners). Unfiltered, since a filter over it is drawn into it, another
 * kind (the trace at f94cd564: the small canvases above are drawn in their tiles, and the compositor drew this kind
 * new as the panel opened); its pixels black, unseen on the LIVE box's black.
 */
function PreviewPicture() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = canvas.current?.getContext('2d');
    if (!c) return;
    c.fillStyle = '#000000';
    c.fillRect(0, 0, 320, 180);
  }, []);
  return (
    <span className="absolute top-[27px] left-12 block h-36 w-64 overflow-hidden rounded-lg bg-black">
      <canvas ref={canvas} width={320} height={180} className="h-full w-full object-contain" />
    </span>
  );
}

/** A see-through fill under rounded corners (a box's inset light is one, beside its path). */
const SeeThroughUnderCorners = () => (
  <span className="block h-4 w-12 overflow-hidden rounded-lg">
    <span className="block h-full w-8 bg-black/60" />
  </span>
);

/** The pieces beside icons: every tile of this layer is drawn multisampled. */
function WithIcons() {
  return (
    <Layer top={8}>
      {/* The primary button: its oklab gradient under its rounded corners beside its icon, its inset light, ring, glow.
          Drawn as a button looks, never a button (no test or keyboard finds a second primary: docs/design.md). */}
      <span className={buttonClass('primary', 'lg')}>
        <Radio size={18} aria-hidden="true" className="shrink-0" />
        Aa
      </span>
      <span className={buttonClass('secondary', 'md')}>
        <ScreenShare size={16} aria-hidden="true" className="shrink-0" />
        Aa
      </span>
      <span className="flex h-8 w-8 items-center justify-center rounded-md">
        <X size={16} aria-hidden="true" />
        <Settings size={16} aria-hidden="true" />
      </span>
      <span className="flex h-8 w-12 items-center justify-center rounded-lg border border-line bg-panel-2 shadow-card">
        <Mic size={14} aria-hidden="true" />
      </span>
      <span className="flex h-10 w-8 items-center justify-center border-l border-line-strong bg-panel shadow-overlay">
        <Radio size={14} aria-hidden="true" />
      </span>
      <span className="flex h-4 w-8 items-center justify-center bg-black/60">
        <X size={12} aria-hidden="true" />
      </span>
      <SeeThroughUnderCorners />
      <span className="flex items-center gap-2">
        <Mic size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="relative block h-2.5 w-16 overflow-hidden rounded-full border border-line-strong bg-panel-3">
          <span className="block h-full w-8 bg-success" />
        </span>
      </span>
      <ProgramBox>
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader size={16} aria-hidden="true" className="animate-spin" />
        </span>
      </ProgramBox>
      <span className="text-2xs font-bold tracking-wider text-heading uppercase">Aa</span>
    </Layer>
  );
}

/**
 * The pieces with no path at all (no icon; no inset light, which is drawn as a path): every tile of this layer is
 * drawn plainly. The primary button's gradient, ring and glow on a box of its own (the button itself has the light).
 * Inside the LIVE box's rounded corners only a piece drawn whole inside them is drawn as the panel draws it, with no
 * clip; and the sheet's shadow on a box this small draws no blur at all (its -18 px spread leaves nothing: the trace at
 * f94cd564 had every kind but that one): so the sheet's shadow is a small one of its own, whole inside.
 */
function Plain() {
  return (
    <Layer top={100}>
      <span className="flex h-10 items-center rounded-lg border border-primary-lo bg-linear-to-b from-primary-hi via-primary via-55% to-primary-lo px-4 text-base font-bold text-on-primary shadow-[0_0_0_1px_var(--depth-primary-ring),0_10px_24px_-12px_var(--depth-primary)]">
        Aa
      </span>
      <span className={buttonClass('secondary', 'md')}>Aa</span>
      <span className="block h-8 w-12 rounded-lg border border-line bg-panel-2 shadow-overlay" />
      <span className="block h-4 w-8 bg-black/60" />
      <SeeThroughUnderCorners />
      <span className="relative block h-2.5 w-16 overflow-hidden rounded-full border border-line-strong bg-panel-3">
        <span className="block h-full w-8 bg-success" />
      </span>
      <ProgramBox />
      {/* The sheet: a square box's blurred shadow, whole inside the LIVE box (one that reaches the box's rounded
          corners is drawn clipped to them: another kind; the sheet's own, 52 px, has no room here). */}
      <span className="absolute top-6 right-12 block h-6 w-6 bg-panel shadow-[0_8px_16px_-4px_rgb(0_0_0/0.45)]" />
      <span className="text-2xs font-bold tracking-wider text-heading uppercase">Aa</span>
    </Layer>
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
      <PreviewPicture />
      <WithIcons />
      <Plain />
    </div>
  );
}
