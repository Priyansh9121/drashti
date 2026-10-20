import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { Button } from './Button';
import { Trash2, X } from './icons';

/*
 * Choosing many at once, in every list that deletes (Session 44; Priyansh: "i should be able to select via arrow
 * drag and scroll via select drag arrow and delete multiple stuff at once"): a box dragged with the mouse from
 * an empty place in the list (it scrolls the list by itself near its top or bottom edge), Shift-click for a
 * range and Cmd-click (Ctrl-click) for one more, as each list already had, and Cmd-A (Ctrl-A). Delete,
 * Backspace or the Delete button then removes them all at once, with one Undo. A box never starts on a row, a
 * button or a show control, and chooses only the rows of its own list. The lists are lists of buttons, not
 * listboxes (whose arrow keys would take the show's), so how many are chosen is said by a status line, and
 * each row says whether it is chosen itself.
 */

/** A rectangle in a list's content (its scrolled-away part included), in CSS pixels. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Where an element lies in a list's content. */
export function inContent(list: HTMLElement, el: Element): Box {
  const l = list.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const dx = list.scrollLeft - l.left;
  const dy = list.scrollTop - l.top;
  return { top: r.top + dy, bottom: r.bottom + dy, left: r.left + dx, right: r.right + dx };
}

const touches = (a: Box, b: Box) =>
  a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;

/** The rows (marked with data-select-id) a box touches, from those drawn: for a list that draws every row. */
export function rowsTouching(list: HTMLElement, box: Box): string[] {
  const out: string[] = [];
  for (const el of list.querySelectorAll<HTMLElement>('[data-select-id]')) {
    const id = el.dataset['selectId'];
    if (id !== undefined && touches(inContent(list, el), box)) out.push(id);
  }
  return out;
}

/** The rows of a list that draws only those in view (ui/virtual.ts): from their places, drawn or not. */
export function laidOutTouching(
  ids: readonly (string | null)[],
  offsets: readonly number[],
  heights: readonly number[],
  box: Box,
): string[] {
  const out: string[] = [];
  ids.forEach((id, i) => {
    const top = offsets[i] ?? 0;
    if (id !== null && top + (heights[i] ?? 0) > box.top && top < box.bottom) out.push(id);
  });
  return out;
}

/** Near the list's top or bottom edge (this far in), a box being dragged scrolls it; at the very edge this fast. */
const EDGE = 32;
const FASTEST = 18;
/** A press moves this far before it is a box (less is a click). */
const SLOP = 4;

/** A box starts only on an empty place in the list: never on a row, a control, a field or a show control. */
const emptyPlace = (list: HTMLElement, target: EventTarget | null): boolean =>
  target instanceof Element &&
  list.contains(target) &&
  target.closest(
    'button, a, input, select, textarea, label, [role="button"], [contenteditable="true"], [data-select-id], [data-show-control]',
  ) === null;

