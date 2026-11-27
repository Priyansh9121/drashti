import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { buttonClass } from '../ui/Button';
import { Loader, Mic, Radio, ScreenShare, Settings, X } from '../ui/icons';

/*
 * The Stream panel's own drawing, warmed unseen with the LIVE picture's warm-up (Session 60, X21's second part; the
 * lead's ask after the owner's question Q60-4). Opened mid-show, the panel's first drawing in the operator window made
 * kinds of drawing this window had not drawn at that start (traced on CI's Mac, x21-1119-152307-74195 and -74205, and
 * the red x21-1119-155149-81097): in tiles that also hold a path (an icon), which the graphics chip draws
 * multisampled, a see-through fill under rounded corners and the primary button's gradient (Tailwind's three stops,
 * mixed in oklab) under its rounded corners; in tiles with no path, a see-through fill, one under rounded corners, and
 * a shadow with and without rounded corners to keep out; and the compositor its preview under rounded corners. A
 * graphics chip makes each kind of drawing the first time it is asked for it, and every window waits meanwhile: on a
 * new CI Mac the gradient's first use held the GPU, and the hall's screens with it, 357-461 ms.
 *
 * So while the LIVE picture warms up at the start (render/WarmUp.tsx, which the opening waits for), this draws the
 * panel's pieces in the LIVE picture's black box, black under brightness(0), twice: once beside icons and once with
 * none, each in a layer of its own so its tiles are its own; at their own size and on whole device pixels, as the
 * panel draws them (a box between pixels is drawn another way: its edges smoothed); and, beneath them, unfiltered and
 * black, the preview's picture as the compositor draws it. It goes with the warm-up. It and the keeper below are marked
 * data-chip-warm-up: drawn only where Chromium draws with a graphics chip, the chip's own ways of drawing made ahead or
 * kept, so the check of what costs a computer without one passes over them and holds them to their own rules
 * (tests/e2e/appearance-drawing.spec.ts). Nothing in it can be reached (inert) or read out (aria-hidden), nothing in
 * it is a button (its buttons are drawn as buttons look: the window keeps its one primary), its words are no button's,
 * and nothing in it asks Main for anything.
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

/**
 * A see-through fill under rounded corners, narrower than their radius, as a quiet sound meter's bar or a box's inset
 * light draws (a wider one merges with the corners into one rounded box: another kind).
 */
const SeeThroughUnderCorners = () => (
  <span className="block h-4 w-12 overflow-hidden rounded-lg">
    <span className="block h-full w-1 bg-black/60" />
  </span>
);

/**
 * The sheet's shadow where its box is not: the panel's sheet is as tall as the window, so the tail of its shadow below
 * it is drawn in a tile of its own, with nothing of the box to keep out (another kind than a shadow beside its box).
 * Here the box sits just above a clip and only its shadow's tail is drawn, inside it.
 */
