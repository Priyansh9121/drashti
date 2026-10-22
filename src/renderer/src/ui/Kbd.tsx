import { Fragment } from 'react';
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
        'inline-flex min-w-5 items-center justify-center rounded-xs border border-current/40 px-1 text-2xs leading-4 font-medium',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * A button's words with its keys under them (Session 51), "or" between two: every key it answers to shown on a
 * button too narrow for them beside its words (the layer bar below 1440 px, Simple Mode's Black-out, Logo, Clear
 * all and Put it back). `besideFrom1440` puts them after the words from 1440 px wide instead, where the layer bar
 * has room. A key that does not act now is left out by the caller; an empty one shows nothing.
 */
export function WordsOverKeys({
  words,
  keys,
  besideFrom1440 = false,
}: {
  words: string;
  keys: readonly string[];
  besideFrom1440?: boolean;
}) {
  const shown = keys.filter((k) => k !== '');
  return (
    <span
      className={cx(
        'flex flex-col items-center',
        besideFrom1440 && 'min-[1440px]:flex-row min-[1440px]:gap-3',
      )}
    >
      {words}
      {shown.length > 0 && (
        <span className="flex items-center gap-1" data-keys="">
          {shown.map((k, i) => (
            <Fragment key={k}>
              {i > 0 && <span className="text-xs">or</span>}
              <Kbd>{k}</Kbd>
            </Fragment>
          ))}
        </span>
      )}
    </span>
  );
}
