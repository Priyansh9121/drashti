import type { Db } from '../db/database';

/*
 * After a conversion, everything that used the original uses the converted
 * file: slides' background and sound cues, pictures and videos placed on
 * slides, playlist items, props, theme backgrounds and kirtan recordings.
 * What was moved is kept, so Undo puts back exactly those rows that still
 * point at the converted file.
 */

export interface Moved {
  cues: string[];
  items: string[];
  kirtans: string[];
  elements: string[];
  props: string[];
  themes: string[];
  /** Audio playlists' tracks (Session 14; left out by conversions made before). */
  tracks?: string[];
}

export const NOTHING_MOVED: Moved = {
  cues: [],
  items: [],
  kirtans: [],
  elements: [],
  props: [],
  themes: [],
  tracks: [],
};

/** A copy of a JSON value with every `mediaId` equal to `from` set to `to`. */
function swapIds(value: unknown, from: string, to: string): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = swapIds(v, from, to);
      changed ||= r.changed;
      return r.value;
    });
    return { value: out, changed };
  }
  if (value !== null && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'mediaId' && v === from) {
        out[k] = to;
        changed = true;
      } else {
        const r = swapIds(v, from, to);
        changed ||= r.changed;
        out[k] = r.value;
      }
    }
    return { value: out, changed };
  }
  return { value, changed: false };
}

/** Rows of a JSON column that mention `from` as a mediaId, with it swapped for `to`; written, and their ids returned. */
function swapJson(
  db: Db,
  table: 'props' | 'themes',
  from: string,
  to: string,
  only?: readonly string[],
): string[] {
  const rows = db.prepare(`SELECT id, definition FROM ${table} WHERE instr(definition, ?) > 0`).all(from) as {
    id: string;
    definition: string;
  }[];
  const write = db.prepare(`UPDATE ${table} SET definition = ? WHERE id = ?`);
  const done: string[] = [];
  for (const row of rows) {
    if (only && !only.includes(row.id)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.definition);
    } catch {
      continue;
    }
    const swapped = swapIds(parsed, from, to);
    if (!swapped.changed) continue;
    write.run(JSON.stringify(swapped.value), row.id);
    done.push(row.id);
  }
  return done;
}

/** Point everything that uses `from` at `to` (one transaction); returns what moved. */
export function moveMedia(db: Db, from: string, to: string): Moved {
  return db.transaction((): Moved => {
    const ids = (sql: string) => (db.prepare(sql).all(from) as { id: string }[]).map((r) => r.id);
    const cues = ids('SELECT id FROM slide_cues WHERE media_id = ?');
    const items = ids('SELECT id FROM playlist_items WHERE media_id = ?');
    const tracks = ids('SELECT id FROM audio_playlist_tracks WHERE media_id = ?');
    const kirtans = (
      db.prepare('SELECT presentation_id AS id FROM kirtans WHERE audio_media_id = ?').all(from) as {
        id: string;
      }[]
    ).map((r) => r.id);
    const elements = ids(
      "SELECT id FROM elements WHERE kind IN ('image', 'video') AND json_extract(props, '$.mediaId') = ?",
    );
    db.prepare('UPDATE slide_cues SET media_id = ? WHERE media_id = ?').run(to, from);
    db.prepare('UPDATE playlist_items SET media_id = ? WHERE media_id = ?').run(to, from);
    db.prepare('UPDATE audio_playlist_tracks SET media_id = ? WHERE media_id = ?').run(to, from);
    db.prepare('UPDATE kirtans SET audio_media_id = ? WHERE audio_media_id = ?').run(to, from);
    const element = db.prepare("UPDATE elements SET props = json_set(props, '$.mediaId', ?) WHERE id = ?");
    for (const id of elements) element.run(to, id);
    const props = swapJson(db, 'props', from, to);
    const themes = swapJson(db, 'themes', from, to);
    return { cues, items, kirtans, elements, props, themes, tracks };
  })();
}

/** Undo: the rows that moved, and still point at `to`, point at `from` again. */
export function moveBack(db: Db, moved: Moved, from: string, to: string): void {
  db.transaction(() => {
    const back = (sql: string, ids: readonly string[]) => {
      const stmt = db.prepare(sql);
      for (const id of ids) stmt.run(from, id, to);
    };
    back('UPDATE slide_cues SET media_id = ? WHERE id = ? AND media_id = ?', moved.cues);
    back('UPDATE playlist_items SET media_id = ? WHERE id = ? AND media_id = ?', moved.items);
    back('UPDATE audio_playlist_tracks SET media_id = ? WHERE id = ? AND media_id = ?', moved.tracks ?? []);
    back(
      'UPDATE kirtans SET audio_media_id = ? WHERE presentation_id = ? AND audio_media_id = ?',
      moved.kirtans,
    );
    back(
      "UPDATE elements SET props = json_set(props, '$.mediaId', ?) WHERE id = ? AND json_extract(props, '$.mediaId') = ?",
      moved.elements,
    );
    swapJson(db, 'props', to, from, moved.props);
    swapJson(db, 'themes', to, from, moved.themes);
  })();
}

/** The presentations whose slides moved (their slides are read again before they go live). */
export function presentationsMoved(db: Db, moved: Moved): string[] {
  const out = new Set<string>();
  const of = db.prepare(
    `SELECT g.presentation_id AS id FROM slides s JOIN slide_groups g ON g.id = s.group_id WHERE s.id = ?`,
  );
  const cueSlide = db.prepare('SELECT slide_id AS id FROM slide_cues WHERE id = ?');
  const elementSlide = db.prepare('SELECT slide_id AS id FROM elements WHERE id = ?');
  for (const id of moved.cues) {
    const slide = (cueSlide.get(id) as { id: string } | undefined)?.id;
    const p = slide ? (of.get(slide) as { id: string } | undefined)?.id : undefined;
    if (p) out.add(p);
  }
  for (const id of moved.elements) {
    const slide = (elementSlide.get(id) as { id: string } | undefined)?.id;
    const p = slide ? (of.get(slide) as { id: string } | undefined)?.id : undefined;
    if (p) out.add(p);
  }
  for (const id of moved.kirtans) out.add(id);
  return [...out];
}
