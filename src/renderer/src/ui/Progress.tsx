import type { DataAttributes } from './cx';
import { cx } from './cx';

/**
 * How far a long task has got (0 to 1), with what it is. `decorative` when words
 * next to it already say how far (inside a button, say): then it is only seen.
 */
export function Progress({
  value,
  label,
  decorative = false,
  className,
  ...data
}: { value: number; label: string; decorative?: boolean; className?: string } & DataAttributes) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const aria = decorative
    ? { 'aria-hidden': true }
    : {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent,
      };
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-panel-3', className)} {...aria} {...data}>
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}
