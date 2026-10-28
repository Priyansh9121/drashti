import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from '../../ui/Button';
import { useFocusTrap } from '../../ui/Dialog';
import { X } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { useTapNotice } from '../taps';

/*
 * A sheet over the remote for setting up the Drashti computer's things (Session 54, the phone as a full Drashti):
 * full screen on a phone and a tablet, its title and Close at the top, its body scrolling, the safe areas kept
 * (a phone's notch and rounded corners). The keyboard stays in it, Esc closes it, and the phone's own Back closes
 * it as it closes D1's viewer (an entry of its own in the page's history). A tap's refusal (Simple Mode's, say)
 * shows at its top, as the remote's does under it. And a question asked on the phone
 * (Keep these screens?, Turn Audience off?): over everything, its buttons a thumb's size, its safe choice first.
 */

/** Sheets open now, each with its own entry in the page's history. */
let entries = 0;
const sheetEntry = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'drashtiSheet' in state;

/** While a sheet is open, the phone's own Back closes it, and the remote stays. */
function useBackCloses(onClose: () => void): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    entries += 1;
    history.pushState({ drashtiSheet: entries }, '');
    const onPop = (e: PopStateEvent) => {
      if (sheetEntry(e.state)) return;
      close.current();
    };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
      if (sheetEntry(history.state)) history.back();
    };
  }, []);
}

export function PhoneSheet({
  title,
  subtitle,
  onClose,
  testId,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  testId: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const notice = useTapNotice((s) => s.text);
  useFocusTrap(root, onClose);
  useBackCloses(onClose);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex flex-col bg-ink focus:outline-none"
      data-testid={testId}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(0.75rem,env(safe-area-inset-left))]">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-base font-bold text-fg">
            {title}
          </h2>
          {subtitle && <p className="text-base text-muted">{subtitle}</p>}
        </div>
        <Button size="lg" className="min-h-12" icon={X} data-testid={`${testId}-close`} onClick={onClose}>
          Close
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <div className="mx-auto max-w-3xl space-y-6">
          {notice && (
            <Notice
              tone="warning"
              data-testid={`${testId}-notice`}
              onDismiss={() => useTapNotice.setState({ text: null })}
            >
              {notice}
            </Notice>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A question asked on the phone, as the window asks it: its words, then its two answers, the safe one first, Esc
 * giving it. The keyboard starts where the window's own question has it: on the safe one (Cancel), so a stray
 * Enter never does the harmful thing, or on the other where the window's does (Keep these screens?'s Keep).
 */
export function PhoneQuestion({
  title,
  children,
  safe,
  act,
  actVariant = 'danger',
  onSafe,
  onAct,
  testId,
  busy = false,
  focusAct = false,
}: {
  title: string;
  children: ReactNode;
  /** The safe answer's words (Cancel, Go back). */
  safe: string;
  /** The other answer's words (Turn off, Keep). */
  act: string;
  actVariant?: 'danger' | 'primary';
  onSafe: () => void;
  onAct: () => void;
  testId: string;
  busy?: boolean;
  /** The keyboard starts on the other answer, as the window's question has it. */
  focusAct?: boolean;
}) {
  const titleId = useId();
  const textId = useId();
  const root = useRef<HTMLDivElement>(null);
  useFocusTrap(root, onSafe, true);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={root}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        data-testid={testId}
        className="w-[min(28rem,100%)] space-y-4 rounded-xl border border-line-strong bg-panel p-5 text-fg shadow-overlay focus:outline-none"
      >
        <h2 id={titleId} className="text-lg leading-snug font-bold break-words">
          {title}
        </h2>
        <div id={textId} className="space-y-2 text-base text-muted">
          {children}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="min-h-12"
            wrap
            data-autofocus={focusAct ? undefined : true}
            data-testid={`${testId}-safe`}
            onClick={onSafe}
          >
            {safe}
          </Button>
          <Button
            size="lg"
            className="min-h-12"
            wrap
            variant={actVariant}
            disabled={busy}
            data-autofocus={focusAct ? true : undefined}
            data-testid={`${testId}-act`}
            onClick={onAct}
          >
            {act}
          </Button>
        </div>
      </div>
    </div>
  );
}
