import type { Db } from './database';

/*
 * A presentation's content exactly as stored, row by row with every id:
 * groups, slides (disabled ones too), elements, cues, arrangements and
 * kirtan lines. Editing the words or applying a theme reads it, changes
 * what it must, and writes it back; the ids stay, so arrangements, the live
 * slide and playlists still point at the same things, and Undo writes the
 * earlier copy back.
 */

export interface GroupRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
}
export interface SlideRow {
  id: string;
  group_id: string;
  position: number;
  label: string;
  notes: string;
  background: string | null;
  transition: string | null;
  auto_advance_ms: number | null;
  enabled: number;
}
export interface ElementRow {
  id: string;
  slide_id: string;
  position: number;
  kind: 'text' | 'shape' | 'image' | 'video';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** JSON: the element's own data (text, style and runs; fill; media). */
  props: string;
}
export interface CueRow {
  id: string;
  slide_id: string;
  position: number;
  kind: string;
  label: string;
  media_id: string | null;
  props: string;
}
export interface ArrangementRow {
  id: string;
  name: string;
  position: number;
  source_ref: string | null;
}
export interface ArrangementEntryRow {
  arrangement_id: string;
  position: number;
  group_id: string;
}

export interface ContentRows {
  presentationId: string;
  /** The presentation's size (read only: slides are laid out on it). */
  width: number;
  height: number;
  selectedArrangementId: string | null;
  themeId: string | null;
  groups: GroupRow[];
  slides: SlideRow[];
  elements: ElementRow[];
  cues: CueRow[];
  arrangements: ArrangementRow[];
  arrangementEntries: ArrangementEntryRow[];
  kirtan: {
    row: {
      category: string | null;
      kavi: string | null;
      raag: string | null;
      occasion: string | null;
      audio_url: string | null;
    };
    tracks: { lang: string; origin: string }[];
    lines: { lang: string; slide_id: string; text: string }[];
  } | null;
}

/** A presentation's content as stored (null if it does not exist or was removed). */
export function readContent(db: Db, presentationId: string): ContentRows | null {
  const p = db
    .prepare(
      'SELECT width, height, selected_arrangement_id, theme_id FROM presentations WHERE id = ? AND deleted_at IS NULL',
    )
    .get(presentationId) as
    | { width: number; height: number; selected_arrangement_id: string | null; theme_id: string | null }
    | undefined;
  if (!p) return null;
  const groups = db
    .prepare(
      'SELECT id, name, color, position FROM slide_groups WHERE presentation_id = ? ORDER BY position, rowid',
    )
    .all(presentationId) as GroupRow[];
  const slides = db
    .prepare(
      `SELECT s.id, s.group_id, s.position, s.label, s.notes, s.background, s.transition, s.auto_advance_ms, s.enabled
         FROM slides s JOIN slide_groups g ON g.id = s.group_id
        WHERE g.presentation_id = ? ORDER BY g.position, g.rowid, s.position, s.rowid`,
    )
    .all(presentationId) as SlideRow[];
  const elements = db
    .prepare(
      `SELECT e.id, e.slide_id, e.position, e.kind, e.x, e.y, e.width, e.height, e.rotation, e.props
         FROM elements e JOIN slides s ON s.id = e.slide_id JOIN slide_groups g ON g.id = s.group_id
        WHERE g.presentation_id = ? ORDER BY e.slide_id, e.position, e.rowid`,
    )
    .all(presentationId) as ElementRow[];
  const cues = db
    .prepare(
      `SELECT c.id, c.slide_id, c.position, c.kind, c.label, c.media_id, c.props
         FROM slide_cues c JOIN slides s ON s.id = c.slide_id JOIN slide_groups g ON g.id = s.group_id
        WHERE g.presentation_id = ? ORDER BY c.slide_id, c.position`,
    )
    .all(presentationId) as CueRow[];
  const arrangements = db
    .prepare(
      'SELECT id, name, position, source_ref FROM arrangements WHERE presentation_id = ? ORDER BY position, rowid',
    )
    .all(presentationId) as ArrangementRow[];
  const arrangementEntries = db
    .prepare(
      `SELECT ag.arrangement_id, ag.position, ag.group_id FROM arrangement_groups ag
         JOIN arrangements a ON a.id = ag.arrangement_id WHERE a.presentation_id = ? ORDER BY ag.arrangement_id, ag.position`,
    )
    .all(presentationId) as ArrangementEntryRow[];
  const kirtanRow = db
    .prepare('SELECT category, kavi, raag, occasion, audio_url FROM kirtans WHERE presentation_id = ?')
    .get(presentationId) as NonNullable<ContentRows['kirtan']>['row'] | undefined;
  const kirtan = kirtanRow
    ? {
        row: kirtanRow,
        tracks: db
          .prepare('SELECT lang, origin FROM kirtan_tracks WHERE kirtan_id = ?')
          .all(presentationId) as {
          lang: string;
          origin: string;
        }[],
        lines: db
          .prepare('SELECT lang, slide_id, text FROM kirtan_track_lines WHERE kirtan_id = ?')
          .all(presentationId) as { lang: string; slide_id: string; text: string }[],
      }
    : null;
  return {
    presentationId,
    width: p.width,
    height: p.height,
    selectedArrangementId: p.selected_arrangement_id,
    themeId: p.theme_id,
    groups,
    slides,
    elements,
    cues,
    arrangements,
    arrangementEntries,
    kirtan,
  };
}

