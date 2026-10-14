/**
 * Migration 40: Drashti's built-in themes (Session 26, shared/builtin-themes.ts): each is marked with its
 * own key, so the Themes window says "Built in" and saving one makes a copy. Null: a library's own theme.
 * The themes themselves are added once by db/seed.ts (a deleted one stays deleted).
 */
export const up = `
ALTER TABLE themes ADD COLUMN builtin TEXT;
`;
