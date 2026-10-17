import { z } from 'zod';
import type { Passage } from './markdown';
import { matchesAll, searchWords } from './search';

/*
 * The guides inside Drashti (Phase B of Sessions 31–36): the operator's, the presenter's, the admin's and
 * the setup day's, in English, shipped as files beside the app (docs/ in the repository) and read through
 * the bridge, never from the internet and never served to phones. Simple Mode sees the operator's and the
 * presenter's only: the admin's guide holds how to reset a forgotten PIN.
 */

export const GUIDE_IDS = ['operator', 'presenter', 'admin', 'setup-day'] as const;
export type GuideId = (typeof GUIDE_IDS)[number];
export const guideIdSchema = z.enum(GUIDE_IDS);

export interface GuideInfo {
  id: GuideId;
  /** Its file, in docs/ (the repository) or guides/ (beside an installed Drashti). */
  file: string;
  /** Its tab in the Guides window. */
  tab: string;
  /** Simple Mode may read it. */
  simple: boolean;
}

export const GUIDES: readonly GuideInfo[] = [
  { id: 'operator', file: 'operator-guide.md', tab: 'Operator', simple: true },
  { id: 'presenter', file: 'presenter-guide.md', tab: 'Presenter', simple: true },
  { id: 'admin', file: 'admin-guide.md', tab: 'Admin', simple: false },
  { id: 'setup-day', file: 'setup-day.md', tab: 'Setup day', simple: false },
];

/** A guide's picture as written ("screenshots/<name>.png"): its name, or null for anything else. */
export function guidePictureName(src: string): string | null {
  return /^screenshots\/([a-z0-9-]{1,80}\.png)$/u.exec(src)?.[1] ?? null;
}

/** The address a picture of a guide is shown from (drashti-media://guide/, only what a guide names). */
export function guidePictureUrl(src: string): string | null {
  const name = guidePictureName(src);
  return name ? `drashti-media://guide/${name}` : null;
}

/** A guide's passages, with each one's words for search. */
export interface IndexedGuide {
  id: GuideId;
  passages: readonly Passage[];
  words: readonly (readonly string[])[];
}

export function indexGuide(id: GuideId, passages: readonly Passage[]): IndexedGuide {
  return { id, passages, words: passages.map((p) => searchWords(p.text)) };
}

/** What a search found in one section of a guide. */
export interface GuideSectionHits {
  guide: GuideId;
  section: string;
  hits: Passage[];
}

/**
 * The passages holding every word typed, each the start of one of theirs (as the library's search: accents
 * and transliteration's spellings fold), by section, in the guides' order.
 */
export function searchGuides(guides: readonly IndexedGuide[], query: string): GuideSectionHits[] {
  const asked = searchWords(query);
  if (asked.length === 0) return [];
  const out: GuideSectionHits[] = [];
  for (const g of guides)
    g.passages.forEach((p, i) => {
      if (p.heading || !matchesAll(asked, g.words[i] ?? [])) return;
      const last = out.at(-1);
      if (last?.guide === g.id && last.section === p.section) last.hits.push(p);
      else out.push({ guide: g.id, section: p.section, hits: [p] });
    });
  return out;
}

/** A help card's words as its guide prints them, their bold and code marks aside ("**Looks.**" is "Looks."). */
export const plainWords = (words: string): string => words.replace(/\*\*|`/gu, '');

/** The passages holding these words as written: Read more opens the one ("What is this?", Sessions 31–36). */
export function passagesHolding(passages: readonly Passage[], words: string): Passage[] {
  const plain = plainWords(words);
  return passages.filter((p) => p.text.includes(plain));
}

/**
 * The bridge's answer for a guide: its text, and each picture's size (width, height) by its name, so the
 * window keeps each picture's room before it loads and a passage brought into view stays there.
 */
export type GuideRead =
  { ok: true; text: string; sizes: Record<string, [number, number]> } | { ok: false; message: string };
