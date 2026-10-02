import { useMemo } from 'react';
import type { TrackSlide } from '../../../shared/kirtans';
import { parseLyrics } from '../../../shared/lyrics';
import type { Lang } from '../../../shared/model';
import { LANG_NAMES } from '../../../shared/themes';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Textarea, TextInput } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { TabPanel, Tabs } from '../ui/Tabs';
import { plural } from '../ui/text';
import type { TrackChoice, TrackWords, WordsMode } from './words-store';
import { cellText, closeWords, hasChanges, saveWords, trackEdits, typeLine, useWords } from './words-store';

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

/** The plain-text view: the panel of the All words tab when the presentation is a kirtan. */
function AllWordsPanel({ tabbed, children }: { tabbed: boolean; children: React.ReactNode }) {
  return tabbed ? (
    <TabPanel group="words-mode" id="all" className="flex min-h-0 flex-1 flex-col gap-3">
      {children}
    </TabPanel>
  ) : (
    <>{children}</>
  );
}

/** One slide's lines in one language: a field, marked when the slide has none in it. */
function TrackCell({ slide, lang, showName }: { slide: TrackSlide; lang: Lang; showName: boolean }) {
  const typed = useWords((s) => s.typed[slide.slideId]?.[lang]);
  const value = typed ?? cellText(slide, lang);
  const missing = value.trim() === '';
  const lines = Math.max(1, value.split('\n').length);
  // Made by Drashti (transliteration), and not changed here yet: typing makes it the operator's own.
  const made = slide.made.includes(lang) && (typed === undefined || typed === cellText(slide, lang));
  return (
    <label className="flex min-w-0 flex-col gap-1" data-testid="track-cell" data-lang={lang}>
      {showName && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
          {LANG_NAMES[lang]}
          {missing && (
            <Badge tone="warning" data-testid="track-missing">
              Missing
            </Badge>
          )}
        </span>
      )}
      {!showName && missing && (
        <span className="sr-only" data-testid="track-missing">
          Missing
        </span>
      )}
      <Textarea
        aria-label={`Slide ${slide.number}, ${LANG_NAMES[lang]}${missing ? ' (missing)' : ''}`}
        data-missing={missing ? 'true' : undefined}
        rows={lines}
        spellCheck={false}
        value={value}
        placeholder={`No ${LANG_NAMES[lang]} on this slide`}
        onChange={(e) => {
          typeLine(slide.slideId, lang, e.target.value);
        }}
        className={cx(
          'resize-y px-2.5 py-1.5 text-base leading-snug',
          missing && 'border-dashed border-warning/70 bg-warning-bg/30',
        )}
      />
      {made && (
        <span className="text-2xs text-muted" data-testid="track-made">
          Made by Drashti: change it and it is yours
        </span>
      )}
    </label>
  );
}

