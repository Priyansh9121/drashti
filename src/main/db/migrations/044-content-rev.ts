/**
 * Migration 44: a presentation's content revision (Sessions 31–36, the slide editor's guard). `content_rev`
 * goes up by one with every write of its content, so the editor's stamp changes even when two writes land in
 * the same millisecond, which `updated_at` alone cannot tell apart. 0 for every presentation made before.
 */
export const up = `
ALTER TABLE presentations ADD COLUMN content_rev INTEGER NOT NULL DEFAULT 0;
`;
