/** Part 17a: an optional shared master and per-slide design. Old libraries keep their existing canvases. */
export const up = `
ALTER TABLE presentations ADD COLUMN editor_master TEXT CHECK (editor_master IS NULL OR json_valid(editor_master));
ALTER TABLE slides ADD COLUMN editor_design TEXT CHECK (editor_design IS NULL OR json_valid(editor_design));
`;