/**
 * Replace a presentation's content with these rows, ids and all, in the
 * caller's transaction. Keeps the stored counts the library list shows.
 */
export function writeContent(db: Db, rows: ContentRows): void {
  const id = rows.presentationId;
  // Groups cascade to slides, elements, cues, arrangement entries and kirtan lines.
  db.prepare('DELETE FROM slide_groups WHERE presentation_id = ?').run(id);
  db.prepare('DELETE FROM arrangements WHERE presentation_id = ?').run(id);
  db.prepare('DELETE FROM kirtans WHERE presentation_id = ?').run(id);
  const group = db.prepare(
    'INSERT INTO slide_groups (id, presentation_id, name, color, position) VALUES (?, ?, ?, ?, ?)',
  );
  for (const g of rows.groups) group.run(g.id, id, g.name, g.color, g.position);
  const slide = db.prepare(
    `INSERT INTO slides (id, group_id, position, label, notes, background, transition, auto_advance_ms, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of rows.slides)
    slide.run(
      s.id,
      s.group_id,
      s.position,
      s.label,
      s.notes,
      s.background,
      s.transition,
      s.auto_advance_ms,
      s.enabled,
    );
  const element = db.prepare(
    `INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, rotation, props)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of rows.elements)
    element.run(e.id, e.slide_id, e.position, e.kind, e.x, e.y, e.width, e.height, e.rotation, e.props);
  const cue = db.prepare(
    'INSERT INTO slide_cues (id, slide_id, position, kind, label, media_id, props) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const c of rows.cues) cue.run(c.id, c.slide_id, c.position, c.kind, c.label, c.media_id, c.props);
  const arrangement = db.prepare(
    'INSERT INTO arrangements (id, presentation_id, name, position, source_ref) VALUES (?, ?, ?, ?, ?)',
  );
  for (const a of rows.arrangements) arrangement.run(a.id, id, a.name, a.position, a.source_ref);
  const entry = db.prepare(
    'INSERT INTO arrangement_groups (arrangement_id, position, group_id) VALUES (?, ?, ?)',
  );
  for (const e of rows.arrangementEntries) entry.run(e.arrangement_id, e.position, e.group_id);
  if (rows.kirtan) {
    const k = rows.kirtan.row;
    db.prepare(
      'INSERT INTO kirtans (presentation_id, category, kavi, raag, occasion, audio_url) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, k.category, k.kavi, k.raag, k.occasion, k.audio_url);
    const track = db.prepare('INSERT INTO kirtan_tracks (kirtan_id, lang, origin) VALUES (?, ?, ?)');
    for (const t of rows.kirtan.tracks) track.run(id, t.lang, t.origin);
    const slideIds = new Set(rows.slides.map((s) => s.id));
    const line = db.prepare(
      'INSERT INTO kirtan_track_lines (kirtan_id, lang, slide_id, text) VALUES (?, ?, ?, ?)',
    );
    for (const l of rows.kirtan.lines) if (slideIds.has(l.slide_id)) line.run(id, l.lang, l.slide_id, l.text);
  }
  const arrangementIds = new Set(rows.arrangements.map((a) => a.id));
  const selected =
    rows.selectedArrangementId !== null && arrangementIds.has(rows.selectedArrangementId)
      ? rows.selectedArrangementId
      : null;
  const slideCount = rows.slides.filter((s) => s.enabled === 1).length;
  const tracks = rows.kirtan ? rows.kirtan.tracks.map((t) => t.lang).join(',') : null;
  db.prepare(
    `UPDATE presentations SET selected_arrangement_id = ?, theme_id = ?, slide_count = ?, kirtan_tracks = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  ).run(selected, rows.themeId, slideCount, tracks, id);
}
