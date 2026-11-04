/** An operator-approved suggestion's date. Derived search vectors live outside the library. */
export const up = `
CREATE TABLE ai_sabhas (
  playlist_id TEXT PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
  for_date TEXT NOT NULL
);
`;
