/**
 * Migration 39: a picture's look (Session 26e, shared/picture-look.ts): how
 * it is framed (zoom 100 to 400 %, moved) and enhanced (brightness,
 * contrast, colour, sharpness), as JSON with the media item, so it is the
 * same wherever it shows. Null: shown as it is. The file is never changed.
 */
export const up = `
ALTER TABLE media ADD COLUMN look TEXT CHECK (look IS NULL OR json_valid(look));
`;
