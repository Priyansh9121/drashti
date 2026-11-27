import type { ReactNode } from 'react';
import type { DataAttributes } from './cx';
import { cx } from './cx';
import type { Icon } from './icons';
import { Ban, FileQuestion } from './icons';

export type BadgeTone = 'neutral' | 'live' | 'warning' | 'danger' | 'success' | 'info';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-line-strong bg-panel-2 text-muted',
  // The live colour, always with its word (LIVE, BLACK-OUT, ON THE SCREENS): never colour alone.
  live: 'border-live bg-live text-white',
  warning: 'border-warning/60 bg-warning-bg text-warning-fg',
  danger: 'border-danger/60 bg-danger-bg text-danger-fg',
  success: 'border-success/60 bg-success-bg text-success-fg',
  info: 'border-accent/60 bg-panel-2 text-fg',
};

/** A short label on a row or a heading: a state in words, with its colour and maybe an icon. */
export function Badge({
  tone = 'neutral',
  icon: IconShape,
  title,
  children,
  className,
  ...data
}: {
  tone?: BadgeTone;
  icon?: Icon;
  title?: string;
  children: ReactNode;
  className?: string;
} & DataAttributes) {
  return (
    <span
      title={title}
      data-badge
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 text-2xs leading-4 font-bold tracking-wide whitespace-nowrap uppercase',
        tones[tone],
        className,
      )}
      {...data}
    >
      {IconShape && <IconShape size={11} aria-hidden="true" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

/** On the screens now. */
export function LiveBadge({ label = 'Live', className }: { label?: string; className?: string }) {
  return (
    <Badge tone="live" className={className}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white" />
      {label}
    </Badge>
  );
}

/**
 * A playlist's row on the screens now (alpha.24, uitop: LIVE is said once, in words, by the top bar's badge): a small
 * dot in LIVE's frame colour beside the row's red edge, and "Live" for screen readers, so the row reads as before. Only
 * the row that is up has one: its being there says it, never its colour alone. In forced colours (a Windows contrast
 * theme) the dot and the edge, backgrounds, are the system's own colour, so the word Live is seen there in their place,
 * in the theme's text colour (the release lead's review, MUST-1).
 */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span data-live-dot="" className={cx('flex h-4 min-w-4 shrink-0 items-center justify-center', className)}>
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-live-edge forced-colors:hidden" />
      <span className="sr-only forced-colors:not-sr-only forced-colors:text-xs forced-colors:font-bold">
        Live
      </span>
    </span>
  );
}

/**
 * A row's red edge at its start while it is up (alpha.24, uitop), with its LiveDot: decoration only (hidden from screen
 * readers), absolute in the row (which is relative), so nothing in the row moves as it comes or goes.
 */
export function LiveEdge() {
  return (
    <span
      aria-hidden="true"
      data-live-edge=""
      className="pointer-events-none absolute inset-y-1.5 left-0.5 w-[3px] rounded-full bg-live-edge"
    />
  );
}

/** A file the library cannot find. */
export function MissingBadge({ title }: { title?: string }) {
  return (
    <Badge tone="warning" icon={FileQuestion} title={title}>
      Missing
    </Badge>
  );
}

/** A file Drashti cannot play yet (see the import report). */
export function UnplayableBadge({ title }: { title?: string }) {
  return (
    <Badge tone="warning" icon={Ban} title={title} data-testid="badge-unplayable">
      Can’t play
    </Badge>
  );
}
