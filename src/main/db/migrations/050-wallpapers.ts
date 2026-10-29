/**
 * Migration 50: wallpapers (Session 55, Part 6, shared/wallpapers.ts) and what a video's playlist row does when it
 * ends. A wallpaper is its name, how long each of its pictures is up and the fade into the next, in the list's order;
 * its pictures (media rows, in their order) are in wallpaper_pictures. Deleting one only marks it (`deleted_at`), so
 * Undo can bring it back; marked ones go for good when Drashti next starts. The chosen one is a setting
 * (`wallpapers.chosen`). A playlist row's `when_ends` is a video's: NULL is the default (the chosen wallpaper), else
 * the next row ('next'), the video again ('loop') or its last picture ('freeze'). An alpha.13 library, and a backup
 * of one, gains both empty: nothing else changes.
 */
export const up = `
CREATE TABLE wallpapers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  seconds_each INTEGER NOT NULL DEFAULT 10,
  fade_ms INTEGER NOT NULL DEFAULT 1500,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE TABLE wallpaper_pictures (
  wallpaper_id TEXT NOT NULL REFERENCES wallpapers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  PRIMARY KEY (wallpaper_id, position)
);
CREATE INDEX wallpaper_pictures_by_media ON wallpaper_pictures(media_id);
ALTER TABLE playlist_items ADD COLUMN when_ends TEXT
  CHECK (when_ends IS NULL OR when_ends IN ('wallpaper', 'next', 'loop', 'freeze'));
`;