const ShadowTail = () => (
  <span className="relative block h-6 w-16 overflow-hidden">
    <span className="absolute -top-10 left-2 block h-10 w-12 border-l border-line-strong bg-panel shadow-overlay" />
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
      <ShadowTail />
      <span className="flex items-center gap-2">
        <Mic size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="relative block h-2.5 w-16 overflow-hidden rounded-full border border-line-strong bg-panel-3">
          <span className="block h-full w-1 bg-success" />
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
 * The same pieces with no icon (no path: a box's inset light is a fill under its rounded corners, not a path; the trace
 * at 8b1df234 drew this layer plainly with them): every tile of this layer is drawn plainly.
 */
function Plain() {
  return (
    <Layer top={100}>
      <span className={buttonClass('primary', 'lg')}>Aa</span>
      <span className={buttonClass('secondary', 'md')}>Aa</span>
      <span className="block h-8 w-12 rounded-lg border border-line bg-panel-2 shadow-card" />
      <span className="block h-10 w-8 border-l border-line-strong bg-panel shadow-overlay" />
      <span className="block h-4 w-8 bg-black/60" />
      <SeeThroughUnderCorners />
      <ShadowTail />
      <span className="relative block h-2.5 w-16 overflow-hidden rounded-full border border-line-strong bg-panel-3">
        <span className="block h-full w-1 bg-success" />
      </span>
      <ProgramBox />
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
      data-chip-warm-up=""
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <PreviewPicture />
      <WithIcons />
      <Plain />
    </div>
  );
}

/**
 * How often the keeper draws the primary button's kind again (ms). The GPU keeps its kinds of drawing in a cache that
 * drops one left unused (Skia's Graphite: a least-recently-used cache of 512, and a purge of those unused since a
 * time): the warm-up's copy of the primary's was gone some seven minutes into the Performance check; others the show
 * draws all the time stayed.
 */
export const KIND_KEEP_MS = 20_000;

/**
 * How the keeper's primary is placed at each step (a24-streamwarm): the whole button a pixel down every other step, so
 * its tile is drawn again with the same kinds of drawing as at its first. Its background moved a pixel within its box
 * instead (background-position 0 1px, as it was) is drawn as a repeated picture, two kinds of drawing of its own (the
 * gradient into a picture first, then that picture under the rounded corners): CI's Mac made them at the keeper's
 * first step, 20 s after the window opened (stream-panel-warm.spec.ts's trace, at a78d5197c), the stall it is there
 * to keep away. A pixel down it stays under the cover.
 */
export function keeperMove(odd: boolean): CSSProperties {
  return odd ? { transform: 'translateY(1px)' } : {};
}

/**
 * The keeper's shift onto whole device pixels: `box` is where it is drawn now (CSS px, its shift `now` in it), `ratio`
 * device px a CSS px. The LIVE heading can sit between device pixels, and a box between pixels is drawn another way.
 */
export function keeperShift(
  box: { left: number; top: number },
  now: { dx: number; dy: number },
  ratio: number,
): { dx: number; dy: number } {
  return onWholePixels(box.left - now.dx, box.top - now.dy, ratio);
}

/**
 * The primary button's drawing kind, kept in use mid-show (Session 60, X21's second part; the owner's "A + keep
 * tracing", Q60-9). The Stream panel's Go live is a primary button, its oklab gradient and inset light under rounded
 * corners beside an icon; the window's other primary (Next) draws with another kind (traced: x21-1119-210349-71828)
 * and is drawn again only when pressed or pointed at anyway (a show run from the keyboard or a clicker never is). So
 * this draws a tiny copy of it every KIND_KEEP_MS, in a layer of its own (an icon in it: drawn multisampled, as the
 * panel's tile is) on whole device pixels, under a cover of the panel's own colour, a pixel larger all round and a
 * pixel in from the layer's edge (a layer all of one colour is never drawn: x21-macos-25's trace): the window looks
 * the same. Nothing in it can be reached or read out, and it asks Main for nothing.
 */
export function PanelKindKeeper() {
  const root = useRef<HTMLSpanElement>(null);
  const shift = useRef({ dx: 0, dy: 0 });
  const [odd, setOdd] = useState(false);
  // On whole device pixels, looked at again before each drawing (the heading moves as notices come and go).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const next = keeperShift(box, shift.current, window.devicePixelRatio);
    if (next.dx === shift.current.dx && next.dy === shift.current.dy) return;
    shift.current = next;
    el.style.transform = `translate(${String(next.dx)}px, ${String(next.dy)}px)`;
  }, [odd]);
  useEffect(() => {
    const timer = setInterval(() => {
      setOdd((was) => !was);
    }, KIND_KEEP_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <span
      ref={root}
      aria-hidden="true"
      inert
      data-testid="panel-kind-keeper"
      data-chip-warm-up=""
      className="pointer-events-none absolute top-1 left-16 block h-4 w-8 will-change-transform"
    >
      {/* Drawn again as it moves a pixel under the cover (nothing on screen changes): keeperMove. */}
      <span
        className="absolute inset-[2px] flex items-center justify-center overflow-hidden rounded-lg border border-primary-lo bg-linear-to-b from-primary-hi via-primary via-55% to-primary-lo text-on-primary shadow-[inset_0_1px_0_var(--depth-primary-top)]"
        style={keeperMove(odd)}
      >
        <Radio size={8} aria-hidden="true" />
      </span>
      {/* A pixel in from the layer's edge: a layer all of one colour is shown as that colour and never drawn. */}
      <span className="absolute inset-px bg-panel" />
    </span>
  );
}
