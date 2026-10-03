import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { useRef, useState } from 'react';
import type { Rect } from '../../../shared/model';
import type { Size } from '../../../shared/scaling';
import type { Guides, Handle, Point, SnapLines } from '../editor/geometry';
import { HANDLE_AT, HANDLES, resizeFrame, snapLines, snapMove, snapResize } from '../editor/geometry';
import { useElementSize } from '../render/useElementSize';

/*
 * Boxes on a canvas, placed by hand: the stage layout editor's boxes and the
 * mask editor's shapes. The canvas is drawn scaled to fit, with `picture`
 * behind the boxes (what the screen will show). Click a box to choose it,
 * drag to move it (snapping to the canvas's edges and middle and to the
 * other boxes; Alt places freely), drag a handle to resize it. From the
 * keyboard: Tab chooses the next box, the arrows move it (Shift: ten
 * pixels); sizes are typed in the editor's fields.
 */

export interface CanvasBox {
  id: string;
  frame: Rect;
  /** How it is read out, and shown on it. */
  name: string;
}

const PAD = 24;
const SNAP_PX = 8;
const DRAG_PX = 3;
const HANDLE_PX = 10;

type Drag =
  | { kind: 'move'; id: string; start: Point; frame: Rect; lines: SnapLines; dragging: boolean }
  | { kind: 'resize'; id: string; handle: Handle; frame: Rect; lines: SnapLines };

const CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

const round = (r: Rect): Rect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.round(r.width),
  height: Math.round(r.height),
});

