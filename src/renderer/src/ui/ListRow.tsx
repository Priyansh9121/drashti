import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';
import { Truncate } from './Truncate';

/*
 * A row in a list (presentations, playlist items, media, themes, props):
 * a button that can be the one shown (selected), one of several marked,
 * and dragged. It never says "live" by colour: put a LiveBadge in it.
 */

export interface ListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** The row whose content is shown elsewhere (the slides in the middle, the editor). */
  selected?: boolean;
  /** Marked as one of several (Cmd/Ctrl-click, Shift-click). */
  marked?: boolean;
  /** Something being dragged would land on it. */
  dropTarget?: boolean;
  /** The main line: text is cut off neatly and shown in full on hover. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Before the text: an icon, a colour, a drag handle. */
  leading?: ReactNode;
  /** After the text: badges, counts. */
  trailing?: ReactNode;
  density?: 'compact' | 'comfortable';
  ref?: Ref<HTMLButtonElement>;
}

export function rowClass({
  selected = false,
  marked = false,
  dropTarget = false,
}: {
  selected?: boolean;
  marked?: boolean;
  dropTarget?: boolean;
}): string {
  return cx(
    'w-full rounded-md border text-left transition-colors',
    dropTarget
      ? 'border-accent bg-panel-3'
      : selected
        ? 'border-accent/70 bg-panel-3'
        : marked
          ? 'border-line-strong bg-panel-2'
          : 'border-transparent hover:bg-panel-2',
  );
}

export function ListRow({
  selected,
  marked,
  dropTarget,
  title,
  subtitle,
  leading,
  trailing,
  density = 'comfortable',
  className,
  type = 'button',
  ...props
}: ListRowProps) {
  return (
    <button
      type={type}
      className={cx(
        rowClass({ selected, marked, dropTarget }),
        'flex items-center gap-2',
        density === 'compact' ? 'min-h-8 px-2 py-1' : 'min-h-11 px-2.5 py-1.5',
        className,
      )}
      {...props}
    >
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        {typeof title === 'string' ? <Truncate text={title} className="text-sm font-medium" /> : title}
        {subtitle !== undefined && subtitle !== null && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">{subtitle}</span>
        )}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1">{trailing}</span>}
    </button>
  );
}
