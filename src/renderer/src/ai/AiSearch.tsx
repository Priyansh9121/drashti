import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { useMode } from '../operator/mode-store';
import { useSearch } from '../library/library-store';
import { useAi } from './ai-store';
export function AiSearch() {
  const enabled = useAi((s) => s.settings.search);
  const pro = useMode((s) => s.mode === 'pro');
  const query = useSearch((s) => s.query);
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<{ query: string; message: string } | null>(null);
  const version = useRef({ value: 0 });
  useEffect(() => {
    const counter = version.current;
    const off = useSearch.subscribe((next, previous) => {
      if (next.query !== previous.query) counter.value++;
    });
    return () => {
      counter.value++;
      off();
    };
  }, []);
  if (!enabled || !pro) return null;
  const ask = async () => {
    const token = ++version.current.value;
    const requestId = crypto.randomUUID();
    const typed = query;
    setWaiting(true);
    setProblem(null);
    const current = () =>
      token === version.current.value &&
      useMode.getState().mode === 'pro' &&
      useAi.getState().settings.search &&
      useSearch.getState().query === typed;
    const off = window.drashti.ai.onProgress((value) => {
      if (current() && value.requestId === requestId) useSearch.setState({ result: value.result });
    });
    try {
      const result = await window.drashti.ai.search({ query: typed, requestId });
      if (current()) {
        if (result.ok) useSearch.setState({ result: result.value });
        else setProblem({ query: typed, message: result.message });
      }
    } catch {
      if (current())
        setProblem({ query: typed, message: 'Search could not finish. The usual search still works.' });
    } finally {
      off();
      setWaiting(false);
    }
  };
  return (
    <span className="flex max-w-40 flex-col gap-1">
      <Button size="sm" disabled={waiting || query.trim() === ''} onClick={() => void ask()}>
        {waiting ? 'Checking…' : 'Find by meaning'}
      </Button>
      {problem?.query === query && (
        <span role="status" className="text-xs text-muted">
          {problem.message}
        </span>
      )}
    </span>
  );
}
