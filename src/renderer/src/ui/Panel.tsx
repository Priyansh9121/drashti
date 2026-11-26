import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PanelHelpId } from '../../../shared/panel-help';
import { useWhatIsThis } from '../help/WhatIsThis';
import type { DataAttributes } from './cx';
import { cx } from './cx';
import type { FoldMove } from './fold';
import { foldArrivalMs, pressFold } from './fold';
import type { Icon } from './icons';
import { ChevronRight } from './icons';
import { openAsks } from './open-asks';
import type { Keep } from './persist';
import { usePersistentState } from './persist';

/** A small heading over a part of a panel, in the appearance's heading colour (Session 42). */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cx('text-2xs font-bold tracking-wider text-heading uppercase', className)}>{children}</h3>
  );
}

/**
 * A section under LIVE (alpha.22; the owner: "by default it should be collapsed, we can uncollapse it when we want"):
 * folded at each start, and kept as the operator leaves it while Drashti runs.
 */
export const LIVE_SECTION = { collapsible: true, defaultOpen: false, keep: 'run' } as const;

/**
 * A panel with a header: its title (a heading, which also names the region),
 * an icon, "What is this?" (its words in shared/panel-help.ts) and actions on
 * the right. A collapsible panel folds away to its header, and remembers that
 * when `remember` names it: on this computer, or while Drashti runs (`keep`).
 */
