import { useMemo } from 'react';
import { parseLyrics } from '../../../shared/lyrics';
import { Button } from '../ui/Button';
import { plural } from '../ui/text';
import { closeWords, saveWords, useWords } from './words-store';

/** How many groups and slides the words make, as the operator types. */
function Count({ text }: { text: string }) {
  const parsed = useMemo(() => parseLyrics(text), [text]);
  const slides = parsed.groups.reduce((n, g) => n + g.slides.length, 0);
  return (
    <span data-testid="words-count">
      {plural(parsed.groups.length, 'group')} · {plural(slides, 'slide')}
      {parsed.repeats ? ' · sung in the order written' : ''}
    </span>
  );
}

/**
 * The words editor: [Verse 1] lines start groups, blank lines split slides.
 * Saving keeps the look, backgrounds and cues of slides still there.
 */
export function WordsEditor({ platform }: { platform: string }) {
  const open = useWords((s) => s.open);
  const text = useWords((s) => s.text);
  const name = useWords((s) => s.name);
  const legacyFonts = useWords((s) => s.legacyFonts);
  const loading = useWords((s) => s.loading);
  const saving = useWords((s) => s.saving);
  const problem = useWords((s) => s.problem);
  if (!open) return null;
  const readOnly = legacyFonts.length > 0;
  const saveKey = platform === 'darwin' ? '⌘↩' : 'Ctrl+Enter';
  const title = open.mode === 'new' ? 'New presentation' : `Words of “${open.name}”`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="words-title"
      data-testid="words-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeWords();
      }}
    >
      <div className="flex max-h-full w-[min(56rem,100%)] flex-col gap-3 rounded-lg border border-line bg-panel p-5 shadow-2xl">
        <h3 id="words-title" className="text-lg font-semibold">
          {title}
        </h3>
        {open.mode === 'new' && (
          <input
            aria-label="Name"
            placeholder="Name, for example the kirtan's first line"
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => {
              useWords.setState({ name: e.target.value });
            }}
            className="rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
          />
        )}
        {readOnly ? (
          <p
            role="alert"
            className="rounded-md border border-amber-700 bg-amber-950/60 px-3 py-2 text-sm text-amber-100"
          >
            These words are typed in a legacy font ({legacyFonts.join(', ')}), so they cannot be edited as
            plain text yet: saving them would garble them. They are shown here as they are stored.
          </p>
        ) : (
          <p className="text-xs text-muted">
            A line in square brackets, such as [Verse 1] or [Chorus], starts a group; a blank line starts a
            new slide. A header again with nothing under it repeats that group. Slides that are still there
            keep their look, backgrounds and cues; slides without words, and hidden slides, are kept as they
            are.
          </p>
        )}
        <textarea
          aria-label="Words"
          data-testid="words-text"
          value={loading ? 'Loading…' : text}
          readOnly={readOnly || loading}
          spellCheck={false}
          autoFocus={open.mode === 'edit'}
          onChange={(e) => {
            useWords.setState({ text: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (platform === 'darwin' ? e.metaKey : e.ctrlKey)) {
              e.preventDefault();
              void saveWords();
            }
          }}
          className="min-h-[50vh] flex-1 resize-none rounded-md border border-line bg-ink p-3 text-base leading-relaxed text-white focus-visible:outline-2 focus-visible:outline-accent"
        />
        {problem && (
          <p role="alert" className="text-sm text-amber-200">
            {problem}
          </p>
        )}
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-muted">{!loading && <Count text={text} />}</span>
          <Button onClick={closeWords}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && (
            <Button tone="primary" disabled={saving || loading} onClick={() => void saveWords()}>
              {open.mode === 'new' ? 'Make slides' : 'Save'} <kbd className="ml-1 opacity-70">{saveKey}</kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
