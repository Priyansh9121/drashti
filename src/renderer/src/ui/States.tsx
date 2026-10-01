import type { ReactNode } from 'react';
import type { DataAttributes } from './cx';
import { cx } from './cx';
import type { Icon } from './icons';
import { CircleAlert, Loader } from './icons';

/** Nothing here yet: what this place is for, and how to fill it. */
export function EmptyState({
  icon: IconShape,
  title,
  children,
  action,
  compact = false,
  className,
  ...data
}: {
  icon?: Icon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
} & DataAttributes) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center text-muted',
        compact ? 'gap-1 px-3 py-4' : 'gap-2 px-6 py-10',
        className,
      )}
      {...data}
    >
      {IconShape && (
        <IconShape size={compact ? 20 : 32} aria-hidden="true" strokeWidth={1.5} className="text-faint" />
      )}
      <p className={cx('font-medium text-fg', compact ? 'text-sm' : 'text-base')}>{title}</p>
      {children && <div className={cx('max-w-sm', compact ? 'text-xs' : 'text-sm')}>{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Waiting for something to arrive. */
export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      className={cx('flex items-center justify-center gap-2 p-4 text-sm text-muted', className)}
    >
      <Loader size={16} aria-hidden="true" className="animate-spin" />
      {label}
    </div>
  );
}

/** Something could not be done or shown: what happened, and a way on. */
export function ErrorState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cx('flex flex-col items-center gap-2 px-6 py-8 text-center', className)}>
      <CircleAlert size={28} aria-hidden="true" className="text-danger" />
      <p className="text-base font-medium text-fg">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}
