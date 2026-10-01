import { useMemo } from 'react';
import { parseLyrics } from '../../../shared/lyrics';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Textarea, TextInput } from '../ui/Field';
import { Notice } from '../ui/Notice';
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
    <Dialog
      title={title}
      size="lg"
      onClose={closeWords}
      closeLabel={readOnly ? 'Close' : 'Cancel'}
      closeButton={false}
      testId="words-editor"
      bodyClassName="flex min-h-0 flex-col gap-3"
      footer={
        <>
          <span className="mr-auto text-xs text-muted">{!loading && <Count text={text} />}</span>
          <Button onClick={closeWords}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && (
            <Button
              variant="primary"
              kbd={saveKey}
              disabled={saving || loading}
              onClick={() => void saveWords()}
            >
              {open.mode === 'new' ? 'Make slides' : 'Save'}
            </Button>
          )}
        </>
      }
    >
      {open.mode === 'new' && (
        <TextInput
          aria-label="Name"
          placeholder="Name, for example the kirtan's first line"
          value={name}
          maxLength={200}
          autoFocus
          onChange={(e) => {
            useWords.setState({ name: e.target.value });
          }}
        />
      )}
      {readOnly ? (
        <Notice tone="warning">
          These words are typed in a legacy font ({legacyFonts.join(', ')}), so they cannot be edited as plain
          text yet: saving them would garble them. They are shown here as they are stored.
        </Notice>
      ) : (
        <p className="text-xs text-muted">
          A line in square brackets, such as [Verse 1] or [Chorus], starts a group; a blank line starts a new
          slide. A header again with nothing under it repeats that group. Slides that are still there keep
          their look, backgrounds and cues; slides without words, and hidden slides, are kept as they are.
        </p>
      )}
      <Textarea
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
        className="min-h-[45vh] flex-1 resize-none text-base leading-relaxed"
      />
      {problem && <Notice tone="danger">{problem}</Notice>}
    </Dialog>
  );
}
