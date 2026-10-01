import type { DataAttributes } from './cx';
import { cx } from './cx';

/** How far a long task has got (0 to 1), with what it is. */
export function Progress({
  value,
  label,
  className,
  ...data
}: { value: number; label: string; className?: string } & DataAttributes) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cx('h-1.5 overflow-hidden rounded-full bg-panel-3', className)}
      {...data}
    >
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}
