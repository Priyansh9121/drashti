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
