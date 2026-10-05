/**
 * Migration 31: a playlist opened on Main counts as this week's (Session 14).
 *
 * Nodes copy ahead the media of playlists made or changed in the last 7 days
 * (Session 13). A playlist from an earlier week, opened again for this
 * week's sabha, now counts as soon as the operator opens it on Main:
 * `opened_at` is stamped then. It is kept apart from `updated_at`, which
 * says when its name or items last changed.
 */
export const up = `
ALTER TABLE playlists ADD COLUMN opened_at TEXT;
`;
