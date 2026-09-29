import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

/*
 * Small menus: one under a button, or one at the pointer (right-click).
 * They close on a choice, a click elsewhere, or Esc.
 */

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export interface MenuPlace {
  x: number;
  y: number;
}

const itemClass =
  'block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-line focus-visible:bg-line focus-visible:outline-none';

/** A menu at a point on the screen, kept inside the window. */
export function Menu({
  at,
  label,
  entries,
  onClose,
}: {
  at: MenuPlace;
  label: string;
  entries: readonly MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({
      x: Math.max(4, Math.min(at.x, window.innerWidth - box.width - 4)),
      y: Math.max(4, Math.min(at.y, window.innerHeight - box.height - 4)),
    });
    ref.current?.querySelector('button')?.focus();
  }, [at]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    const blur = () => {
      close.current();
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', keys, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', keys, true);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const move = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll('button') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={move}
      style={{ position: 'fixed', left: place.x, top: place.y }}
      className="z-50 min-w-44 rounded-md border border-line bg-panel-2 p-1 shadow-xl"
    >
      {entries.map((entry) => (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          className={`${itemClass} ${entry.danger ? 'text-red-300' : ''}`}
          onClick={() => {
            onClose();
            entry.onSelect();
          }}
        >
          {entry.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Where a right-click menu opens: at the pointer, or under the element when opened from the keyboard. */
export function menuPlace(e: ReactMouseEvent): MenuPlace {
  if (e.clientX === 0 && e.clientY === 0) {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: box.left + 8, y: box.bottom };
  }
  return { x: e.clientX, y: e.clientY };
}

/** A button that opens a menu under it. */
export function MenuButton({
  label,
  entries,
  children,
  className = '',
  title,
}: {
  /** The menu's name, for screen readers. */
  label: string;
  entries: readonly MenuEntry[];
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [at, setAt] = useState<MenuPlace | null>(null);
  return (
    <>
      <Button
        tone="ghost"
        className={`px-2 py-1 text-xs ${className}`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={title}
        title={title}
        onClick={(e) => {
          if (at) {
            setAt(null);
            return;
          }
          const box = e.currentTarget.getBoundingClientRect();
          setAt({ x: box.right - 176, y: box.bottom + 4 });
        }}
      >
        {children}
      </Button>
      {at && (
        <Menu
          at={at}
          label={label}
          entries={entries}
          onClose={() => {
            setAt(null);
          }}
        />
      )}
    </>
  );
}
