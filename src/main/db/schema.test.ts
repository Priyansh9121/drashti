import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';
import { PresentationRepo } from './presentations';

let db: Db;
let repo: PresentationRepo;
let presentationId: string;

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const one = (sql: string, ...args: unknown[]): unknown => db.prepare(sql).get(...args);

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new PresentationRepo(db);
  const libraryId = repo.ensureLibrary('Default');
  presentationId = repo.insert({
    libraryId,
    name: 'Kirtan',
    groups: [
      {
        name: 'Verse',
        slides: [
          {
            elements: [
              {
                id: 'x',
                kind: 'shape',
                frame: { x: 0, y: 0, width: 1, height: 1 },
                fill: '#ffffff',
                cornerRadius: 0,
                opacity: 1,
              },
            ],
          },
        ],
      },
    ],
    kirtan: { tracks: ['gu', 'translit'], lines: [{ gu: 'એક', translit: 'ek' }] },
  });
});

describe('schema constraints', () => {
  const slideId = () => (one('SELECT id FROM slides') as { id: string }).id;
  const groupId = () => (one('SELECT id FROM slide_groups') as { id: string }).id;

  it.each([
    [
      'a kirtan track in an unknown language',
      () => db.prepare("INSERT INTO kirtan_tracks (kirtan_id, lang) VALUES (?, 'fr')").run(presentationId),
    ],
    [
      'an element of unknown kind',
      () =>
        db
          .prepare(
            "INSERT INTO elements (id, slide_id, position, kind, x, y, width, height) VALUES ('e', ?, 0, 'blob', 0, 0, 1, 1)",
          )
          .run(slideId()),
    ],
    [
      'element props that are not JSON',
      () =>
        db
          .prepare(
            "INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES ('e', ?, 0, 'text', 0, 0, 1, 1, '{oops')",
          )
          .run(slideId()),
    ],
    [
      'a negative element size',
      () =>
        db
          .prepare(
            "INSERT INTO elements (id, slide_id, position, kind, x, y, width, height) VALUES ('e', ?, 0, 'text', 0, 0, -1, 1)",
          )
          .run(slideId()),
    ],
    [
      'a slide in a group that does not exist',
      () => db.prepare("INSERT INTO slides (id, group_id, position) VALUES ('s', 'missing', 0)").run(),
    ],
    [
      'a zero auto-advance time',
      () =>
        db
          .prepare("INSERT INTO slides (id, group_id, position, auto_advance_ms) VALUES ('s', ?, 1, 0)")
          .run(groupId()),
    ],
    ['an unknown import source', () => db.prepare("UPDATE presentations SET source_kind = 'keynote'").run()],
    [
      'a playlist item whose kind does not match its reference',
      () => {
        db.prepare("INSERT INTO playlists (id, name) VALUES ('pl', 'Sunday')").run();
        db.prepare(
          "INSERT INTO playlist_items (id, playlist_id, position, kind) VALUES ('i', 'pl', 0, 'presentation')",
        ).run();
      },
    ],
    [
      'a screen with an unknown scaling mode',
      () => {
        db.prepare("INSERT INTO screen_groups (id, name) VALUES ('g', 'Hall')").run();
        db.prepare(
          "INSERT INTO screens (id, group_id, name, scaling) VALUES ('s', 'g', 'Left', 'zoom')",
        ).run();
      },
    ],
    [
      'a screen with a zero canvas',
      () => {
        db.prepare("INSERT INTO screen_groups (id, name) VALUES ('g', 'Hall')").run();
        db.prepare(
          "INSERT INTO screens (id, group_id, name, canvas_width) VALUES ('s', 'g', 'Left', 0)",
        ).run();
      },
    ],
    [
      'a screen display key that is not JSON',
      () => {
        db.prepare("INSERT INTO screen_groups (id, name) VALUES ('g', 'Hall')").run();
        db.prepare(
          "INSERT INTO screens (id, group_id, name, display_key) VALUES ('s', 'g', 'Left', 'HDMI-1')",
        ).run();
      },
    ],
    [
      'a timer of unknown kind',
      () => db.prepare("INSERT INTO timers (id, name, kind) VALUES ('t', 'T', 'egg')").run(),
    ],
    [
      'a user with an unknown role',
      () => db.prepare("INSERT INTO users (id, name, role) VALUES ('u', 'U', 'root')").run(),
    ],
  ])('rejects %s', (_label, write) => {
    expect(write).toThrow();
  });

  it('uses the defaults the brief asks for on screens', () => {
    db.prepare("INSERT INTO screen_groups (id, name) VALUES ('g', 'Hall')").run();
    db.prepare("INSERT INTO screens (id, group_id, name) VALUES ('s', 'g', 'Left')").run();
    expect(one('SELECT canvas_width, canvas_height, scaling, display_key FROM screens')).toEqual({
      canvas_width: 1920,
      canvas_height: 1080,
      scaling: 'fit',
      display_key: null,
    });
  });
});

describe('deleting', () => {
  it('a presentation removes its groups, slides, elements, kirtan data and playlist entries', () => {
    db.prepare("INSERT INTO playlists (id, name) VALUES ('pl', 'Sunday')").run();
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id) VALUES ('i', 'pl', 0, 'presentation', ?)",
    ).run(presentationId);
    expect(count('kirtan_track_lines')).toBe(2);
    db.prepare('DELETE FROM presentations WHERE id = ?').run(presentationId);
    for (const t of [
      'slide_groups',
      'slides',
      'elements',
      'kirtans',
      'kirtan_tracks',
      'kirtan_track_lines',
      'playlist_items',
    ]) {
      expect(count(t), t).toBe(0);
    }
    expect(count('playlists')).toBe(1);
  });

  it('a theme leaves its presentations in place', () => {
    db.prepare("INSERT INTO themes (id, name) VALUES ('t', 'Dark')").run();
    db.prepare("UPDATE presentations SET theme_id = 't'").run();
    db.prepare("DELETE FROM themes WHERE id = 't'").run();
    expect(one('SELECT theme_id FROM presentations')).toEqual({ theme_id: null });
  });

  it('a screen group removes its screens', () => {
    db.prepare("INSERT INTO screen_groups (id, name) VALUES ('g', 'Hall')").run();
    db.prepare("INSERT INTO screens (id, group_id, name) VALUES ('s', 'g', 'Left')").run();
    db.prepare("DELETE FROM screen_groups WHERE id = 'g'").run();
    expect(count('screens')).toBe(0);
  });
});
