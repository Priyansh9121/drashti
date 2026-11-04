import { useState } from 'react';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { Field, TextInput } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Checkbox } from '../ui/Toggle';
import { setSpeechHelper, useSpeechHelpers } from './speech-store';

export function SpeechHelperSwitches() {
  const { settings, saving } = useSpeechHelpers();
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <Checkbox
        label="Book references"
        checked={settings.books}
        disabled={saving}
        onChange={(e) => void setSpeechHelper('books', e.target.checked)}
      />
      <p className="text-xs text-muted">
        Exact words and meaning in the Books loaded here. A passage goes on the screens only when you press
        Show passage.
      </p>
      <Checkbox
        label="Follow singing (Trial)"
        checked={settings.verse}
        disabled={saving}
        onChange={(e) => void setSpeechHelper('verse', e.target.checked)}
      />
      <p className="text-xs text-muted">
        When the heard words match the current kirtan verse, review Next and press it yourself.
      </p>
      <p className="text-xs text-muted">
        Listening uses Part 10’s stream sound input and its Live Captions switch. These helpers never turn it
        on for you.
      </p>
    </div>
  );
}
export function SpeechHelperPanel() {
  const state = useSpeechHelpers();
  const pro = useMode((s) => s.mode === 'pro');
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!pro || (!state.settings.books && !state.settings.verse)) return null;
  const choose = async (request: Promise<{ ok: boolean; message?: string }>) => {
    setProblem(null);
    const result = await request;
    if (!result.ok) setProblem(result.message ?? 'The suggestion is no longer current.');
  };
  return (
    <section aria-label="Speech helpers" className="mx-3 mt-3 rounded border border-line p-3 text-sm">
      <h2 className="font-semibold">Speech helpers</h2>
      <p className="text-xs text-muted">
        {state.listening === 'listening'
          ? 'Listening through Part 10. Suggestions stay here.'
          : state.listening === 'off'
            ? 'Listening is off. Typed Book search still works.'
            : 'Listening is waiting. The show comes first.'}
      </p>
      {state.settings.books && (
        <div className="mt-2 space-y-2">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setAsking(true);
              setProblem(null);
              void window.drashti.aiSpeech
                .search({ query })
                .then((result) => {
                  if (!result.ok) setProblem(result.message);
                })
                .catch(() => setProblem('The helper could not finish.'))
                .finally(() => setAsking(false));
            }}
          >
            <Field label="Look in loaded Books" className="min-w-0 flex-1">
              <TextInput value={query} maxLength={500} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" disabled={asking || !query.trim()}>
              Find in Books
            </Button>
          </form>
          {state.books?.checking && (
            <p role="status">Exact matches first. Checking meaning in loaded Books…</p>
          )}
          {state.books && !state.books.checking && state.books.hits.length === 0 && (
            <p role="status">No good match in the loaded Books.</p>
          )}
          <ul className="max-h-44 space-y-2 overflow-y-auto">
            {state.books?.hits.map((hit) => (
              <li key={hit.passageId} data-testid="ai-book-hit" className="rounded border border-line p-2">
                <p className="font-semibold">{hit.reference}</p>
                <p className="whitespace-pre-wrap">{hit.snippet}</p>
                <Button
                  size="sm"
                  onClick={() =>
                    void choose(
                      window.drashti.aiSpeech.showBook({ id: state.books?.id, passageId: hit.passageId }),
                    )
                  }
                >
                  Show passage — {hit.reference}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.settings.verse && (
        <div className="mt-2 space-y-2">
          <p className="font-semibold">Follow singing · Trial</p>
          {state.verse ? (
            <>
              <p>{state.verse.label}</p>
              <Button
                size="sm"
                onClick={() => void choose(window.drashti.aiSpeech.nextVerse(state.verse?.id))}
              >
                Next suggested verse
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted">
              Waiting for a clear match to the verse on LIVE. Next always stays your choice.
            </p>
          )}
        </div>
      )}
      {(problem ?? state.problem) && <Notice tone="warning">{problem ?? state.problem}</Notice>}
    </section>
  );
}
