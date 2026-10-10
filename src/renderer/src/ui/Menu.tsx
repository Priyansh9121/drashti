import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ButtonSize, ButtonVariant } from './Button';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import type { Icon } from './icons';
import { Kbd } from './Kbd';

/*
 * Small menus: one under a button, or one at the pointer (right-click).
 * They close on a choice, a click elsewhere, or Esc. The arrow keys, Home
 * and End move through the choices, and the one with the focus shows the
 * focus ring. Closing gives the focus back to what opened the menu (unless
 * a choice or a click put it somewhere else), and Esc closes only the menu,
 * never the dialog or editor under it (Session 25).
 */

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  icon?: Icon;
  disabled?: boolean;
  kbd?: string;
  /** A line above this entry, starting a new group. */
  separatorBefore?: boolean;
}

export interface MenuPlace {
  x: number;
  y: number;
}

/** Keys a menu keeps to itself: they move through it, or press a choice, never the show's slides. */
const MENU_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ' ',
  'Enter',
]);

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
  // What had the focus when it opened (read before the first choice takes it).
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useLayoutEffect(
    () => () => {
      // Still in the menu as it goes (or lost): back to what opened it.
      const now = document.activeElement;
      const lost = now === null || now === document.body || (ref.current?.contains(now) ?? false);
      if (lost && opener?.isConnected) opener.focus();
    },
    [opener],
  );

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({
      x: Math.max(4, Math.min(at.x, window.innerWidth - box.width - 4)),
      y: Math.max(4, Math.min(at.y, window.innerHeight - box.height - 4)),
    });
    // The first choice, or (when none can be chosen) the menu itself: the keyboard is always in the
    // menu while it is open, never left on the row where the arrows would move the show.
    (ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])') ?? ref.current)?.focus();
  }, [at]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    // Esc is the menu's alone: heard on the window before anything on the page (a dialog's own Esc,
    // the slide editor's "let go of the selection"), and taken no further.
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      // While it is open, the show's moving keys never act from outside it: back into the menu.
      if (MENU_KEYS.has(e.key) && !ref.current?.contains(e.target as Node)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    const blur = () => {
      close.current();
    };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('keydown', keys, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const move = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      // Tab leaves the menu, as a click elsewhere would.
      close.current();
      return;
    }
    // The menu's own keys never also act on the show (Session 15, and Session 25 for a menu with
    // nothing to choose). Enter presses the choice that has the focus, as a button does; so does
    // Space here, instead of being Next.
    const onChoice = e.target !== ref.current;
    if (onChoice && e.key === ' ') {
      e.preventDefault();
      (e.target as HTMLElement).click();
      return;
    }
    if (MENU_KEYS.has(e.key) && !(onChoice && e.key === 'Enter')) e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === 'ArrowDown') next = (i + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else return;
    buttons[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={move}
      style={{ position: 'fixed', left: place.x, top: place.y }}
      className="z-50 min-w-48 rounded-lg border border-line-strong bg-panel-2 p-1 shadow-overlay"
    >
      {entries.map((entry) => {
        const IconShape = entry.icon;
        return (
          <Fragment key={entry.label}>
            {entry.separatorBefore && <div role="separator" className="my-1 h-px bg-line" />}
            <button
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              className={cx(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-panel-3 focus-visible:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40',
                entry.danger ? 'text-danger' : 'text-fg',
              )}
              onClick={() => {
                onClose();
                entry.onSelect();
              }}
            >
              <span className="flex w-4 shrink-0 justify-center">
                {IconShape && <IconShape size={15} aria-hidden="true" />}
              </span>
              <span className="flex-1">{entry.label}</span>
              {entry.kbd && <Kbd className="text-muted">{entry.kbd}</Kbd>}
            </button>
          </Fragment>
        );
      })}
    </div>,
    document.body,
  );
}

/** Where a menu opened from the keyboard goes: under the element. */
export function menuBelow(el: Element): MenuPlace {
  const box = el.getBoundingClientRect();
  return { x: box.left + 8, y: box.bottom };
}

/** Where a right-click menu opens: at the pointer, or under the element when opened from the keyboard. */
export function menuPlace(e: ReactMouseEvent): MenuPlace {
  if (e.clientX === 0 && e.clientY === 0) return menuBelow(e.currentTarget);
  return { x: e.clientX, y: e.clientY };
}

/**
 * Shift+F10 or the Menu key: a row's right-click menu from the keyboard.
 * Chromium turns them into a right-click by itself only on Windows (and the
 * Mac has neither), so rows with a menu ask for it themselves (Session 15).
 */
export function isMenuKey(e: ReactKeyboardEvent): boolean {
  if (e.key === 'ContextMenu') return !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  return e.key === 'F10' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
}

/** A button that opens a menu under it: with words, or (icon and no words) an icon button. */
export function MenuButton({
  label,
  entries,
  children,
  icon,
  variant = 'ghost',
  size = 'sm',
  className = '',
  title,
}: {
  /** The menu's name, for screen readers. */
  label: string;
  entries: readonly MenuEntry[];
  children?: ReactNode;
  icon?: Icon;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** The button's label when it is only an icon (and its tooltip). */
  title?: string;
}) {
  const [at, setAt] = useState<MenuPlace | null>(null);
  const toggle = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (at) {
      setAt(null);
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    setAt({ x: box.right - 192, y: box.bottom + 4 });
  };
  const common = {
    'aria-haspopup': 'menu' as const,
    'aria-expanded': at !== null,
    onClick: toggle,
    className,
  };
  return (
    <>
      {icon && children === undefined ? (
        <IconButton icon={icon} label={title ?? label} variant={variant} size={size} {...common} />
      ) : (
        <Button variant={variant} size={size} icon={icon} aria-label={title} title={title} {...common}>
          {children}
        </Button>
      )}
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
