import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { WantedMedia } from '../nodes/wanted-media';
import { MediaRemoval } from './media-removal';

/** A future-format fixture independent of the migration, so old readers fail on behaviour rather than SQL setup. */
function fixture() {
  const db = openDatabase(':memory:');
  for (const [table, column] of [
    ['presentations', 'editor_master'],
    ['slides', 'editor_design'],
  ] as const)
    if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
  for (const [i, id] of [
    'placeholder-slide-backdrop',
    'placeholder-master-backdrop',
    'placeholder-master-picture',
  ].entries())
    db.prepare('INSERT INTO media (id, kind, name, path, sha256, bytes) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      'image',
      'Placeholder picture',
      `${String(i + 1).repeat(64)}.png`,
      String(i + 1).repeat(64),
      100,
    );
  const repo = new PresentationRepo(db);
  const id = repo.insert({
    libraryId: repo.ensureLibrary('Placeholder design media'),
    name: 'Placeholder designed presentation',
    groups: [{ name: 'Placeholder group', slides: [{ elements: [] }] }],
  });
  const slide = repo.content(id)?.slides[0]?.id;
  if (!slide) throw new Error('no slide');
  const design = (mediaId: string) => ({ backdrop: { kind: 'picture', mediaId, fit: 'fill' } });
  db.prepare('UPDATE slides SET editor_design = ? WHERE id = ?').run(
    JSON.stringify(design('placeholder-slide-backdrop')),
    slide,
  );
  db.prepare('UPDATE presentations SET editor_master = ? WHERE id = ?').run(
    JSON.stringify({
      id: 'placeholder-master',
      label: 'Master',
      notes: '',
      background: null,
      darken: null,
      enabled: true,
      transition: null,
      autoAdvanceMs: null,
      macroId: null,
      cues: [],
      design: design('placeholder-master-backdrop'),
      elements: [
        {
          id: 'placeholder-master-image',
          kind: 'image',
          mediaId: 'placeholder-master-picture',
          fit: 'fill',
          frame: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
    }),
    id,
  );
  db.prepare('INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    'placeholder-playlist',
    'Placeholder weekly show',
    '2026-11-01T00:00:00.000Z',
    '2026-11-01T00:00:00.000Z',
  );
  db.prepare(
    'INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, label) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('placeholder-item', 'placeholder-playlist', 0, 'presentation', id, '');
  return { db };
}

describe('pictures used by a designed slide and its master', () => {
  it('are copied to nodes ahead of time with the week’s playlists, not only after they go live', () => {
    const { db } = fixture();
    try {
      const wanted = new WantedMedia(
        db,
        () => [],
        () => Date.parse('2026-11-02T00:00:00.000Z'),
      );
      expect(
        wanted
          .list(null, false)
          .map((m) => m.id)
          .sort(),
      ).toEqual(['placeholder-master-backdrop', 'placeholder-master-picture', 'placeholder-slide-backdrop']);
    } finally {
      db.close();
    }
  });
  it('name their presentation once in Delete’s usage question, wherever they are used', () => {
    const { db } = fixture();
    try {
      const removal = new MediaRemoval(db, { onScreens: () => new Set() });
      for (const id of [
        'placeholder-master-backdrop',
        'placeholder-master-picture',
        'placeholder-slide-backdrop',
      ])
        expect(removal.usage([id]).presentations).toEqual({
          names: ['Placeholder designed presentation'],
          count: 1,
        });
      expect(
        removal.usage([
          'placeholder-master-backdrop',
          'placeholder-master-picture',
          'placeholder-slide-backdrop',
        ]).presentations.count,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});