export function useBoxSelect({
  list,
  hits,
  begin,
  onBox,
  onClear,
}: {
  list: RefObject<HTMLElement | null>;
  /** The rows a box touches. */
  hits: (box: Box) => string[];
  /** A box starts (what was chosen then is what `adding` adds to). */
  begin?: () => void;
  /** As the box grows: the rows it touches, and whether Cmd/Ctrl or Shift was held (to add to what was chosen). */
  onBox: (ids: string[], adding: boolean) => void;
  /** A click on an empty place (no box): nothing chosen any more. */
  onClear?: () => void;
}): { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void; box: Box | null } {
  const [box, setBox] = useState<Box | null>(null);
  const live = useRef({ hits, begin, onBox, onClear });
  useEffect(() => {
    live.current = { hits, begin, onBox, onClear };
  });
  const drag = useRef<{
    from: { x: number; y: number };
    at: { x: number; y: number };
    adding: boolean;
    moved: boolean;
    frame: number;
    stop: () => void;
  } | null>(null);
  useEffect(
    () => () => {
      drag.current?.stop();
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const el = list.current;
    if (!el || e.button !== 0 || !emptyPlace(el, e.target)) return;
    // No text is selected, and the keyboard comes to the list (Cmd-A, Delete).
    e.preventDefault();
    el.focus({ preventScroll: true });
    const point = (x: number, y: number) => ({
      x: Math.min(Math.max(x - el.getBoundingClientRect().left + el.scrollLeft, 0), el.scrollWidth),
      y: Math.min(Math.max(y - el.getBoundingClientRect().top + el.scrollTop, 0), el.scrollHeight),
    });
    const update = () => {
      const d = drag.current;
      if (!d) return;
      const now = point(d.at.x, d.at.y);
      const b = {
        top: Math.min(d.from.y, now.y),
        bottom: Math.max(d.from.y, now.y),
        left: Math.min(d.from.x, now.x),
        right: Math.max(d.from.x, now.x),
      };
      setBox(b);
      live.current.onBox(live.current.hits(b), d.adding);
    };
    // Near the top or bottom edge the list scrolls, a frame at a time, and the box follows.
    const scroll = () => {
      const d = drag.current;
      if (!d) return;
      const r = el.getBoundingClientRect();
      const up = r.top + EDGE - d.at.y;
      const down = d.at.y - (r.bottom - EDGE);
      const step = up > 0 ? -Math.min(FASTEST, up / 2) : down > 0 ? Math.min(FASTEST, down / 2) : 0;
      if (d.moved && step !== 0) {
        const was = el.scrollTop;
        el.scrollTop = was + step;
        if (el.scrollTop !== was) update();
      }
      d.frame = requestAnimationFrame(scroll);
    };
    const move = (m: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.at = { x: m.clientX, y: m.clientY };
      if (!d.moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < SLOP) return;
      if (!d.moved) live.current.begin?.();
      d.moved = true;
      update();
    };
    const up = () => {
      const d = drag.current;
      if (!d) return;
      d.stop();
      if (!d.moved) live.current.onClear?.();
    };
    const stop = () => {
      const d = drag.current;
      drag.current = null;
      if (d) cancelAnimationFrame(d.frame);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      setBox(null);
    };
    drag.current = {
      from: point(e.clientX, e.clientY),
      at: { x: e.clientX, y: e.clientY },
      adding: e.metaKey || e.ctrlKey || e.shiftKey,
      moved: false,
      frame: requestAnimationFrame(scroll),
      stop,
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return { onPointerDown, box };
}

/** The box being dragged, drawn in the list's content (the list is `relative`); an `li` inside a list. */
export function BoxOverlay({ box, as: Tag = 'div' }: { box: Box | null; as?: 'div' | 'li' }): ReactNode {
  if (!box) return null;
  return (
    <Tag
      aria-hidden="true"
      data-testid="select-box"
      className="pointer-events-none absolute z-10 rounded-sm border border-accent bg-accent/15"
      style={{ top: box.top, left: box.left, width: box.right - box.left, height: box.bottom - box.top }}
    />
  );
}

/** What a box chooses: the rows it touches, added to what was chosen as it started when `adding`. */
export function boxChoice(before: readonly string[], touched: readonly string[], adding: boolean): string[] {
  return adding ? [...new Set([...before, ...touched])] : [...touched];
}

/** Cmd-A (Ctrl-A on Windows and Linux): every row of the list. */
export function isSelectAll(e: KeyboardEvent, platform: string): boolean {
  const mod = platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a';
}

/**
 * Over a list with more than one chosen: how many, Delete for them all (one Undo) and Clear. Its status line
 * says the count to a screen reader as it changes.
 */
export function ChosenBar({
  count,
  noun,
  onDelete,
  onClear,
  deleteLabel = 'Delete',
}: {
  count: number;
  noun: string;
  onDelete: () => void;
  onClear: () => void;
  deleteLabel?: string;
}) {
  const said = count > 1 ? `${String(count)} ${noun} chosen` : '';
  return (
    <>
      <p role="status" className="sr-only" data-testid="chosen-said">
        {said}
      </p>
      {count > 1 && (
        <div data-testid="chosen-bar" className="flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs">
          <span className="min-w-0 flex-1 truncate font-medium">{said}</span>
          <Button size="sm" variant="danger" icon={Trash2} data-testid="chosen-delete" onClick={onDelete}>
            {deleteLabel}
          </Button>
          <Button size="sm" variant="ghost" icon={X} data-testid="chosen-clear" onClick={onClear}>
            Clear
          </Button>
        </div>
      )}
    </>
  );
}