export function BoxCanvas({
  size,
  boxes,
  selected,
  onSelect,
  onChange,
  picture,
  label,
  testId,
  minSize = 8,
}: {
  size: Size;
  boxes: readonly CanvasBox[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** A box moved or resized; `done` at the end of a drag (one step), false while dragging. */
  onChange: (id: string, frame: Rect, done: boolean) => void;
  /** Drawn at the canvas's size behind the boxes. */
  picture: ReactNode;
  /** The canvas's accessible name, with its keys. */
  label: string;
  testId?: string;
  minSize?: number;
}) {
  const area = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const shown = useElementSize(area);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Guides | null>(null);
  const scale = Math.max(
    0.02,
    Math.min((shown.width - 2 * PAD) / size.width, (shown.height - 2 * PAD) / size.height),
  );
  const width = size.width * scale;
  const height = size.height * scale;
  const chosen = boxes.find((b) => b.id === selected);

  const pointOf = (e: { clientX: number; clientY: number }): Point => {
    const r = stage.current?.getBoundingClientRect();
    return r ? { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale } : { x: 0, y: 0 };
  };
  const linesWithout = (id: string) =>
    snapLines(
      size,
      boxes.filter((b) => b.id !== id).map((b) => b.frame),
    );
  /** The topmost box under a point (the last drawn is on top). */
  const hit = (p: Point) =>
    [...boxes]
      .reverse()
      .find(
        (b) =>
          p.x >= b.frame.x &&
          p.x <= b.frame.x + b.frame.width &&
          p.y >= b.frame.y &&
          p.y <= b.frame.y + b.frame.height,
      );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stage.current?.focus();
    const p = pointOf(e);
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset['handle'] as
      Handle | undefined;
    if (handle && chosen) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        kind: 'resize',
        id: chosen.id,
        handle,
        frame: chosen.frame,
        lines: linesWithout(chosen.id),
      };
      return;
    }
    const box = hit(p);
    onSelect(box?.id ?? null);
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      kind: 'move',
      id: box.id,
      start: p,
      frame: box.frame,
      lines: linesWithout(box.id),
      dragging: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = pointOf(e);
    const within = e.altKey ? 0 : SNAP_PX / scale;
    if (d.kind === 'move') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (!d.dragging) {
        if (Math.hypot(dx, dy) * scale < DRAG_PX) return;
        d.dragging = true;
      }
      const moved = { ...d.frame, x: d.frame.x + dx, y: d.frame.y + dy };
      const snap = within > 0 ? snapMove(moved, d.lines, within) : null;
      onChange(d.id, round({ ...moved, x: moved.x + (snap?.dx ?? 0), y: moved.y + (snap?.dy ?? 0) }), false);
      setGuides(snap && (snap.guides.x.length || snap.guides.y.length) ? snap.guides : null);
    } else {
      let frame = resizeFrame({ frame: d.frame }, d.handle, p, { keepRatio: e.shiftKey, min: minSize });
      let shownGuides: Guides | null = null;
      if (within > 0 && !e.shiftKey) {
        const snapped = snapResize(frame, d.handle, d.lines, within);
        frame = snapped.frame;
        shownGuides = snapped.guides.x.length || snapped.guides.y.length ? snapped.guides : null;
      }
      onChange(d.id, round(frame), false);
      setGuides(shownGuides);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setGuides(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d || (d.kind === 'move' && !d.dragging)) return;
    const now = boxes.find((b) => b.id === d.id);
    if (now) onChange(d.id, now.frame, true);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Alt places freely while dragging; on its own it must not open the window's menu bar (Windows).
    if (e.key === 'Alt') {
      e.preventDefault();
      return;
    }
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const arrow = arrows[e.key];
    if (arrow && chosen && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      onChange(
        chosen.id,
        { ...chosen.frame, x: chosen.frame.x + arrow.x, y: chosen.frame.y + arrow.y },
        true,
      );
      return;
    }
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && boxes.length > 0) {
      const at = chosen ? boxes.indexOf(chosen) : e.shiftKey ? boxes.length : -1;
      const next = boxes[at + (e.shiftKey ? -1 : 1)];
      if (next) {
        e.preventDefault();
        onSelect(next.id);
      }
      return;
    }
    if (e.key === 'Escape' && chosen) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(null);
    }
  };

  const px = 1 / scale;
  const status = chosen
    ? `${chosen.name} chosen, at ${Math.round(chosen.frame.x)}, ${Math.round(chosen.frame.y)}, ${Math.round(chosen.frame.width)} by ${Math.round(chosen.frame.height)}`
    : 'Nothing chosen';
  return (
    <div ref={area} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-ink" data-testid={testId}>
      <div
        ref={stage}
        role="application"
        aria-roledescription="canvas"
        aria-label={label}
        aria-describedby={`${testId ?? 'box-canvas'}-status`}
        tabIndex={0}
        data-scale={scale.toFixed(4)}
        data-testid={testId ? `${testId}-stage` : undefined}
        className="absolute touch-none outline-offset-4 select-none"
        style={{ left: (shown.width - width) / 2, top: (shown.height - height) / 2, width, height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size.width,
            height: size.height,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <div data-a11y-picture style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            {picture}
          </div>
          {boxes.map((b) => {
            const on = b.id === selected;
            return (
              <div
                key={b.id}
                data-canvas-box={b.id}
                data-selected={on ? 'true' : undefined}
                style={{
                  position: 'absolute',
                  left: b.frame.x,
                  top: b.frame.y,
                  width: b.frame.width,
                  height: b.frame.height,
                  outline: on
                    ? `${2 * px}px solid var(--color-accent)`
                    : `${px}px dashed rgb(160 169 184 / 0.7)`,
                  pointerEvents: 'none',
                }}
              >
                {on &&
                  HANDLES.map((h) => (
                    <span
                      key={h}
                      data-handle={h}
                      data-testid={`canvas-handle-${h}`}
                      style={{
                        position: 'absolute',
                        left: HANDLE_AT[h].x * b.frame.width - (HANDLE_PX * px) / 2,
                        top: HANDLE_AT[h].y * b.frame.height - (HANDLE_PX * px) / 2,
                        width: HANDLE_PX * px,
                        height: HANDLE_PX * px,
                        background: '#ffffff',
                        border: `${px}px solid var(--color-accent-strong)`,
                        borderRadius: 2 * px,
                        cursor: CURSOR[h],
                        pointerEvents: 'auto',
                      }}
                    />
                  ))}
              </div>
            );
          })}
          {guides?.x.map((x) => (
            <div
              key={`x${x}`}
              data-testid="canvas-guide"
              style={{
                position: 'absolute',
                left: x - px / 2,
                top: 0,
                width: px,
                height: size.height,
                background: 'var(--color-guide)',
                pointerEvents: 'none',
              }}
            />
          ))}
          {guides?.y.map((y) => (
            <div
              key={`y${y}`}
              data-testid="canvas-guide"
              style={{
                position: 'absolute',
                top: y - px / 2,
                left: 0,
                height: px,
                width: size.width,
                background: 'var(--color-guide)',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      </div>
      <p id={`${testId ?? 'box-canvas'}-status`} className="sr-only" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
