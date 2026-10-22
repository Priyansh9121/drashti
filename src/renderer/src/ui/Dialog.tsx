import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ButtonVariant } from './Button';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import { DialogStack } from './dialog-stack';
import { X } from './icons';
import { useArrival, useLeaving } from './motion';

/*
 * Dialogs. While one is open the keyboard stays inside it (Tab wraps round),
 * Esc closes it, and focus goes back where it was when it closes. The show's
 * keys are ignored meanwhile (useKeymap looks for aria-modal). A dialog
 * opened from another one takes over until it closes, unless the one open is
 * on top (Keep these screens?, Session 51): that one stays above every other,
 * with the keyboard, and a dialog opened meanwhile goes under it.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Trap {
  readonly onTop: boolean;
  readonly root: HTMLElement;
  /** Where the keyboard goes back as it closes. */
  before: HTMLElement | null;
  /** Its own first control (or the one marked data-autofocus) takes the keyboard, unless one of its own has it. */
  focusFirst(): void;
}

/** The open dialogs, innermost last: only that one holds the keyboard. */
const stack = new DialogStack<Trap>();

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Keep the keyboard inside `ref` while it is open; Esc calls onEscape. `onTop`: it keeps the keyboard until it
 * closes, whatever opens meanwhile (that goes under it, and focus that lands there comes back).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  onEscape: (() => void) | null,
  onTop = false,
): void {
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const focusFirst = () => {
      // Something inside (autoFocus) may have taken the focus already; otherwise the first control.
      if (root.contains(document.activeElement)) return;
      const preferred = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0] ?? root;
      preferred.focus();
    };
    const trap: Trap = {
      onTop,
      root,
      before: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      focusFirst,
    };
    // On top: where the keyboard was in it, given back when focus lands outside it while it is innermost (a
    // dialog opened meanwhile, its autoFocus). Followed from before it takes the keyboard.
    let lastFocused: HTMLElement | null = null;
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (root.contains(e.target)) {
        lastFocused = e.target;
        return;
      }
      if (stack.innermost() !== trap) return;
      if (lastFocused?.isConnected) lastFocused.focus();
      else focusFirst();
    };
    if (onTop) document.addEventListener('focusin', onFocusIn, true);
    if (stack.push(trap)) focusFirst();
    // Opened under one on top: the keyboard stays there and comes here as that one closes; as this one closes,
    // it goes back where it was before that one opened.
    else trap.before = stack.innermost()?.before ?? null;
    const onKey = (e: KeyboardEvent) => {
      if (stack.innermost() !== trap) return;
      if (e.key === 'Escape' && escape.current) {
        e.preventDefault();
        e.stopPropagation();
        escape.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const all = focusables(root);
      const first = all[0];
      const last = all.at(-1);
      if (!first || !last) {
        e.preventDefault();
        root.focus();
        return;
      }
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (onTop) document.removeEventListener('focusin', onFocusIn, true);
      const { held, next } = stack.remove(trap);
      // Only the one holding the keyboard gives it back: where it was, or else to the dialog left under it.
      if (!held) return;
      const before = trap.before;
      if (before?.isConnected && (!next || next.root.contains(before))) before.focus();
      else next?.focusFirst();
    };
  }, [ref, onTop]);
}

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const widths: Record<DialogSize, string> = {
  sm: 'w-[min(28rem,100%)]',
  md: 'w-[min(40rem,100%)]',
  lg: 'w-[min(56rem,100%)]',
  xl: 'w-[min(64rem,100%)]',
  /** Editors with a canvas: as wide and tall as the window allows. */
  full: 'h-[min(56rem,100%)] w-[min(96rem,100%)]',
};

export function Dialog({
  title,
  subtitle,
  onClose,
  closeLabel = 'Close',
  closeButton = true,
  size = 'md',
  placement = 'center',
  role = 'dialog',
  headerActions,
  footer,
  children,
  bodyClassName,
  titleWraps = false,
  bodyFocusable = false,
  describedBy,
  className,
  testId,
  panelTestId,
  onTop = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Esc and the close button; null: it closes only through its own buttons. */
  onClose: (() => void) | null;
  /** The close button's label ("Close screens"). */
  closeLabel?: string;
  /** Show the close button (Esc still closes when onClose is given). */
  closeButton?: boolean;
  size?: DialogSize;
  /** In the middle, or a sheet along the right edge (for settings next to the show). */
  placement?: 'center' | 'right';
  role?: 'dialog' | 'alertdialog';
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  /** The title wraps onto more lines instead of being cut off (a question naming something long). */
  titleWraps?: boolean;
  /** Its body is text only and may scroll: it takes the focus, so the keyboard can scroll it. */
  bodyFocusable?: boolean;
  /** The id of the text that explains it (alert dialogs). */
  describedBy?: string;
  className?: string;
  /** data-testid on the dialog element (the one with the role). */
  testId?: string;
  /** data-testid on the visible panel inside it. */
  panelTestId?: string;
  /**
   * Above every other dialog, with the keyboard, until it closes (Keep these screens?, Session 51): one opened
   * meanwhile goes under it, so its Enter and Esc still answer it.
   */
  onTop?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, onClose, onTop);
  const right = placement === 'right';
  // It arrives (the dim fades, the dialog rises 8 px or a sheet slides 16 px) and leaves as quickly.
  const backdrop = useLeaving<HTMLDivElement>(right ? 'sheet' : 'dialog');
  const scrim = useArrival('scrim');
  const arriving = useArrival(right ? 'sheet' : 'dialog');
  return createPortal(
    <div
      ref={backdrop}
      data-motion={scrim}
      className={cx(
        'fixed inset-0 flex bg-black/60',
        onTop ? 'z-50' : 'z-40',
        right ? 'justify-end' : 'items-center justify-center p-4',
      )}
    >
      <div
        ref={panel}
        data-motion={arriving}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-testid={testId}
        className={cx(
          'flex flex-col border-line-strong bg-panel text-fg shadow-overlay focus:outline-none',
          right ? 'h-full border-l' : 'max-h-full rounded-xl border',
          widths[size],
          className,
        )}
      >
        <div data-testid={panelTestId} className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className={cx('text-lg leading-snug font-bold', titleWraps ? 'break-words' : 'truncate')}
              >
                {title}
              </h2>
              {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
            </div>
            {headerActions && <div className="flex shrink-0 items-center gap-2">{headerActions}</div>}
            {onClose && closeButton && (
              <IconButton icon={X} label={closeLabel} onClick={onClose} tooltipSide="bottom" />
            )}
          </header>
          <div
            className={cx('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}
            {...(bodyFocusable ? { tabIndex: 0, role: 'region', 'aria-labelledby': titleId } : {})}
          >
            {children}
          </div>
          {footer && (
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * "Remove this?": the question, what will happen, and Cancel (which has the
 * focus, so Enter or Esc never does the harmful thing) next to the action.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  confirmVariant = 'danger',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  testId,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  const textId = useId();
  return (
    <Dialog
      title={title}
      role="alertdialog"
      size="sm"
      onClose={onCancel}
      closeButton={false}
      describedBy={textId}
      testId={testId}
      footer={
        <>
          <Button data-autofocus onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div id={textId} className="space-y-2 text-sm text-muted">
        {children}
      </div>
    </Dialog>
  );
}
