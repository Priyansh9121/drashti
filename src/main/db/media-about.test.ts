import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { MediaRepo } from './media';

/*
 * What Media information… (alpha.20, Q60-34 item 1) reads of a media item in the library: its file, size, length, when
 * and from where it came in, whether it plays, and its converted copy (or the original of a copy). Placeholder names.
 */

describe('a media item’s notes for Media information', () => {
  it('says its file, size, length and where it came from; its copy once converted, and a copy’s original', () => {
    const db = openDatabase(':memory:');
    const media = new MediaRepo(db);
    db.prepare(
      `INSERT INTO media (id, kind, name, path, sha256, bytes, duration_ms, playable, format, source_kind, source_path,
                          source_imported_at)
       VALUES ('orig', 'video', 'Placeholder clip.mov', 'ab/orig.mov', 'ab12', 9000, 65000, 0, 'ProRes 422 HQ video (QuickTime)',
               'media', '/Placeholder folder/Placeholder clip.mov', '2026-11-20T12:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO media (id, kind, name, path, sha256, bytes, playable, format, converted_from)
       VALUES ('copy', 'video', 'Placeholder clip.mp4', 'cd/copy.mp4', 'cd34', 4000, 1, 'H.264 video (MP4), converted by Drashti', 'orig')`,
    ).run();
    db.prepare(
      "INSERT INTO media_conversions (id, original_id, converted_id) VALUES ('c1', 'orig', 'copy')",
    ).run();
    expect(media.about('orig')).toEqual({
      name: 'Placeholder clip.mov',
      kind: 'video',
      path: 'ab/orig.mov',
      sha256: 'ab12',
      bytes: 9000,
      missing: false,
      deleted: false,
      playable: false,
      format: 'ProRes 422 HQ video (QuickTime)',
      durationMs: 65000,
      importedAt: '2026-11-20T12:00:00.000Z',
      importedFrom: '/Placeholder folder/Placeholder clip.mov',
      convertedTo: 'Placeholder clip.mp4',
      copyOf: null,
    });
    expect(media.about('copy')).toMatchObject({
      name: 'Placeholder clip.mp4',
      playable: true,
      convertedTo: null,
      copyOf: 'Placeholder clip.mov',
      importedFrom: null,
    });
    // With no import time of its own, when it was made.
    expect(media.about('copy')?.importedAt).toMatch(/^\d{4}-\d\d-\d\dT/u);
    // A conversion undone, or its copy deleted: no copy any more.
    db.prepare("UPDATE media_conversions SET undone_at = '2026-11-20T13:00:00.000Z' WHERE id = 'c1'").run();
    expect(media.about('orig')?.convertedTo).toBeNull();
    expect(media.about('nothing')).toBeNull();
  });

  it('says a file is missing or deleted, and a playable that is not known yet', () => {
    const db = openDatabase(':memory:');
    const media = new MediaRepo(db);
    db.prepare(
      "INSERT INTO media (id, kind, name, path, missing) VALUES ('gone', 'audio', 'Placeholder gone.mp3', '', 1)",
    ).run();
    db.prepare(
      "INSERT INTO media (id, kind, name, path, deleted_at) VALUES ('del', 'audio', 'Placeholder deleted.mp3', 'ef/del.mp3', '2026-11-20T12:00:00.000Z')",
    ).run();
    expect(media.about('gone')).toMatchObject({
      missing: true,
      deleted: false,
      playable: null,
      sha256: null,
    });
    expect(media.about('del')).toMatchObject({ missing: false, deleted: true });
  });
});