/** A kirtan's words slide by slide: one language, or every language of each slide together. */
function ByLanguage({ tracks, shown }: { tracks: TrackWords; shown: TrackChoice }) {
  // All languages: those the kirtan has (pick one above to add another).
  const langs: Lang[] =
    shown === 'all' ? tracks.order.filter((l) => tracks.kirtan?.tracks.includes(l)) : [shown];
  return (
    <ol className="space-y-3" data-testid="track-slides">
      {tracks.slides.map((slide) => (
        <li
          key={slide.slideId}
          data-testid="track-slide"
          className="rounded-lg border border-line bg-panel-2 px-3 py-2.5"
          style={{ borderLeft: `4px solid ${slide.groupColor ?? 'var(--color-line-strong)'}` }}
        >
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
            <span className="font-bold text-fg tabular-nums">{slide.number}</span>
            <span>{slide.groupName || 'No group'}</span>
            {slide.label && <span className="truncate">· {slide.label}</span>}
            {slide.legacy && (
              <Badge tone="warning" title="Typed in a legacy font: shown as it is, in no language">
                Legacy font
              </Badge>
            )}
          </div>
          {langs.length === 0 ? (
            <p className="text-sm text-muted">No words in any language yet: choose a language above.</p>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}
            >
              {langs.map((lang) => (
                <TrackCell key={lang} slide={slide} lang={lang} showName={shown === 'all'} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The words editor: [Verse 1] lines start groups, blank lines split slides.
 * Saving keeps the look, backgrounds and cues of slides still there. A
 * kirtan's words can also be edited by language, slide by slide.
 */
export function WordsEditor({ platform }: { platform: string }) {
  const state = useWords();
  const { open, text, name, legacyFonts, loading, saving, problem, tracks, mode, shown } = state;
  if (!open) return null;
  const byLanguage = mode === 'tracks' && tracks !== null;
  const readOnly = !byLanguage && legacyFonts.length > 0;
  const saveKey = platform === 'darwin' ? '⌘↩' : 'Ctrl+Enter';
  const title = open.mode === 'new' ? 'New presentation' : `Words of “${open.name}”`;
  const changed = hasChanges(state);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (platform === 'darwin' ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      void saveWords();
    }
  };
  const editsCount = byLanguage ? trackEdits(tracks, state.typed).length : 0;
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
          <span className="mr-auto text-xs text-muted">
            {!loading &&
              (byLanguage ? (
                <span data-testid="track-count">
                  {plural(tracks.slides.length, 'slide')}
                  {editsCount > 0 ? ` · ${plural(editsCount, 'change')}` : ''}
                </span>
              ) : (
                <Count text={text} />
              ))}
          </span>
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
      {tracks && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Tabs<WordsMode>
            group="words-mode"
            label="How to edit the words"
            value={mode}
            items={[
              { id: 'all', label: 'All words' },
              { id: 'tracks', label: 'By language' },
            ]}
            onChange={(next) => {
              // Each view saves its own changes: save or cancel before switching.
              if (!changed) useWords.setState({ mode: next, typed: {}, text: state.loadedText });
            }}
          />
          {changed && <span className="text-xs text-muted">Save or cancel these changes to switch.</span>}
        </div>
      )}
      {byLanguage ? (
        <TabPanel group="words-mode" id="tracks" className="flex min-h-0 flex-1 flex-col gap-3">
          <Tabs<TrackChoice>
            group="words-lang"
            label="Which language"
            size="sm"
            value={shown}
            items={[
              { id: 'all', label: 'All languages' },
              ...tracks.order.map((l) => ({ id: l, label: LANG_NAMES[l] })),
            ]}
            onChange={(next) => {
              useWords.setState({ shown: next });
            }}
          />
          <p className="text-xs text-muted">
            Each slide’s lines in each language. Changing a line changes it on the slide; a slide with nothing
            in a language shows it as missing, and typing there adds it. Slides stay as they are: add or
            remove slides in All words.
          </p>
          <div className="min-h-[45vh] flex-1 overflow-y-auto pr-1" onKeyDown={onKeyDown}>
            <TabPanel group="words-lang" id={shown}>
              <ByLanguage tracks={tracks} shown={shown} />
            </TabPanel>
          </div>
        </TabPanel>
      ) : (
        <AllWordsPanel tabbed={tracks !== null}>
          {readOnly ? (
            <Notice tone="warning">
              These words are typed in a legacy font ({legacyFonts.join(', ')}), so they cannot be edited as
              plain text yet: saving them would garble them. They are shown here as they are stored.
            </Notice>
          ) : (
            <p className="text-xs text-muted">
              A line in square brackets, such as [Verse 1] or [Chorus], starts a group; a blank line starts a
              new slide. A header again with nothing under it repeats that group. Slides that are still there
              keep their look, backgrounds and cues; slides without words, and hidden slides, are kept as they
              are.
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
            onKeyDown={onKeyDown}
            className="min-h-[45vh] flex-1 resize-none text-base leading-relaxed"
          />
        </AllWordsPanel>
      )}
      {problem && <Notice tone="danger">{problem}</Notice>}
    </Dialog>
  );
}
