import { useEffect, useState } from 'react';
import {
  CAPTION_HINTS_ON,
  CAPTION_WORD_LANGUAGE_NAMES,
  CAPTION_WORDS_PER_LANGUAGE,
  captionWordKey,
  checkCaptionWord,
  type CaptionWord,
  type CaptionWordsResult,
  type CaptionWordsView,
} from '../../../shared/caption-words';
import { SPEECH_LANGUAGES, type SpeechLanguage } from '../../../shared/speech';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { ArrowUp, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Toggle } from '../ui/Toggle';
import { captionWordLettersText, captionWordsHintText } from './caption-words-text';

/*
 * File › Live Captions… › Caption Words… (alpha.22; Pro Mode): the names and terms a speaker says, each spelt as
 * the captions should show it, per language, kept in the library. Each change is kept at once. Import… adds the
 * words of a CSV file; Export… saves the list as one (to bring it to another Main).
 */

/** A word's own language for the letters (Sanskrit in Gujarati letters, as the screens show it). */
const LANG_TAG: Record<SpeechLanguage, string> = { gu: 'gu', hi: 'hi', sa: 'sa-Gujr', en: 'en' };

const isView = (v: unknown): v is CaptionWordsView =>
  typeof v === 'object' && v !== null && Array.isArray((v as { words?: unknown }).words);
const isResult = (v: unknown): v is CaptionWordsResult =>
  typeof v === 'object' && v !== null && isView((v as { view?: unknown }).view);

/**
 * One entry in the list, as typed; under Gujarati, Hindi or Sanskrit in other letters than its language's, a short
 * note says it never shows in that language's captions (alpha.24: they keep to its letters). Kept either way.
 */
export function CaptionWordText({ word }: { word: CaptionWord }) {
  const note = captionWordLettersText(word.word, word.language);
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm" lang={LANG_TAG[word.language]} data-testid="caption-word">
        {word.word}
      </span>
      {note !== null && (
        <span className="block text-xs text-warning-fg" data-testid="caption-word-letters">
          {note}
        </span>
      )}
    </span>
  );
}

/** The Live captions dialog's line about caption words, and the button that opens them. */
export function CaptionWordsSection({ listening }: { listening: SpeechLanguage | 'auto' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Caption words: names and terms the speaker says, spelt as the captions should show them.
      </p>
      <Button
        data-testid="captions-words"
        onClick={() => {
          setOpen(true);
        }}
      >
        Caption Words…
      </Button>
      {open && (
        <CaptionWordsDialog
          listening={listening}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CaptionWordsDialog({
  listening,
  onClose,
}: {
  listening: SpeechLanguage | 'auto';
  onClose: () => void;
}) {
  const [view, setView] = useState<CaptionWordsView | null>(null);
  const [language, setLanguage] = useState<SpeechLanguage>(listening === 'auto' ? 'gu' : listening);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void window.drashti.captionWords.view().then((v) => {
      if (isView(v)) setView(v);
    });
  }, []);

  const take = (pending: Promise<unknown>): void => {
    void pending.then((result) => {
      if (!isResult(result)) return;
      setView(result.view);
      setSaid(result.message === null ? null : { ok: result.ok, message: result.message });
    });
  };
  const save = (words: CaptionWord[]): void => {
    take(window.drashti.captionWords.set(words));
  };

  const all = view?.words ?? [];
  const mine = all.filter((w) => w.language === language);
  const name = CAPTION_WORD_LANGUAGE_NAMES[language];
  const hintsOn = view?.hintsOn[language] ?? CAPTION_HINTS_ON[language];

  const add = () => {
    const checked = checkCaptionWord(typed);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    const key = captionWordKey(checked.word, language);
    if (mine.some((w) => captionWordKey(w.word, language) === key)) {
      setError(`That word is in the ${name} list already.`);
      return;
    }
    if (mine.length >= CAPTION_WORDS_PER_LANGUAGE) {
      setError(`The ${name} list is full: it keeps 200 words at most.`);
      return;
    }
    setError(null);
    setTyped('');
    save([...all, { language, word: checked.word }]);
  };
  /** The list with this language's words in a new order (or one fewer), the others as they were. */
  const withMine = (next: CaptionWord[]): CaptionWord[] => [
    ...all.filter((w) => w.language !== language),
    ...next,
  ];

  return (
    <Dialog
      title="Caption words"
      size="md"
      onClose={onClose}
      closeLabel="Close caption words"
      testId="caption-words-dialog"
      footer={
        <>
          <Button
            data-testid="caption-words-import"
            onClick={() => {
              take(window.drashti.captionWords.importFile());
            }}
          >
            Import…
          </Button>
          <Button
            data-testid="caption-words-export"
            disabled={all.length === 0}
            onClick={() => {
              take(window.drashti.captionWords.exportFile());
            }}
          >
            Export…
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Names and terms the speaker says, each spelt as the captions should show it. When one language is
          chosen for captions, the captions engine is given that language’s first words as hints. A word heard
          a letter or two away from one of these is shown as written here.
        </p>
        <Field label="Language">
          <Select
            data-testid="caption-words-language"
            className="w-full"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value as SpeechLanguage);
              setError(null);
            }}
          >
            {SPEECH_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {CAPTION_WORD_LANGUAGE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
        {language === 'sa' && (
          <p className="text-sm text-muted">
            Type Sanskrit words in Gujarati letters, as the screens show them.
          </p>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label="Word or name" error={error} className="flex-1">
            <TextInput
              data-testid="caption-words-new"
              className="w-full"
              lang={LANG_TAG[language]}
              value={typed}
              maxLength={80}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <Button type="submit" data-testid="caption-words-add">
            Add
          </Button>
        </form>
        <p className="text-sm text-muted" data-testid="caption-words-hints">
          {captionWordsHintText(name, mine.length, view?.hinted[language] ?? 0, listening, language, hintsOn)}
        </p>
        <Toggle
          checked={hintsOn}
          label={`Give the captions engine the ${name} words as hints`}
          data-testid="caption-words-hints-on"
          onChange={(on) => {
            take(window.drashti.captionWords.setHints(language, on));
          }}
        />
        {language === 'gu' && !hintsOn && (
          <p className="text-sm text-muted">
            Off at first for Gujarati: in a trial on real speech, hints did not help Gujarati. Spellings are
            fixed either way.
          </p>
        )}
        {mine.length > 0 && (
          <ul
            className="max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line"
            data-testid="caption-words-list"
            aria-label={`${name} caption words`}
          >
            {mine.map((w, i) => (
              <li key={w.word} className="flex items-center gap-2 px-2 py-1">
                <CaptionWordText word={w} />
                <IconButton
                  icon={ArrowUp}
                  size="sm"
                  label={`Move ${w.word} up`}
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...mine];
                    const [moved] = next.splice(i, 1);
                    if (moved) next.splice(i - 1, 0, moved);
                    save(withMine(next));
                  }}
                />
                <IconButton
                  icon={Trash2}
                  size="sm"
                  variant="ghost"
                  label={`Remove ${w.word}`}
                  onClick={() => {
                    save(withMine(mine.filter((_, j) => j !== i)));
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {said && (
          <Notice tone={said.ok ? 'info' : 'danger'} data-testid="caption-words-said">
            {said.message}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
