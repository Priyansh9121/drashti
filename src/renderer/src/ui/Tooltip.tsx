import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Kbd } from './Kbd';

/*
 * A tooltip: shown on hover (after a moment) and on keyboard focus, hidden by
 * Esc, leaving, or a click. It never takes clicks itself. When it says more
 * than the thing's own label, it is linked to it (aria-describedby); for an
 * IconButton, whose label it repeats, it is not.
 */

const DELAY_MS = 450;

export function Tooltip({
  content,
  kbd,
  side = 'top',
  describes = true,
  children,
}: {
  content: ReactNode;
  kbd?: string | undefined;
  side?: 'top' | 'bottom';
  /** Link it to the element for screen readers (false when it only repeats the element's label). */
  describes?: boolean;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (now: boolean) => {
    clear();
    if (now) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), DELAY_MS);
  };
  const hide = () => {
    clear();
    setOpen(false);
    setPlace(null);
  };
  useEffect(() => clear, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      clear();
      setOpen(false);
      setPlace(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const box = anchor.current?.getBoundingClientRect();
    const own = tip.current?.getBoundingClientRect();
    if (!box || !own) return;
    const fitsAbove = box.top - own.height - 8 > 4;
    const below = side === 'bottom' || !fitsAbove;
    const x = Math.max(
      4,
      Math.min(box.left + box.width / 2 - own.width / 2, window.innerWidth - own.width - 4),
    );
    const y = below ? box.bottom + 6 : box.top - own.height - 6;
    setPlace({ x, y, below });
  }, [open, side, content]);

  const child = describes && open ? cloneElement(children, { 'aria-describedby': id }) : children;
  return (
    <span
      ref={anchor}
      className="inline-flex"
      onPointerEnter={() => show(false)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) show(true);
      }}
      onBlur={hide}
    >
      {child}
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            aria-hidden={describes ? undefined : 'true'}
            style={{
              position: 'fixed',
              left: place?.x ?? -9999,
              top: place?.y ?? -9999,
            }}
            className="pointer-events-none z-[60] flex max-w-72 items-center gap-2 rounded-md border border-line-strong bg-panel-3 px-2 py-1 text-xs text-fg shadow-overlay"
          >
            <span className="break-words">{content}</span>
            {kbd && <Kbd>{kbd}</Kbd>}
          </div>,
          document.body,
        )}
    </span>
  );
}
