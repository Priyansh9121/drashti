import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { QuickWord } from '../../../../shared/lower-third-search';
import { Button } from '../../ui/Button';
import { Field, TextInput } from '../../ui/Field';
import { QuickWords } from './Choices';

/*
 * The studio's one search box (Session 58, the owner: "make finding an animation simple, in the place you pick
 * it"): at the top of where an animation or a template is chosen, the results right there in the list to pick from,
 * changing as you type. Its quick words under it; what it found (or "Nothing matches", with the way back) under
 * those. Esc empties it, and only that (in the templates' window too, which an empty box's Esc closes as before);
 * the down arrow goes from it into what it found.
 */

export function FindBox({
  label,
  query,
  onQuery,
  placeholder,
  testId,
  statusTestId,
  words,
  found,
  nothing,
  where,
  actions,
  onDown,
  autoFocus = false,
}: {
  label: string;
  query: string;
  onQuery: (query: string) => void;
  placeholder: string;
  testId: string;
  statusTestId: string;
  words: readonly QuickWord[];
  /** What it found, in words ("12 templates"). */
  found: string;
  /** Nothing found: "Nothing matches" says so, with Clear the search. */
  nothing: boolean;
  /** Where it looked, when that is not everywhere ("Best 20"). */
  where?: string;
  /** More ways on, beside it (the templates' Look in All templates). */
  actions?: ReactNode;
  /** The down arrow from the box: to what it found. */
  onDown?: () => void;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(onQuery);
  useEffect(() => {
    latest.current = onQuery;
  });
  // Esc empties the box before anything else hears it: a dialog takes Esc as the page's keys come down (Dialog.tsx),
  // so this listens first, on the window. An empty box leaves Esc to them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const box = input.current;
      if (e.key !== 'Escape' || e.isComposing || !box || e.target !== box || box.value === '') return;
      e.preventDefault();
      e.stopPropagation();
      latest.current('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
  const asked = query.trim();
  return (
    <div className="space-y-1.5">
      <Field label={label}>
        <TextInput
          ref={input}
          type="search"
          value={query}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          data-testid={testId}
          {...(autoFocus ? { 'data-autofocus': '' } : {})}
          onChange={(e) => {
            onQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' || e.nativeEvent.isComposing || !onDown) return;
            e.preventDefault();
            onDown();
          }}
        />
      </Field>
      {words.length > 0 && (
        <QuickWords words={words} query={query} onQuery={onQuery} testId={`${testId}-words`} />
      )}
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
        <p role="status" data-testid={statusTestId} className="text-xs text-muted">
          {nothing ? `Nothing matches “${asked}”${where ? ` in ${where}` : ''}.` : found}
        </p>
        {nothing && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onQuery('');
              input.current?.focus();
            }}
          >
            Clear the search
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
