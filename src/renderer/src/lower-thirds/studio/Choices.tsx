import { useState } from 'react';
import { hasQuickWord, type QuickWord, toggleQuickWord } from '../../../../shared/lower-third-search';
import { cx } from '../../ui/cx';
import { radioKeys, radioTabIndex } from '../../ui/radio';

/* A row of small choices as one radio group (one Tab stop; the arrows move the choice): the studio's (Part 16). */

/** One radio group of small choices. */
export function Choices<T extends string>({
  label,
  choices,
  value,
  names,
  onChoose,
  testId,
  className,
}: {
  label: string;
  choices: readonly T[];
  value: T | null;
  names: Record<T, string>;
  onChoose: (choice: T) => void;
  testId: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted" id={`${testId}-label`}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${testId}-label`}
        className={cx('flex flex-wrap gap-1', className)}
        data-testid={testId}
        onKeyDown={value === null ? undefined : radioKeys(choices, value, onChoose)}
      >
        {choices.map((c, i) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === value}
            tabIndex={radioTabIndex(c === value, i, value !== null)}
            data-choice={c}
            className={cx(
              'min-h-8 rounded-md border px-2.5 py-1 text-left text-sm',
              c === value
                ? 'border-accent bg-panel-3 text-fg'
                : 'border-field bg-panel-2 text-muted hover:text-fg',
            )}
            onClick={() => {
              onChoose(c);
            }}
          >
            {names[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Quick words under a search box (Session 58): one press puts its word in the box (taking the place of another of
 * its group: Slow that of Quick), pressed again takes it out; pressed while the box has it. One Tab stop, the arrows
 * move along them, as a toolbar's.
 */
export function QuickWords({
  words,
  query,
  onQuery,
  testId,
}: {
  words: readonly QuickWord[];
  query: string;
  onQuery: (query: string) => void;
  testId: string;
}) {
  const [stop, setStop] = useState(0);
  return (
    <div
      role="toolbar"
      aria-label="Quick words"
      data-testid={testId}
      className="flex flex-wrap gap-1"
      onKeyDown={(e) => {
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const i = buttons.findIndex((b) => b === document.activeElement);
        const next =
          e.key === 'ArrowRight'
            ? i + 1
            : e.key === 'ArrowLeft'
              ? i - 1
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? buttons.length - 1
                  : null;
        const button = next === null ? undefined : buttons[(next + buttons.length) % buttons.length];
        if (!button) return;
        e.preventDefault();
        button.focus();
      }}
    >
      {words.map((w, i) => {
        const on = hasQuickWord(query, w);
        return (
          <button
            key={w.word}
            type="button"
            aria-pressed={on}
            tabIndex={i === Math.min(stop, words.length - 1) ? 0 : -1}
            data-word={w.word}
            className={cx(
              'min-h-7 rounded-md border px-2 py-0.5 text-xs',
              on ? 'border-accent bg-panel-3 text-fg' : 'border-field bg-panel-2 text-muted hover:text-fg',
            )}
            onFocus={() => {
              setStop(i);
            }}
            onClick={() => {
              onQuery(toggleQuickWord(query, w, words));
            }}
          >
            {w.name}
          </button>
        );
      })}
    </div>
  );
}
