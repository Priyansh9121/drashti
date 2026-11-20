import { inlineText, parseMarkdown } from './markdown';
import { MANUAL_CHAPTERS, type ManualChapterId } from './manual';
import type { OperatorMode } from './mode';
import { matchesAll, searchWords } from './search';

/*
 * Help › Report a Problem…'s list of features (x49, Q60-38: "selecting the feature from search or a list (both)"): the
 * Drashti Manual's own, one catalogue (x37's docs/manual): each chapter's features (its "## " headings) under its title,
 * with each one's "What it is." sentence for the search, and Something else at the end. A feature added to the Manual
 * is one a report can name, with nothing else to change.
 */

export interface ReportFeature {
  /** "<chapter id>/<its heading, as a slug>", or "other/something-else". */
  id: string;
  chapterId: ManualChapterId | 'other';
  /** The chapter's title ("" for Something else). */
  chapter: string;
  /** The feature's name: its heading in the Manual. */
  name: string;
  /** Its "What it is." sentence. */
  about: string;
}

export const SOMETHING_ELSE: ReportFeature = {
  id: 'other/something-else',
  chapterId: 'other',
  chapter: '',
  name: 'Something else',
  about: 'A problem in none of the features above.',
};

/** A heading as an id's second part: its letters and digits, lower case, joined by hyphens. */
const slug = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

const ABOUT = /^What it is\.\s*/u;

/** Every feature of the Manual's chapters, in its order, then Something else. */
export function reportFeatures(chapters: readonly { id: ManualChapterId; text: string }[]): ReportFeature[] {
  const texts = new Map(chapters.map((c) => [c.id, c.text]));
  const out: ReportFeature[] = [];
  for (const chapter of MANUAL_CHAPTERS) {
    const text = texts.get(chapter.id);
    if (text === undefined) continue;
    let current: ReportFeature | null = null;
    for (const block of parseMarkdown(text)) {
      if (block.kind === 'heading' && block.level === 2) {
        const name = inlineText(block.children).trim();
        current = {
          id: `${chapter.id}/${slug(name)}`,
          chapterId: chapter.id,
          chapter: chapter.title,
          name,
          about: '',
        };
        out.push(current);
      } else if (block.kind === 'heading' && block.level < 2) current = null;
      else if (current?.about === '' && block.kind === 'paragraph') {
        const words = inlineText(block.children).trim();
        if (ABOUT.test(words)) current.about = words.replace(ABOUT, '');
      }
    }
  }
  return [...out, SOMETHING_ELSE];
}

export interface FeatureGroup {
  /** The chapter's id, or "other". */
  id: string;
  title: string;
  features: ReportFeature[];
}

/** The words a feature is found by: its name, its chapter and its "What it is." sentence. */
const wordsOf = (f: ReportFeature) => searchWords(`${f.name} ${f.chapter} ${f.about}`);

/**
 * The features by chapter, as the window lists them: those holding every word searched (as the Manual's search finds
 * them), Simple Mode's chapter first in Simple Mode, and Something else last, whatever is searched.
 */
export function featureGroups(
  features: readonly ReportFeature[],
  o: { mode: OperatorMode; query: string },
): FeatureGroup[] {
  const asked = searchWords(o.query);
  const groups = new Map<string, FeatureGroup>();
  for (const f of features) {
    if (f.chapterId === 'other') continue;
    if (asked.length > 0 && !matchesAll(asked, wordsOf(f))) continue;
    const group = groups.get(f.chapterId) ?? { id: f.chapterId, title: f.chapter, features: [] };
    group.features.push(f);
    groups.set(f.chapterId, group);
  }
  const ordered = [...groups.values()];
  if (o.mode === 'simple') ordered.sort((a, b) => Number(b.id === 'simple') - Number(a.id === 'simple'));
  return [...ordered, { id: 'other', title: 'Something else', features: [SOMETHING_ELSE] }];
}

/** Words too common to say which feature a notice is about. */
const COMMON = new Set(
  (
    'a an and are as at be been but by can cannot could couldn did do does done drashti for from had has have here how ' +
    'if in into is it its may more must no not now of on once or our see so some than that the their them then there ' +
    'these they this to try was we were what when where which while who will with would you your again first next'
  ).split(' '),
);

/**
 * The features a notice's own words are about, best first (Report this…): each feature is scored by the notice's words
 * found in its name (twice) and in its chapter and "What it is." sentence; the best is named when a word of its name is
 * among them and no other scores as high. None when the words name none.
 */
export function guessFeatures(
  features: readonly ReportFeature[],
  notice: string,
): { best: ReportFeature | null; order: ReportFeature[] } {
  const said = [...new Set(searchWords(notice))].filter((w) => w.length >= 3 && !COMMON.has(w));
  const found = (word: string, inWords: readonly string[]) =>
    inWords.some((w) => w.startsWith(word) || (w.length >= 4 && word.startsWith(w)));
  const scored = features
    .filter((f) => f.chapterId !== 'other')
    .map((f) => {
      const name = searchWords(f.name);
      const rest = searchWords(`${f.chapter} ${f.about}`);
      const inName = said.filter((w) => found(w, name)).length;
      const inRest = said.filter((w) => found(w, rest)).length;
      return { f, inName, score: inName * 2 + inRest };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  const best = first && first.inName > 0 && (!second || second.score < first.score) ? first.f : null;
  return { best, order: scored.map((s) => s.f) };
}
