/** Part 17a: optional editor-only guide positions; every old slide opens without guides. */
export const up = `
ALTER TABLE slides ADD COLUMN editor_guides TEXT CHECK (editor_guides IS NULL OR json_valid(editor_guides));
`;
