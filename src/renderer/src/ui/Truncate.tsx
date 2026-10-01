import type { DataAttributes } from './cx';
import { cx } from './cx';

/**
 * Text cut off with an ellipsis when it does not fit, shown in full on hover
 * (and always read in full by screen readers). Leaves room above and below
 * for Gujarati and Devanagari marks.
 */
export function Truncate({
  text,
  className,
  ...data
}: { text: string; className?: string } & DataAttributes) {
  return (
    <span title={text} className={cx('block min-w-0 truncate leading-normal', className)} {...data}>
      {text}
    </span>
  );
}
