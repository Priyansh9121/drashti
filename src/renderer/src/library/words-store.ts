import { create } from 'zustand';
import type { KirtanInfo, TrackEdit, TrackSlide } from '../../../shared/kirtans';
import type { Lang } from '../../../shared/model';
import { clickPresentation, loadLibrary, selectPresentation, useLibrary } from './library-store';
import { pushRemoval } from './undo';

/*
 * The words editor: a presentation's words as plain text (the lyrics format),
 * or pasted words for a new presentation. A kirtan's words can also be
 * edited by language, slide by slide (its tracks): one language on its own,
 * or every language of each slide together. Both views write the same
 * words, the slides' own (src/shared/tracks.ts).
 */

/** The words as plain text, or by language (kirtans). */
export type WordsMode = 'all' | 'tracks';
/** By language: one language, or all of them side by side. */
export type TrackChoice = Lang | 'all';

export interface TrackWords {
  slides: TrackSlide[];
  /** The languages in the order the slides put them, then the rest. */
  order: Lang[];
  kirtan: KirtanInfo | null;
}

interface WordsView {
  /** What the editor is open for, if it is open. */
  open: { mode: 'edit'; presentationId: string; name: string } | { mode: 'new' } | null;
  name: string;
  text: string;
  /** The text as it came: anything else is unsaved. */
  loadedText: string;
  /** Fonts of legacy-font text: the words are shown but cannot be saved as plain text. */
  legacyFonts: string[];
  /** A kirtan's words by language (null for other presentations, and until loaded). */
  tracks: TrackWords | null;
  mode: WordsMode;
  shown: TrackChoice;
  /** By language: what is typed, per slide and language (lines joined), where it was changed. */
  typed: Record<string, Partial<Record<Lang, string>>>;
  loading: boolean;
  saving: boolean;
  problem: string | null;
}

const closed: WordsView = {
  open: null,
  name: '',
  text: '',
  loadedText: '',
  legacyFonts: [],
  tracks: null,
  mode: 'all',
  shown: 'all',
  typed: {},
  loading: false,
  saving: false,
  problem: null,
};

export const useWords = create<WordsView>(() => closed);

/** The lines a slide has in a language, as the editor shows them (one per line). */
export const cellText = (slide: TrackSlide, lang: Lang): string => (slide.lines[lang] ?? []).join('\n');

/** The edits typed in the By language view: only cells whose lines differ from the slide's. */
export function trackEdits(tracks: TrackWords, typed: WordsView['typed']): TrackEdit[] {
  const edits: TrackEdit[] = [];
  const tidy = (text: string) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
  for (const slide of tracks.slides)
    for (const [lang, text] of Object.entries(typed[slide.slideId] ?? {}) as [Lang, string][]) {
      const lines = tidy(text);
      if (lines.join('\n') !== (slide.lines[lang] ?? []).join('\n'))
        edits.push({ slideId: slide.slideId, lang, lines });
    }
  return edits;
}

/** Unsaved changes in the view being shown. */
export function hasChanges(s: WordsView): boolean {
  if (s.mode === 'tracks') return s.tracks !== null && trackEdits(s.tracks, s.typed).length > 0;
  return s.text !== s.loadedText;
}

export async function editWords(
  presentationId: string,
  name: string,
  mode: WordsMode = 'all',
): Promise<void> {
  useWords.setState({ ...closed, open: { mode: 'edit', presentationId, name }, name, mode, loading: true });
  const [result, tracks] = await Promise.all([
    window.drashti.library.words(presentationId),
    window.drashti.kirtans.tracks(presentationId),
  ]);
  const now = useWords.getState().open;
  if (now?.mode !== 'edit' || now.presentationId !== presentationId) return;
  const byLanguage =
    tracks.ok && tracks.kirtan ? { slides: tracks.slides, order: tracks.order, kirtan: tracks.kirtan } : null;
  useWords.setState(
    result.ok
      ? {
          text: result.text,
          loadedText: result.text,
          legacyFonts: result.legacyFonts,
          tracks: byLanguage,
          mode: byLanguage ? mode : 'all',
          loading: false,
        }
      : { problem: result.message, loading: false },
  );
}

export function newFromWords(): void {
  useWords.setState({ ...closed, open: { mode: 'new' } });
}

export function closeWords(): void {
  useWords.setState(closed);
}

/** Type in a cell of the By language view. */
export function typeLine(slideId: string, lang: Lang, text: string): void {
  useWords.setState((s) => ({ typed: { ...s.typed, [slideId]: { ...s.typed[slideId], [lang]: text } } }));
}

export async function saveWords(): Promise<void> {
  const state = useWords.getState();
  const { open, text, name, saving, legacyFonts, mode } = state;
  if (!open || saving) return;
  if (open.mode === 'edit' && mode === 'tracks') {
    await saveTracks(open.presentationId, open.name);
    return;
  }
  if (legacyFonts.length > 0) return;
  useWords.setState({ saving: true, problem: null });
  if (open.mode === 'new') {
    const result = await window.drashti.library.newFromWords(name, text);
    if (!result.ok) {
      useWords.setState({ saving: false, problem: result.message });
      return;
    }
    closeWords();
    await loadLibrary();
    clickPresentation(result.id, { toggle: false, range: false });
    return;
  }
  const result = await window.drashti.library.saveWords(open.presentationId, text);
  if (!result.ok) {
    useWords.setState({ saving: false, problem: result.message });
    return;
  }
  await afterSave(open.presentationId, open.name, result.revisionId);
}

async function saveTracks(presentationId: string, name: string): Promise<void> {
  const { tracks, typed } = useWords.getState();
  const edits = tracks ? trackEdits(tracks, typed) : [];
  if (edits.length === 0) {
    closeWords();
    return;
  }
  useWords.setState({ saving: true, problem: null });
  const result = await window.drashti.kirtans.saveTracks(presentationId, edits);
  if (!result.ok) {
    useWords.setState({ saving: false, problem: result.message });
    return;
  }
  await afterSave(presentationId, name, result.revisionId);
}

/** After a save: Undo can put the words back, and the slides show the new ones. */
async function afterSave(presentationId: string, name: string, revisionId: string | null): Promise<void> {
  if (revisionId !== null)
    pushRemoval({
      text: `Edited the words of “${name}”`,
      restore: async () => {
        await window.drashti.library.restoreRevision(revisionId);
        if (useLibrary.getState().selectedId === presentationId) await selectPresentation(presentationId);
      },
    });
  closeWords();
  if (useLibrary.getState().selectedId === presentationId) await selectPresentation(presentationId);
}
