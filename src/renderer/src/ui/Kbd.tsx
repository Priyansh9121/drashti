import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A key hint, such as "F1" or "⌘⇧S". It takes the colour of the text around
 * it, so it stays readable on every button.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex min-w-5 items-center justify-center rounded-sm border border-current/40 px-1 text-2xs leading-4 font-medium',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
