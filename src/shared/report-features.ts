import type { ManualChapterId } from './manual';
import type { OperatorMode } from './mode';

/*
 * Help › Report a Problem…'s list of features (x49, Q60-38: "selecting the feature from search or a list (both)"): the
 * Drashti Manual's own, one catalogue (x37's docs/manual): each chapter's features (its "## " headings) under its title,
 * with each one's "What it is." sentence for the search, and Something else at the end.
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

export function reportFeatures(_chapters: readonly { id: ManualChapterId; text: string }[]): ReportFeature[] {
  return [];
}

export interface FeatureGroup {
  id: string;
  title: string;
  features: ReportFeature[];
}

export function featureGroups(
  _features: readonly ReportFeature[],
  _o: { mode: OperatorMode; query: string },
): FeatureGroup[] {
  return [];
}

export function guessFeatures(
  _features: readonly ReportFeature[],
  _notice: string,
): { best: ReportFeature | null; order: ReportFeature[] } {
  return { best: null, order: [] };
}
