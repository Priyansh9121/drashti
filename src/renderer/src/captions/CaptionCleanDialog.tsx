import { useEffect, useState } from 'react';
import {
  CAPTION_WORD_LANGUAGE_NAMES,
  checkCaptionWord,
  type CaptionWord,
} from '../../../shared/caption-words';
import { cleanPhraseKey } from '../../../shared/caption-clean/key';
import {
  CAPTION_CLEAN_WORDS_PER_LANGUAGE,
  type CaptionCleanResult,
  type CaptionCleanView,
} from '../../../shared/caption-clean/words';
import { SPEECH_LANGUAGES, type SpeechLanguage } from '../../../shared/speech';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Toggle } from '../ui/Toggle';
import {
  captionCleanCountText,
  captionCleanListText,
  captionCleanOwnText,
  hiddenWordName,
} from './caption-clean-text';

/*
 * Words left out of captions (alpha.24, QA24-CAPCLEAN-1; Pro Mode): the Live Captions dialog's line with how many
 * words captions have left out since they were turned on, and File › Live Captions… › Words Left Out…, where the
 * admin adds words of their own per language, kept in the library, as Caption Words are. The admin's words stay
 * hidden in the list until Show the words is ticked (each time it opens), so a picture of the window holds none.
 * Drashti's own list is never shown: only how many words it has.
 */

/** A word's Remove in the list (its name as shown: the word, or "Hidden word 2"): taken out at once, kept at once. */
export function CleanWordRemove({ shown, onRemove }: { shown: string; onRemove: () => void }) {
  return (
    <IconButton
      icon={Trash2}
      size="sm"
      variant="ghost"
      label={`Remove ${shown}`}
      onClick={() => {
        onRemove();
      }}
    />
  );
}

/** A word's own language for the letters (Sanskrit in Gujarati letters, as the screens show it). */
const LANG_TAG: Record<SpeechLanguage, string> = { gu: 'gu', hi: 'hi', sa: 'sa-Gujr', en: 'en' };

const isView = (v: unknown): v is CaptionCleanView =>
  typeof v === 'object' &&
  v !== null &&
  Array.isArray((v as { words?: unknown }).words) &&
  typeof (v as { leftOut?: unknown }).leftOut === 'number';
const isResult = (v: unknown): v is CaptionCleanResult =>
  typeof v === 'object' && v !== null && isView((v as { view?: unknown }).view);

/** The Live Captions dialog's line about words left out, the count since captions were turned on, and the button. */
export function CaptionCleanSection({ listening }: { listening: SpeechLanguage | 'auto' }) {
  const [open, setOpen] = useState(false);
  const [leftOut, setLeftOut] = useState<number | null>(null);
  useEffect(() => {
    void window.drashti.captionClean.view().then((v) => {
      if (isView(v)) setLeftOut(v.leftOut);
    });
    return window.drashti.captionClean.onChanged((count) => {
      setLeftOut(count.leftOut);
    });
  }, []);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Words on Drashti’s list or yours are never shown in captions, in any language: they are left out.
      </p>
      {leftOut !== null && (
        <p className="text-sm text-muted" data-testid="captions-left-out">
          {captionCleanCountText(leftOut)}
        </p>
      )}
      <Button
        data-testid="captions-clean"
        onClick={() => {
          setOpen(true);
        }}
      >
        Words Left Out…
      </Button>
      {open && (
        <CaptionCleanDialog
          listening={listening}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CaptionCleanDialog({
  listening,
  onClose,
}: {
  listening: SpeechLanguage | 'auto';
  onClose: () => void;
}) {
  const [view, setView] = useState<CaptionCleanView | null>(null);
  const [language, setLanguage] = useState<SpeechLanguage>(listening === 'auto' ? 'gu' : listening);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  // Off each time the dialog opens: the admin's words show only when asked for.
  const [showWords, setShowWords] = useState(false);

  useEffect(() => {
    void window.drashti.captionClean.view().then((v) => {
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
    take(window.drashti.captionClean.set(words));
  };

  const all = view?.words ?? [];
  const mine = all.filter((w) => w.language === language);
  const name = CAPTION_WORD_LANGUAGE_NAMES[language];

  const add = () => {
    const checked = checkCaptionWord(typed);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    const key = cleanPhraseKey(checked.word);
    if (mine.some((w) => cleanPhraseKey(w.word) === key)) {
      setError(`That word is in the ${name} list already.`);
      return;
    }
    if (mine.length >= CAPTION_CLEAN_WORDS_PER_LANGUAGE) {
      setError(`The ${name} list is full: it keeps 200 words at most.`);
      return;
    }
    setError(null);
    setTyped('');
    save([...all, { language, word: checked.word }]);
  };

  return (
    <Dialog
      title="Words left out of captions"
      size="md"
      onClose={onClose}
      closeLabel="Close words left out"
      testId="caption-clean-dialog"
      footer={
        <>
          <Button
            data-testid="caption-clean-import"
            onClick={() => {
              take(window.drashti.captionClean.importFile());
            }}
          >
            Import…
          </Button>
          <Button
            data-testid="caption-clean-export"
            disabled={all.length === 0}
            onClick={() => {
              take(window.drashti.captionClean.exportFile());
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
          Live captions, translated captions and a video’s caption files never show a word on Drashti’s list
          or yours: on the screens, in the stream and its recording, and in a sound recording’s caption draft,
          the word is left out.
        </p>
        {view && (
          <p className="text-sm text-muted" data-testid="caption-clean-own">
            {captionCleanOwnText(view.own)}
          </p>
        )}
        <p className="text-sm text-muted">
          Add any other words to leave out. A word is left out only as a whole word, in Gujarati or Devanagari
          letters, with or without a nukta, and in Latin letters in any case, so a longer word that holds it
          still shows. Add each ending of a word that you want left out too.
        </p>
        <Field label="Language">
          <Select
            data-testid="caption-clean-language"
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
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label="Word to leave out" error={error} className="flex-1">
            <TextInput
              data-testid="caption-clean-new"
              className="w-full"
              lang={LANG_TAG[language]}
              value={typed}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <Button type="submit" data-testid="caption-clean-add">
            Add
          </Button>
        </form>
        <p className="text-sm text-muted" data-testid="caption-clean-count">
          {captionCleanListText(name, mine.length)}
        </p>
        <Toggle
          checked={showWords}
          label="Show the words"
          data-testid="caption-clean-show"
          onChange={setShowWords}
        />
        {mine.length > 0 && (
          <ul
            className="max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line"
            data-testid="caption-clean-list"
            aria-label={`${name} words left out`}
          >
            {mine.map((w, i) => {
              const shown = showWords ? w.word : hiddenWordName(i);
              return (
                <li key={w.word} className="flex items-center gap-2 px-2 py-1">
                  <span
                    className="min-w-0 flex-1 truncate text-sm"
                    {...(showWords ? { lang: LANG_TAG[w.language] } : {})}
                    data-testid="caption-clean-word"
                  >
                    {shown}
                  </span>
                  <CleanWordRemove
                    shown={shown}
                    onRemove={() => {
                      save(all.filter((x) => x !== w));
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {said && (
          <Notice tone={said.ok ? 'info' : 'danger'} data-testid="caption-clean-said">
            {said.message}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
