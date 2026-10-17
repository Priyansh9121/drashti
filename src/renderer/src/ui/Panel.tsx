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
  nested = false,
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
  /** Inside a PanelGroup (Session 26a): a sub-heading, set in under the group's. */
  nested?: boolean;
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
      <header className={cx('flex h-9 shrink-0 items-center gap-1 pr-3', nested ? 'pl-6' : 'pl-3')}>
        <Heading
          level={nested ? 3 : 2}
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
              // 24 px tall at least (WCAG 2.5.8): What is this? sits beside it.
              className="-ml-1 flex min-h-6 items-center gap-0.5 rounded-sm px-1 py-0.5 tracking-wider uppercase hover:text-fg"
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
        </Heading>
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

/** A heading of the level given (panels in a group are a level down). */
function Heading({
  level,
  id,
  className,
  children,
}: {
  level: 2 | 3;
  id: string;
  className: string;
  children: ReactNode;
}) {
  return level === 2 ? (
    <h2 id={id} className={className}>
      {children}
    </h2>
  ) : (
    <h3 id={id} className={className}>
      {children}
    </h3>
  );
}

/**
 * Panels together under one heading (Session 26a: Audio holds Music and the Arti; More tools holds Macros,
 * Masks and the Idle rotation, folded away to begin with). It folds as a panel does, and remembers it.
 */
export function PanelGroup({
  title,
  icon: IconShape,
  remember,
  defaultOpen = true,
  help: topic,
  children,
  ...data
}: {
  title: string;
  icon?: Icon;
  /** A name to remember whether it is folded (per computer). */
  remember: string;
  defaultOpen?: boolean;
  /** Its "What is this?" words (Sessions 31–36), as a panel's: shared/panel-help.ts. */
  help?: PanelHelpId;
  children: ReactNode;
} & DataAttributes) {
  const id = useId();
  const help = useWhatIsThis(topic ?? null);
  const [open, setOpen] = usePersistentState<boolean>(
    `group.${remember}.open`,
    defaultOpen,
    (v): v is boolean => typeof v === 'boolean',
  );
  return (
    <section aria-labelledby={`${id}-title`} className="flex min-h-0 flex-col" {...data}>
      <header className="flex h-9 shrink-0 items-center gap-1 px-3">
        <h2 id={`${id}-title`} className="min-w-0 flex-1 text-xs font-bold tracking-wider text-fg uppercase">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? `${id}-body` : undefined}
            data-testid={`group-${remember}-toggle`}
            onClick={() => setOpen(!open)}
            className="-ml-1 flex min-h-6 items-center gap-0.5 rounded-sm px-1 py-0.5 tracking-wider uppercase hover:text-accent"
          >
            {open ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            <span className="flex min-w-0 items-center gap-1.5">
              {IconShape && <IconShape size={14} aria-hidden="true" className="shrink-0 text-muted" />}
              <span className="truncate">{title}</span>
            </span>
          </button>
        </h2>
        {help.button}
      </header>
      {help.card}
      {open && (
        <div id={`${id}-body`} className="divide-y divide-line">
          {children}
        </div>
      )}
    </section>
  );
}

/** A plain line under a group's heading, saying what the panel below is for (More tools). */
export function PanelNote({ children }: { children: ReactNode }) {
  return <p className="px-6 pt-2 text-xs text-muted">{children}</p>;
}
