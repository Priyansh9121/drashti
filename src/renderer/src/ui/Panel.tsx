import { useId } from 'react';
import type { ReactNode } from 'react';
import type { PanelHelpId } from '../../../shared/panel-help';
import { useWhatIsThis } from '../help/WhatIsThis';
import type { DataAttributes } from './cx';
import { cx } from './cx';
import type { Icon } from './icons';
import { ChevronDown, ChevronRight } from './icons';
import { usePersistentState } from './persist';

/** A small heading over a part of a panel. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cx('text-2xs font-bold tracking-wider text-muted uppercase', className)}>{children}</h3>
  );
}

/**
 * A panel with a header: its title (a heading, which also names the region),
 * an icon, "What is this?" (its words in shared/panel-help.ts) and actions on
 * the right. A collapsible panel folds away to its header, and remembers that
 * when `remember` names it.
 */
export function Panel({
  title,
  icon: IconShape,
  help: topic,
  actions,
  collapsible = false,
  remember,
  defaultOpen = true,
  className,
  bodyClassName,
  children,
  ...data
}: {
  title: string;
  icon?: Icon;
  /** "What is this?": which words of shared/panel-help.ts it opens (every operator panel has some). */
  help?: PanelHelpId;
  actions?: ReactNode;
  collapsible?: boolean;
  /** A name to remember whether it is folded (per computer). */
  remember?: string;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
} & DataAttributes) {
  const id = useId();
  const [open, setOpen] = usePersistentState<boolean>(
    remember ? `panel.${remember}.open` : null,
    defaultOpen,
    (v): v is boolean => typeof v === 'boolean',
  );
  const shown = !collapsible || open;
  const help = useWhatIsThis(topic ?? null);
  const heading = (
    <span className="flex min-w-0 items-center gap-1.5">
      {IconShape && <IconShape size={14} aria-hidden="true" className="shrink-0 text-muted" />}
      <span className="truncate">{title}</span>
    </span>
  );
  return (
    <section aria-labelledby={`${id}-title`} className={cx('flex min-h-0 flex-col', className)} {...data}>
      <header className="flex h-9 shrink-0 items-center gap-1 px-3">
        <h2
          id={`${id}-title`}
          className="min-w-0 flex-1 text-2xs font-bold tracking-wider text-muted uppercase"
        >
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              // Only while the body is there to point at (axe: aria-controls must name an element).
              aria-controls={open ? `${id}-body` : undefined}
              onClick={() => setOpen(!open)}
              className="-ml-1 flex items-center gap-0.5 rounded-sm px-1 py-0.5 tracking-wider uppercase hover:text-fg"
            >
              {open ? (
                <ChevronDown size={14} aria-hidden="true" />
              ) : (
                <ChevronRight size={14} aria-hidden="true" />
              )}
              {heading}
            </button>
          ) : (
            heading
          )}
        </h2>
        {help.button}
        {shown && actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      {help.card}
      {shown && (
        <div id={`${id}-body`} className={cx('min-h-0 flex-1', bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
