import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { DataAttributes } from './cx';
import { cx } from './cx';

/*
 * The handle between two panels. Drag it, or focus it and use the arrow
 * keys (Shift for bigger steps), Home and End; Enter or a double-click puts
 * the default size back. `value` is the size of the panel it resizes, and
 * `grow` says which way makes that panel bigger.
 */

const STEP = 16;
const BIG_STEP = 64;

export function Splitter({
  value,
  onChange,
  min,
  max,
  defaultValue,
  label,
  orientation = 'vertical',
  grow = 1,
  className,
  ...data
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  defaultValue: number;
  /** What it resizes, for screen readers ("Resize the library"). */
  label: string;
  /** vertical: a handle between columns (moves left and right); horizontal: between rows. */
  orientation?: 'vertical' | 'horizontal';
  /** 1: moving right (or down) makes the panel bigger; -1: smaller. */
  grow?: 1 | -1;
  className?: string;
} & DataAttributes) {
  const drag = useRef<{ from: number; start: number } | null>(null);
  const clamp = (n: number) => Math.round(Math.min(max, Math.max(min, n)));
  const at = (e: PointerEvent) => (orientation === 'vertical' ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { from: at(e), start: value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    onChange(clamp(d.start + (at(e) - d.from) * grow));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    const less = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const more = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    let next: number | null = null;
    if (e.key === less) next = value - step * grow;
    else if (e.key === more) next = value + step * grow;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key === 'Enter') next = defaultValue;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(clamp(next));
  };

  const vertical = orientation === 'vertical';
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onChange(clamp(defaultValue))}
      onKeyDown={onKeyDown}
      className={cx(
        'group relative z-10 shrink-0 touch-none',
        vertical ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize',
        className,
      )}
      {...data}
    >
      <span
        aria-hidden="true"
        className={cx(
          'absolute bg-line transition-colors group-hover:bg-accent/70 group-focus-visible:bg-accent group-active:bg-accent',
          // With the keyboard on it, the line thickens inside the usual focus ring.
          vertical
            ? 'inset-y-0 left-1/2 w-px -translate-x-1/2 group-focus-visible:w-[3px]'
            : 'inset-x-0 top-1/2 h-px -translate-y-1/2 group-focus-visible:h-[3px]',
        )}
      />
    </div>
  );
}
