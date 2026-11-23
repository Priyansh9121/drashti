import type { ReactNode } from 'react';
import { cx } from '../ui/cx';

/*
 * The parts of the slide editor's groups along its top (Session 55, Part 17a): each group a row of clusters of tools,
 * a cluster named under it (small) and for screen readers, thin lines between them.
 */

/**
 * A group's row of clusters: onto a second row where the window is narrower than they are, never scrolling sideways
 * (alpha.21's fit pass: at the window's least, 900 wide with its frame, Words, Arrange and Motion ran 100 px and more
 * past the window, out of reach but by scrolling the row).
 */
export const GROUP_ROW = 'flex min-w-0 flex-wrap items-start gap-y-1';

/** A cluster of a group's tools. */
export function Cluster({
  name,
  children,
  className,
}: {
  name: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={name}
      className={cx('flex shrink-0 flex-col items-center gap-0.5', className)}
    >
      <div className="flex items-center gap-1">{children}</div>
      <span aria-hidden="true" className="text-2xs leading-none whitespace-nowrap text-faint">
        {name}
      </span>
    </div>
  );
}

/** A thin line between clusters. */
export function Divider() {
  return <span aria-hidden="true" className="mx-1 h-9 w-px shrink-0 bg-line" />;
}
