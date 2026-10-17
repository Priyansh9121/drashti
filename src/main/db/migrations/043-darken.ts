/**
 * Migration 43: darkening behind the words (Sessions 31–36, SLD-3). `slides.darken` is a band behind each box
 * of words, or the whole picture, and how dark (JSON: `{"kind":"band","strength":0.6}`); NULL, as every slide
 * made before has it, for none: it is never turned on for an existing slide.
 */
export const up = `
ALTER TABLE slides ADD COLUMN darken TEXT CHECK (darken IS NULL OR json_valid(darken));
`;