export function Panel({
  title,
  icon: IconShape,
  help: topic,
  actions,
  badge,
  openAsked = 0,
  collapsible = false,
  remember,
  defaultOpen = true,
  keep = 'computer',
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
  /**
   * A small count beside the title, folded or not (alpha.23: the chat's new messages), part of its name for a screen
   * reader (the toggle's, when it folds).
   */
  badge?: ReactNode;
  /**
   * Asks to unfold it, without moving the keyboard's focus (a chat popup's click), counted: only one made after it
   * mounted unfolds it, once (open-asks.ts).
   */
  openAsked?: number;
  collapsible?: boolean;
  /** A name to remember whether it is folded (per computer, or while Drashti runs: `keep`). */
  remember?: string;
  defaultOpen?: boolean;
  /** How long whether it is folded is remembered. */
  keep?: Keep;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  /** Inside a PanelGroup (Session 26a): a sub-heading, set in under the group's. */
  nested?: boolean;
} & DataAttributes) {
  const id = useId();
  // Opened by its button, its insides arrive: Calm's fade or Lively's unroll (alpha.24, ui/fold.ts; data-fold).
  const [opening, setOpening] = useState<FoldMove | null>(null);
  // The chevron turns only into the state its button's press set moving (the release lead's review, S3).
  const [turnedTo, setTurnedTo] = useState<boolean | null>(null);
  // Once the insides have arrived, how they arrived is forgotten: a change of motion later never plays it again
  // (lead 2's hands-on pass, problem 4: Off, then Calm, faded an open section's insides in with no press).
  useEffect(() => {
    if (opening === null) return;
    const arrived = setTimeout(() => {
      setOpening(null);
    }, foldArrivalMs());
    return () => {
      clearTimeout(arrived);
    };
  }, [opening]);
  const [open, setOpen] = usePersistentState<boolean>(
    remember ? `panel.${remember}.open` : null,
    defaultOpen,
    (v): v is boolean => typeof v === 'boolean',
    keep,
  );
  const section = useRef<HTMLElement>(null);
  // The asks standing as it mounts are old: mounted again, it stays as the operator left it.
  const [asks] = useState(() => openAsks(openAsked));
  useEffect(() => {
    if (!asks.take(openAsked)) return;
    setOpen(true);
    const frame = requestAnimationFrame(() => section.current?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [asks, openAsked, setOpen]);
  const shown = !collapsible || open;
  const help = useWhatIsThis(topic ?? null);
  const heading = (
    <span className="flex min-w-0 items-center gap-1.5">
      {IconShape && <IconShape size={14} aria-hidden="true" className="shrink-0 text-heading" />}
      <span className="truncate">{title}</span>
      {badge}
    </span>
  );
  return (
    <section
      ref={section}
      aria-labelledby={`${id}-title`}
      className={cx('flex min-h-0 flex-col', className)}
      {...data}
    >
      {/* A title strip (Session 44: the appearance's, data-strip), but not a panel's set in under a group's. */}
      <header
        className={cx(
          'flex min-h-9 shrink-0 flex-wrap items-center gap-1 py-1 pr-3',
          nested ? 'pl-6' : 'pl-3',
        )}
        data-strip={nested ? undefined : ''}
      >
        <Heading
          level={nested ? 3 : 2}
          id={`${id}-title`}
          className="min-w-0 flex-1 basis-40 text-2xs font-bold tracking-wider text-heading uppercase"
        >
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              // Only while the body is there to point at (axe: aria-controls must name an element).
              aria-controls={open ? `${id}-body` : undefined}
              data-testid={remember ? `group-${remember}-toggle` : undefined}
              onClick={(e) => {
                const move = pressFold(e.currentTarget, !open, `${id}-body`);
                setOpening(open ? null : move);
                setTurnedTo(move === null ? null : !open);
                setOpen(!open);
              }}
              // 24 px tall at least (WCAG 2.5.8): What is this? sits beside it.
              className="-ml-1 flex min-h-6 max-w-full min-w-0 items-center gap-0.5 rounded-sm px-1 py-0.5 tracking-wider uppercase hover:text-fg"
            >
              {/* It turns as the section folds and unfolds (ui/motion.css). */}
              <FoldChevron open={open} turning={turnedTo === open} />
              {heading}
            </button>
          ) : (
            heading
          )}
        </Heading>
        {help.button}
        {shown && actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      {help.card}
      {shown && (
        <div
          id={`${id}-body`}
          data-fold={opening ?? undefined}
          data-lively={opening === 'lively' ? 'open' : undefined}
          className={cx('min-h-0 flex-1', bodyClassName)}
        >
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * A fold's chevron: pointing right while folded, turned down while open; `turning` while it turns into the state its
 * button's press set moving (ui/motion.css), otherwise it turns at once.
 */
function FoldChevron({ open, turning }: { open: boolean; turning: boolean }) {
  return (
    <ChevronRight
      size={14}
      aria-hidden="true"
      data-fold-chevron=""
      data-turning={turning ? '' : undefined}
      className={open ? 'rotate-90' : undefined}
    />
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
 * Panels together under one heading (Session 26a: Audio holds Music, and its lists since Session 55). It folds as a
 * panel does, and remembers it.
 */
export function PanelGroup({
  title,
  icon: IconShape,
  remember,
  defaultOpen = true,
  keep = 'computer',
  help: topic,
  actions,
  children,
  ...data
}: {
  title: string;
  icon?: Icon;
  /** A name to remember whether it is folded (per computer, or while Drashti runs: `keep`). */
  remember: string;
  defaultOpen?: boolean;
  /** How long whether it is folded is remembered. */
  keep?: Keep;
  /** Its "What is this?" words (Sessions 31–36), as a panel's: shared/panel-help.ts. */
  help?: PanelHelpId;
  /** Buttons at the end of its heading (Session 44: Audio's +). */
  actions?: ReactNode;
  children: ReactNode;
} & DataAttributes) {
  const id = useId();
  const help = useWhatIsThis(topic ?? null);
  // Opened by its button, its insides arrive: Calm's fade or Lively's unroll (alpha.24, ui/fold.ts; data-fold).
  const [opening, setOpening] = useState<FoldMove | null>(null);
  // The chevron turns only into the state its button's press set moving (the release lead's review, S3).
  const [turnedTo, setTurnedTo] = useState<boolean | null>(null);
  // Once the insides have arrived, how they arrived is forgotten: a change of motion later never plays it again
  // (lead 2's hands-on pass, problem 4: Off, then Calm, faded an open section's insides in with no press).
  useEffect(() => {
    if (opening === null) return;
    const arrived = setTimeout(() => {
      setOpening(null);
    }, foldArrivalMs());
    return () => {
      clearTimeout(arrived);
    };
  }, [opening]);
  const [open, setOpen] = usePersistentState<boolean>(
    `group.${remember}.open`,
    defaultOpen,
    (v): v is boolean => typeof v === 'boolean',
    keep,
  );
  return (
    <section aria-labelledby={`${id}-title`} className="flex min-h-0 flex-col" {...data}>
      <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 px-3 py-1" data-strip="">
        <h2
          id={`${id}-title`}
          className="min-w-0 flex-1 basis-40 text-xs font-bold tracking-wider text-fg uppercase"
        >
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? `${id}-body` : undefined}
            data-testid={`group-${remember}-toggle`}
            onClick={(e) => {
              const move = pressFold(e.currentTarget, !open, `${id}-body`);
              setOpening(open ? null : move);
              setTurnedTo(move === null ? null : !open);
              setOpen(!open);
            }}
            className="-ml-1 flex min-h-6 max-w-full min-w-0 items-center gap-0.5 rounded-sm px-1 py-0.5 tracking-wider uppercase hover:text-accent"
          >
            <FoldChevron open={open} turning={turnedTo === open} />
            <span className="flex min-w-0 items-center gap-1.5">
              {IconShape && <IconShape size={14} aria-hidden="true" className="shrink-0 text-muted" />}
              <span className="truncate">{title}</span>
            </span>
          </button>
        </h2>
        {help.button}
        {actions}
      </header>
      {help.card}
      {open && (
        <div
          id={`${id}-body`}
          data-fold={opening ?? undefined}
          data-lively={opening === 'lively' ? 'open' : undefined}
          className="divide-y divide-line"
        >
          {children}
        </div>
      )}
    </section>
  );
}
