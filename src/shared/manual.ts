import { z } from 'zod';
import type { Passage } from './markdown';
import { type Layers, nothingUp } from './engine/state';
import type { OperatorMode } from './mode';
import { matchesAll, searchWords } from './search';
import type { StreamStatus } from './stream';

/*
 * The Drashti Manual (x37, Session 60; the owner's "A, new Manual", 19 Nov 2026): how to use every part of the
 * window, a chapter for each, every feature told the same way (what it is, when you would use it, and how, in short
 * numbered steps, with a picture). Help › Drashti Manual…, the first item under Help in both modes, opens it in the
 * operator window as Guides… opens the guides; a panel's "?" names its chapter. Its words are Markdown files in
 * docs/manual/ (shipped beside the app in guides/manual/, read by the main process: src/main/guides.ts), drawn by
 * Drashti's own Markdown reader; its pictures are the guides' (docs/screenshots/, `../screenshots/<name>.png` as a
 * chapter writes them). Printed, or saved as a PDF, from a hidden window of its own (src/main/manual-print.ts).
 */

export const MANUAL_CHAPTER_IDS = [
  'start',
  'library',
  'playlists',
  'live',
  'audio',
  'stage',
  'messages',
  'tools',
  'screens',
  'stream',
  'phones',
  'settings',
  'simple',
  'keys',
  'editor',
  'sharing',
  'help',
] as const;
export type ManualChapterId = (typeof MANUAL_CHAPTER_IDS)[number];
export const manualChapterIdSchema = z.enum(MANUAL_CHAPTER_IDS);

export interface ManualChapter {
  id: ManualChapterId;
  /** Its file in docs/manual/ (guides/manual/ beside an installed Drashti). */
  file: string;
  /** Its title: the chapter's own first heading, and its name in the list of chapters. */
  title: string;
}

/** The chapters, in the manual's order: the window's parts first, as the owner listed them, then the rest. */
export const MANUAL_CHAPTERS: readonly ManualChapter[] = [
  { id: 'start', file: 'start.md', title: 'Start here' },
  { id: 'library', file: 'library.md', title: 'Library' },
  { id: 'playlists', file: 'playlists.md', title: 'Playlists and wallpapers' },
  { id: 'live', file: 'live.md', title: 'LIVE, Back and Next' },
  { id: 'audio', file: 'audio.md', title: 'Audio and the levels' },
  { id: 'stage', file: 'stage.md', title: 'Stage screen' },
  { id: 'messages', file: 'messages.md', title: 'Messages and timers' },
  { id: 'tools', file: 'tools.md', title: 'Tools' },
  { id: 'screens', file: 'screens.md', title: 'Screens and screen geometry' },
  { id: 'stream', file: 'stream.md', title: 'Stream' },
  { id: 'phones', file: 'phones.md', title: 'Phones and network' },
  { id: 'settings', file: 'settings.md', title: 'Settings and appearance' },
  { id: 'simple', file: 'simple.md', title: 'Simple Mode' },
  { id: 'keys', file: 'keys.md', title: 'Keys' },
  { id: 'editor', file: 'editor.md', title: 'Editing slides' },
  { id: 'sharing', file: 'sharing.md', title: 'Bringing things in and sharing' },
  { id: 'help', file: 'help.md', title: 'Help and when something goes wrong' },
];

const BY_ID = Object.fromEntries(MANUAL_CHAPTERS.map((c) => [c.id, c])) as Record<
  ManualChapterId,
  ManualChapter
>;

/** A chapter by its id. */
export const manualChapter = (id: ManualChapterId): ManualChapter => BY_ID[id];

/** Where Help › Drashti Manual… opens the first time in each mode: Simple Mode at its own chapter. */
export const manualStart = (mode: OperatorMode): ManualChapterId => (mode === 'simple' ? 'simple' : 'start');

/** The three parts every feature is told in, in this order, each a paragraph starting with its words in bold. */
export const FEATURE_PARTS = ['What it is.', 'When you would use it.', 'How:'] as const;

