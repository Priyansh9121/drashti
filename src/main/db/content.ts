import type { Lang, TextRun, Transition } from '../../shared/model';
import { transitionSchema } from '../../shared/model-schema';
import { type BoxWords, langsOfBoxes } from '../../shared/tracks';
import type { Db } from './database';

/*
 * A presentation's content exactly as stored, row by row with every id:
 * groups, slides (disabled ones too), elements, cues, arrangements, the
 * kirtan details and the transliteration lines Drashti made. Editing the
 * words or applying a theme reads it, changes what it must, and writes it
 * back; the ids stay, so arrangements, the live slide and playlists still
 * point at the same things, and Undo writes the earlier copy back.
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
  /** The macro it runs when it goes up, or null. */
  macro_id: string | null;
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
  /** JSON: the presentation's default transition, or null for the app's. */
  transition: string | null;
  /** 1: auto-advance loops from the last slide to the first. */
  loop: number;
  groups: GroupRow[];
  slides: SlideRow[];
  elements: ElementRow[];
  cues: CueRow[];
  arrangements: ArrangementRow[];
  arrangementEntries: ArrangementEntryRow[];
  /** The kirtan details, or null when it is not a kirtan (its words are in the slides either way). */
  kirtan: {
    row: {
      category: string | null;
      kavi: string | null;
      raag: string | null;
      /** JSON: a list of occasions. */
      occasions: string;
      audio_media_id: string | null;
    };
  } | null;
  /** Lines Drashti made (transliteration), as it made them: see migration 11. */
  autoLines: AutoLineRow[];
}

export interface AutoLineRow {
  slide_id: string;
  lang: string;
  text: string;
}

/** A presentation's content as stored (null if it does not exist or was removed). */
export function readContent(db: Db, presentationId: string): ContentRows | null {
  const p = db
    .prepare(
      'SELECT width, height, selected_arrangement_id, theme_id, transition, loop FROM presentations WHERE id = ? AND deleted_at IS NULL',
    )
    .get(presentationId) as
    | {
        width: number;
        height: number;
        selected_arrangement_id: string | null;
        theme_id: string | null;
        transition: string | null;
        loop: number;
      }
    | undefined;
  if (!p) return null;
  const groups = db
    .prepare(
      'SELECT id, name, color, position FROM slide_groups WHERE presentation_id = ? ORDER BY position, rowid',
    )
    .all(presentationId) as GroupRow[];
  const slides = db
    .prepare(
      `SELECT s.id, s.group_id, s.position, s.label, s.notes, s.background, s.transition, s.auto_advance_ms, s.enabled, s.macro_id
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
    .prepare('SELECT category, kavi, raag, occasions, audio_media_id FROM kirtans WHERE presentation_id = ?')
    .get(presentationId) as NonNullable<ContentRows['kirtan']>['row'] | undefined;
  const autoLines = db
    .prepare(
      `SELECT a.slide_id, a.lang, a.text FROM kirtan_auto_lines a
         JOIN slides s ON s.id = a.slide_id JOIN slide_groups g ON g.id = s.group_id
        WHERE g.presentation_id = ? ORDER BY a.slide_id, a.lang`,
    )
    .all(presentationId) as AutoLineRow[];
  return {
    presentationId,
    width: p.width,
    height: p.height,
    selectedArrangementId: p.selected_arrangement_id,
    themeId: p.theme_id,
    transition: p.transition,
    loop: p.loop,
    groups,
    slides,
    elements,
    cues,
    arrangements,
    arrangementEntries,
    kirtan: kirtanRow ? { row: kirtanRow } : null,
    autoLines,
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
    `INSERT INTO slides (id, group_id, position, label, notes, background, transition, auto_advance_ms, enabled, macro_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      s.macro_id,
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
      'INSERT INTO kirtans (presentation_id, category, kavi, raag, occasions, audio_media_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, k.category, k.kavi, k.raag, k.occasions, k.audio_media_id);
  }
  const slideIds = new Set(rows.slides.map((s) => s.id));
  const auto = db.prepare('INSERT INTO kirtan_auto_lines (slide_id, lang, text) VALUES (?, ?, ?)');
  for (const a of rows.autoLines) if (slideIds.has(a.slide_id)) auto.run(a.slide_id, a.lang, a.text);
  const arrangementIds = new Set(rows.arrangements.map((a) => a.id));
  const selected =
    rows.selectedArrangementId !== null && arrangementIds.has(rows.selectedArrangementId)
      ? rows.selectedArrangementId
      : null;
  const slideCount = rows.slides.filter((s) => s.enabled === 1).length;
  const tracks = rows.kirtan ? kirtanLangs(rows).join(',') : null;
  db.prepare(
    `UPDATE presentations SET selected_arrangement_id = ?, theme_id = ?, transition = ?, loop = ?, slide_count = ?,
       kirtan_tracks = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  ).run(selected, rows.themeId, rows.transition, rows.loop, slideCount, tracks, id);
}

/** The languages a kirtan's slides that play have words in: its tracks. */
export function kirtanLangs(rows: ContentRows): Lang[] {
  const played = new Set(rows.slides.filter((s) => s.enabled === 1).map((s) => s.id));
  return langsOfRows(rows.elements.filter((e) => played.has(e.slide_id)));
}

/** The languages these elements have words in (text boxes only; their props as stored). */
export function langsOfRows(elements: readonly ElementRow[]): Lang[] {
  const boxes: BoxWords[] = [];
  for (const e of elements) {
    if (e.kind !== 'text') continue;
    try {
      const p = JSON.parse(e.props) as { text?: unknown; lang?: unknown; runs?: unknown };
      if (typeof p.text !== 'string') continue;
      const lang = typeof p.lang === 'string' ? (p.lang as BoxWords['lang']) : null;
      boxes.push(
        Array.isArray(p.runs) ? { text: p.text, lang, runs: p.runs as TextRun[] } : { text: p.text, lang },
      );
    } catch {
      // Unreadable: no words to count.
    }
  }
  return langsOfBoxes(boxes);
}

/** A transition as stored (JSON), or null when there is none or it cannot be read. */
export function transitionFromJson(text: string | null): Transition | null {
  if (text === null) return null;
  try {
    const parsed = transitionSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A transition as stored. */
export function transitionToJson(transition: Transition | null | undefined): string | null {
  return transition ? JSON.stringify({ kind: transition.kind, durationMs: transition.durationMs }) : null;
}
