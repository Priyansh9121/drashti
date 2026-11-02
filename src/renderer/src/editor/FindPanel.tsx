import { useMemo, useState } from 'react';
import { slidesOf } from '../../../shared/slide-edit';
import { Button, IconButton } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { CaseSensitive, ChevronDown, ChevronUp, WholeWord, X } from '../ui/icons';
import { commit, select, showSlide, useEditor } from './editor-store';
import { findMatches, matchContext, replaceMatches } from './find-replace';
import { finishTextEditing } from './TextBoxEditor';

/*
 * Find and replace across the presentation (Session 55, Part 17a, the Words group): over the slide, at the top of its
 * area, while the slides are edited. The words looked for are counted across every slide ("2 of 5"); Next and
 * Previous go to each, showing its slide and choosing its text box, with its words round it said; Replace changes the
 * one shown, Replace all every one, one step for Undo either way. Match case and Whole words as a presentation program
 * has them. ⌘F (Ctrl+F) opens it with the words to find chosen; Esc closes it.
 */

export function FindPanel({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [current, setCurrent] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  const matches = useMemo(
    () => (doc ? findMatches(doc, query, { matchCase, wholeWords }) : []),
    [doc, query, matchCase, wholeWords],
  );
  const numbers = useMemo(() => new Map(doc ? slidesOf(doc).map((s, i) => [s.id, i + 1]) : []), [doc]);
  // A new search starts at the slide shown (its first match there or after it); replacing keeps the place.
  const searching = `${query}\u0000${String(matchCase)}\u0000${String(wholeWords)}`;
  const [searched, setSearched] = useState(searching);
  if (searched !== searching) {
    setSearched(searching);
    const s = useEditor.getState();
    const here = s.slideId ? (numbers.get(s.slideId) ?? 1) : 1;
    const from = matches.findIndex((m) => (numbers.get(m.slideId) ?? 0) >= here);
    setCurrent(from < 0 ? 0 : from);
  }
  const at = matches.length === 0 ? -1 : Math.min(current, matches.length - 1);
  const match = at >= 0 ? matches[at] : undefined;
  const context = match && doc ? matchContext(doc, match) : null;

  /** Go to a match: its slide shown, its text box chosen. */
  const go = (i: number) => {
    const m = matches[i];
    if (!m) return;
    finishTextEditing();
    setCurrent(i);
    showSlide(m.slideId);
    select([m.elementId]);
  };
  const step = (by: 1 | -1) => {
    if (matches.length === 0) return;
    go((at + by + matches.length) % matches.length);
  };
  const replace = (all: boolean) => {
    const now = useEditor.getState().doc;
    if (!now || !match) return;
    finishTextEditing();
    const which = all ? matches : [match];
    commit(replaceMatches(now, which, replacement));
    setSaid(`Replaced ${String(which.length)}.`);
  };
  const count =
    query.trim() === ''
      ? ''
      : matches.length === 0
        ? 'None found'
        : `${String(at + 1)} of ${String(matches.length)}`;
  return (
    <div
      role="search"
      aria-label="Find and replace"
      data-testid="find-panel"
      className="absolute top-2 right-2 z-20 w-[min(26rem,calc(100%-1rem))] space-y-2 rounded-lg border border-line-strong bg-panel-2 p-2 shadow-overlay"
    >
      <div className="flex items-center gap-1">
        <TextInput
          aria-label="Words to find"
          placeholder="Find"
          data-testid="find-text"
          autoFocus
          className="h-7 flex-1"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSaid(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <IconButton
          icon={CaseSensitive}
          size="sm"
          label="Match case"
          aria-pressed={matchCase}
          variant={matchCase ? 'secondary' : 'ghost'}
          data-testid="find-case"
          onClick={() => {
            setMatchCase((on) => !on);
          }}
        />
        <IconButton
          icon={WholeWord}
          size="sm"
          label="Whole words"
          aria-pressed={wholeWords}
          variant={wholeWords ? 'secondary' : 'ghost'}
          data-testid="find-whole"
          onClick={() => {
            setWholeWords((on) => !on);
          }}
        />
        <IconButton
          icon={ChevronUp}
          size="sm"
          label="Previous"
          disabled={matches.length === 0}
          data-testid="find-previous"
          onClick={() => {
            step(-1);
          }}
        />
        <IconButton
          icon={ChevronDown}
          size="sm"
          label="Next"
          disabled={matches.length === 0}
          data-testid="find-next"
          onClick={() => {
            step(1);
          }}
        />
        <IconButton
          icon={X}
          size="sm"
          label="Close find and replace"
          data-testid="find-close"
          onClick={onClose}
        />
      </div>
      <div className="flex items-center gap-1">
        <TextInput
          aria-label="Replace with"
          placeholder="Replace with"
          data-testid="replace-text"
          className="h-7 flex-1"
          value={replacement}
          onChange={(e) => {
            setReplacement(e.target.value);
          }}
        />
        <Button size="sm" disabled={!match} data-testid="replace-one" onClick={() => replace(false)}>
          Replace
        </Button>
        <Button size="sm" disabled={!match} data-testid="replace-all" onClick={() => replace(true)}>
          Replace all
        </Button>
      </div>
      <p className="flex min-h-4 items-center gap-2 text-xs text-muted" aria-live="polite">
        <span data-testid="find-count" className="font-medium tabular-nums">
          {count}
        </span>
        {match && context && (
          <span className="min-w-0 truncate" data-testid="find-where">
            {doc?.master?.id === match.slideId ? 'Master' : `Slide ${numbers.get(match.slideId) ?? ''}`}:{' '}
            {context.before}
            <mark className="rounded-sm bg-second/30 px-0.5 text-fg">{context.words}</mark>
            {context.after}
          </span>
        )}
        {said && (
          <span data-testid="find-said" className="ml-auto text-fg">
            {said}
          </span>
        )}
      </p>
    </div>
  );
}