/** A chapter's picture as written ("../screenshots/<name>.png"): its name, or null for anything else. */
export function manualPictureName(src: string): string | null {
  return /^\.\.\/screenshots\/([a-z0-9-]{1,80}\.png)$/u.exec(src)?.[1] ?? null;
}

/** The address a chapter's picture is shown from (drashti-media://guide/, as the guides' are). */
export function manualPictureUrl(src: string): string | null {
  const name = manualPictureName(src);
  return name ? `drashti-media://guide/${name}` : null;
}

/** A chapter's passages, with each one's words for search. */
export interface IndexedChapter {
  id: ManualChapterId;
  passages: readonly Passage[];
  words: readonly (readonly string[])[];
}

export function indexChapter(id: ManualChapterId, passages: readonly Passage[]): IndexedChapter {
  return { id, passages, words: passages.map((p) => searchWords(p.text)) };
}

/** What a search found under one feature (or a chapter's opening) of the manual. */
export interface ManualHits {
  chapter: ManualChapterId;
  /** The feature it is under (its heading), or the chapter's title before any. */
  section: string;
  hits: Passage[];
}

/**
 * The passages holding every word typed, each the start of one of theirs, as the guides' search finds them (accents
 * and transliteration's spellings fold), by feature, in the manual's order. Headings are found too: a feature's name
 * is often the very word looked for.
 */
export function searchManual(chapters: readonly IndexedChapter[], query: string): ManualHits[] {
  const asked = searchWords(query);
  if (asked.length === 0) return [];
  const out: ManualHits[] = [];
  for (const c of chapters)
    c.passages.forEach((p, i) => {
      if (!matchesAll(asked, c.words[i] ?? [])) return;
      const last = out.at(-1);
      if (last?.chapter === c.id && last.section === p.section) last.hits.push(p);
      else out.push({ chapter: c.id, section: p.section, hits: [p] });
    });
  return out;
}

/** The bridge's answer for the manual: every chapter's text, and each picture's size (width, height) by its name. */
export type ManualRead =
  | {
      ok: true;
      chapters: { id: ManualChapterId; text: string }[];
      sizes: Record<string, [number, number]>;
    }
  | { ok: false; message: string };

/** The line beside Print… and Save as PDF… while they wait. */
export const MANUAL_PRINT_WAITS = 'Print or save the manual when nothing is up, on air or recording.';

/** The main process's answer to a request that came while the show is live all the same. */
export const MANUAL_PRINT_REFUSED =
  'Print or save the manual when nothing is up, on air or recording: clear what is up, and end the stream and the recording first.';

/**
 * Whether Print… and Save as PDF… wait (the lead's call of 20 Nov 2026, under the owner's word that nothing in the
 * manual's window may touch the show): while anything is up on the screens, or the stream is on air (or getting there,
 * or ending) or recording, as the work that waits for an idle show does (conversions, Trim, a PDF's reading: nothing
 * up, and the stream not in use). Not known yet (the window has not had the show's state): the safe side, waiting.
 * The main process asks the same of its own state before it prints (index.ts), whatever the window shows.
 */
export function manualPrintWaits(
  layers: Layers | null,
  stream: Pick<StreamStatus, 'live' | 'recording'> | null,
): boolean {
  if (layers === null || !nothingUp(layers)) return true;
  return stream !== null && (stream.live.state !== 'off' || stream.recording.state !== 'off');
}

/** Where a PDF went, as the manual says it: its name, in its folder's ("Drashti Manual.pdf, in Documents"). */
export function savedWhere(file: string): string {
  const parts = file.split(/[\\/]/u).filter((p) => p !== '');
  const name = parts.at(-1) ?? file;
  const folder = parts.at(-2);
  return folder ? `${name}, in ${folder}` : name;
}

/** How Print… or Save as PDF… went: done (where to, for a PDF), left (the person cancelled), or why not. */
export type ManualPrinted =
  | { ok: true; file: string | null }
  | { ok: false; cancelled: true }
  | {
      ok: false;
      cancelled: false;
      message: string;
    };
