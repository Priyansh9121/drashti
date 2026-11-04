import { useState } from 'react';
import type { AiLyricReview } from '../../../shared/ai';
import { LANG_NAMES } from '../../../shared/themes';
import { useWords } from '../library/words-store';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Toggle';
import { Notice } from '../ui/Notice';
import { useAi } from './ai-store';
type Open = ReturnType<typeof useWords.getState>['open'];
const history: { open: Open; before: string; after: string }[] = [];
function undoAiLyrics(): boolean {
  const last = history.at(-1);
  const state = useWords.getState();
  if (last?.open !== state.open || last.after !== state.text) return false;
  history.pop();
  useWords.setState({ text: last.before });
  return true;
}
export function AiLyrics() {
  const text = useWords((s) => s.text);
  const open = useWords((s) => s.open);
  const enabled = useAi((s) => s.settings.tidy);
  const pro = useMode((s) => s.mode === 'pro');
  const [review, setReview] = useState<AiLyricReview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!enabled || !pro || open?.mode !== 'new') return null;
  const current = () =>
    useWords.getState().open === open &&
    useWords.getState().text === text &&
    useAi.getState().settings.tidy &&
    useMode.getState().mode === 'pro';
  const ask = async (action: 'breaks' | 'transliteration') => {
    setWaiting(true);
    setProblem(null);
    setReview(null);
    setSelected([]);
    try {
      const result = await window.drashti.ai.lyrics({ source: 'pasted-lyrics', text, action });
      if (current()) {
        if (result.ok) setReview(result.value);
        else setProblem(result.message);
      }
    } catch {
      if (current()) setProblem('The suggestion could not finish. Your words have not changed.');
    } finally {
      setWaiting(false);
    }
  };
  const apply = async () => {
    if (review?.proposal.sourceText !== text) return;
    setWaiting(true);
    setProblem(null);
    try {
      const result = await window.drashti.ai.approveLyrics({ id: review.id, text, selected });
      if (current()) {
        if (result.ok) {
          if (history.at(-1)?.open !== open) history.length = 0;
          history.push({ open, before: text, after: result.value });
          if (history.length > 20) history.shift();
          useWords.setState({ text: result.value });
          setReview(null);
          setSelected([]);
        } else setProblem(result.message);
      }
    } catch {
      if (current()) setProblem('The changes could not be applied. Ask for a new suggestion.');
    } finally {
      setWaiting(false);
    }
  };
  const last = history.at(-1);
  return (
    <section className="shrink-0 space-y-2" aria-label="Import suggestions">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={waiting || text.trim() === ''} onClick={() => void ask('breaks')}>
          Suggest slide breaks
        </Button>
        <Button
          size="sm"
          disabled={waiting || text.trim() === ''}
          onClick={() => void ask('transliteration')}
        >
          Suggest transliteration
        </Button>
        {last?.open === open && last.after === text && (
          <Button
            size="sm"
            onClick={() => {
              undoAiLyrics();
              setReview(null);
            }}
          >
            Undo suggestion
          </Button>
        )}
      </div>
      {waiting && (
        <p role="status" className="text-xs text-muted">
          Checking your pasted words…
        </p>
      )}
      {review?.proposal.sourceText === text && (
        <div
          data-testid="lyric-suggestions"
          className="max-h-44 space-y-2 overflow-y-auto rounded border border-line p-2"
        >
          <p className="text-xs font-bold">
            {review.proposal.language ? LANG_NAMES[review.proposal.language] : 'Language not recognised'} ·
            Choose each change
          </p>
          {review.proposal.changes.length === 0 && (
            <p className="text-xs text-muted">No changes to suggest.</p>
          )}
          {review.proposal.changes.map((change) => (
            <div key={change.id}>
              <Checkbox
                checked={selected.includes(change.id)}
                disabled={waiting}
                label={
                  change.kind === 'break'
                    ? `Split after line ${change.afterLine}`
                    : `Roman letters after line ${change.afterLine}`
                }
                onChange={(e) =>
                  setSelected((value) =>
                    e.target.checked ? [...value, change.id] : value.filter((id) => id !== change.id),
                  )
                }
              />
              <p className="whitespace-pre-wrap pl-6 text-xs text-muted">{change.sourceLine}</p>
              <p className="whitespace-pre-wrap pl-6 text-sm">{change.preview}</p>
            </div>
          ))}
          <Button size="sm" disabled={waiting || selected.length === 0} onClick={() => void apply()}>
            Apply selected changes
          </Button>
        </div>
      )}
      {problem && <Notice tone="danger">{problem}</Notice>}
    </section>
  );
}
