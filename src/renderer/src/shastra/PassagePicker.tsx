import { useEffect, useState } from 'react';
import type { ShastraHit } from '../../../shared/shastra';
import { Button } from '../ui/Button';
import { Field, TextInput } from '../ui/Field';
import { Search } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import { EmptyState } from '../ui/States';

/*
 * Choosing a Shastra passage (Session 12), for a slot that asks for one: by
 * its reference ("SD 14-16"), or by its words.
 */
export function PassagePicker({ onPick }: { onPick: (passageId: string) => void }) {
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ShastraHit[] | null>(null);

  useEffect(() => {
    if (query.trim() === '') return;
    let live = true;
    const timer = setTimeout(() => {
      void window.drashti.shastra.search(query).then((found) => {
        if (live) setHits(found);
      });
    }, 80);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const pickByReference = async () => {
    const result = await window.drashti.shastra.resolve(reference);
    if (result.ok) onPick(result.passage.passageId);
    else setProblem(result.message);
  };

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="passage-picker">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void pickByReference();
        }}
      >
        <Field label="Reference" className="flex-1">
          <TextInput
            data-testid="passage-reference"
            placeholder="SD 14, Vach G.Pr. 1, SD 14-16…"
            spellCheck={false}
            autoFocus
            value={reference}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? 'passage-problem' : undefined}
            onChange={(e) => {
              setReference(e.target.value);
              setProblem(null);
            }}
          />
        </Field>
        <Button type="submit" variant="primary" data-testid="use-passage">
          Use this passage
        </Button>
      </form>
      {problem && (
        <p
          id="passage-problem"
          role="status"
          className="text-xs text-warning-fg"
          data-testid="passage-problem"
        >
          {problem}
        </p>
      )}
      <span className="relative flex items-center">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 text-faint" />
        <TextInput
          type="search"
          aria-label="Search the texts' words"
          placeholder="Or search the words…"
          className="w-full pl-7"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim() === '') setHits(null);
          }}
        />
      </span>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {hits?.length === 0 && (
          <EmptyState icon={Search} title="Nothing found" compact>
            Try fewer letters, or a word in another language.
          </EmptyState>
        )}
        <ul className="space-y-1">
          {(query.trim() === '' ? [] : (hits ?? [])).map((h) => (
            <li key={h.passageId}>
              <button
                type="button"
                className={`${rowClass({})} px-2.5 py-1.5`}
                onClick={() => {
                  onPick(h.passageId);
                }}
              >
                <span className="block truncate text-sm font-medium">{h.reference}</span>
                <span className="block truncate text-xs text-muted">{h.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
