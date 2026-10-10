import type { ReactNode } from 'react';
import type { DataAttributes } from './cx';
import { cx } from './cx';
import type { Icon } from './icons';
import { Ban, FileQuestion } from './icons';

export type BadgeTone = 'neutral' | 'live' | 'warning' | 'danger' | 'success' | 'info';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-line-strong bg-panel-2 text-muted',
  // The live colour, always with its word (LIVE, BLACK-OUT, ON SCREENS): never colour alone.
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
      Can&apos;t play
    </Badge>
  );
}
