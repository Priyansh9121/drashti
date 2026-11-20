/** Playlist playback choices: off until the operator turns them on; one kept draw of item ids. */
export const up = `
ALTER TABLE playlists ADD COLUMN shuffle INTEGER NOT NULL DEFAULT 0 CHECK (shuffle IN (0, 1));
ALTER TABLE playlists ADD COLUMN repeat_all INTEGER NOT NULL DEFAULT 0 CHECK (repeat_all IN (0, 1));
ALTER TABLE playlists ADD COLUMN play_order TEXT CHECK (play_order IS NULL OR json_valid(play_order));
`;
