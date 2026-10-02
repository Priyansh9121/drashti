/**
 * Migration 12: which languages each screen group shows (Session 8).
 *
 * A JSON list of languages in the order the group shows them, for a
 * kirtan's slides (see src/shared/language-view.ts); NULL shows every
 * language in each slide's own order, which is how every group looked
 * before. When Looks come (Session 11) this moves into the group's Look.
 */
export const up = `
ALTER TABLE screen_groups ADD COLUMN languages TEXT CHECK (languages IS NULL OR json_valid(languages));
`;
