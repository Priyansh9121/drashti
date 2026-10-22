import { isDeepStrictEqual } from 'node:util';
import { GROUP_COLOURS } from '../../shared/group-colors';
import { readContent } from '../db/content';
import { type Db, openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import {
  KIRTAN_PRESENTATION_NAME,
  KIRTAN_PRESENTATION_REF,
  PLACEHOLDERS_CHECKED_KEY,
  seedPlaceholders,
  TEST_PRESENTATION_NAME,
  TEST_PRESENTATION_REF,
} from '../db/seed';

/*
 * The placeholder presentations an earlier Drashti put in every new library ("Language test slides" and "Sample
 * kirtan (placeholder)", db/seed.ts), taken away at a library's first start on Session 50's Drashti: once per
 * library (PLACEHOLDERS_CHECKED_KEY), before anything is seeded. Each goes only when it is exactly as Drashti
 * made it (its words, slides, groups, arrangements, kirtan details and settings equal to a fresh make of
 * db/seed.ts's, and never saved since) and no row in the library names it (an item of a playlist or a template,
 * one taken out or deleted too, an arti schedule: any). One changed, saved again or used stays. It goes as the
 * library's trash takes a presentation (PresentationRepo.remove): kept 30 days before it is purged. The log
 * says what was done with each, by the name Drashti gave it (never words the operator wrote).
 */

/** Each placeholder by where it came from (its source: kind 'drashti', this ref), with the name Drashti gave it. */
const PLACEHOLDERS: ReadonlyMap<string, string> = new Map([
  [TEST_PRESENTATION_REF, TEST_PRESENTATION_NAME],
  [KIRTAN_PRESENTATION_REF, KIRTAN_PRESENTATION_NAME],
]);

/** The sample kirtan's Chorus as alpha.0 to alpha.4 made it: red, until Session 26g made it teal. */
const EARLIER_CHORUS = '#e5484d';

/** The presentation's own rows (its content, and its place in search): any other row that names it is a use. */
const OWN = new Set(['slide_groups', 'arrangements', 'kirtans', 'search_docs']);

/** The log's words for a row that names a placeholder; any other: "used in the library (its table)". */
const USE_WORDS: Readonly<Record<string, string>> = {
  playlist_items: 'in a playlist',
  arti_schedules: 'in an arti schedule',
};

/** A presentation as made, without the ids each make draws afresh: two makes of the same thing are equal. */
interface Made {
  presentation: unknown;
  groups: { color: string | null; [field: string]: unknown }[];
  arrangements: unknown[];
  kirtan: unknown;
}

interface Found {
  id: string;
  ref: string;
  content_rev: number;
  created_at: string;
  updated_at: string;
}

/**
 * At a library's first start on this Drashti: remove each placeholder presentation an earlier Drashti added that is
 * still exactly as Drashti made it and that nothing names, and remember it was done. Returns the log's lines, one
 * for each placeholder found (none in a library that never had them, and none once it was done).
 */
export function removeUntouchedPlaceholders(db: Db): string[] {
  if (db.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(PLACEHOLDERS_CHECKED_KEY)) return [];
  const lines: string[] = [];
  db.transaction(() => {
    const found = db
      .prepare(
        `SELECT id, source_ref AS ref, content_rev, created_at, updated_at FROM presentations
          WHERE source_kind = 'drashti' AND source_ref IN (?, ?) AND deleted_at IS NULL ORDER BY rowid`,
      )
      .all(...PLACEHOLDERS.keys()) as Found[];
    if (found.length > 0) {
      const makes = freshMakes();
      const uses = placeholderUses(db);
      const repo = new PresentationRepo(db);
      for (const p of found) {
        const why = whyKept(db, p, makes.get(p.ref) ?? [], uses);
        const name = PLACEHOLDERS.get(p.ref) ?? 'placeholder';
        if (why.length === 0) {
          repo.remove([p.id]);
          lines.push(`Removed the placeholder presentation “${name}”: unchanged and in no playlist`);
        } else lines.push(`Kept the placeholder presentation “${name}”: ${why.join(' and ')}`);
      }
    }
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(
      PLACEHOLDERS_CHECKED_KEY,
      new Date().toISOString(),
    );
  })();
  return lines;
}

/**
 * Every column that names a presentation (its foreign keys), table by table, but in the presentation's own rows:
 * a table added later that names one counts by itself.
 */
export function placeholderUses(db: Db): { table: string; column: string }[] {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%' ORDER BY name",
    )
    .pluck()
    .all() as string[];
  return tables
    .filter((table) => !OWN.has(table))
    .flatMap((table) =>
      (
        db.prepare('SELECT "table" AS target, "from" AS col FROM pragma_foreign_key_list(?)').all(table) as {
          target: string;
          col: string;
        }[]
      )
        .filter((key) => key.target === 'presentations')
        .map((key) => ({ table, column: key.col })),
    );
}

/** Why a placeholder stays (nothing: it goes): changed or saved again since Drashti made it, or named by a row. */
function whyKept(
  db: Db,
  p: Found,
  makes: readonly Made[],
  uses: readonly { table: string; column: string }[],
): string[] {
  const why: string[] = [];
  const made = madeOf(db, p.id);
  // Saved again, even unchanged: content_rev counts every write of its content (and updated_at moved with
  // each before migration 44 gave it one).
  const saved = p.content_rev !== 0 || p.updated_at !== p.created_at;
  if (saved || !makes.some((m) => isDeepStrictEqual(m, made))) why.push('changed');
  for (const { table, column } of uses) {
    if (!db.prepare(`SELECT 1 FROM "${table}" WHERE "${column}" = ? LIMIT 1`).get(p.id)) continue;
    const words = USE_WORDS[table] ?? `used in the library (${table})`;
    if (!why.includes(words)) why.push(words);
  }
  return why;
}

/**
 * How Drashti makes each placeholder, and how an earlier Drashti made it where that differs, by ref: made afresh
 * by db/seed.ts in a library of their own, which is thrown away.
 */
function freshMakes(): Map<string, Made[]> {
  const scratch = openDatabase(':memory:');
  try {
    seedPlaceholders(scratch);
    const makes = new Map<string, Made[]>();
    const rows = scratch.prepare('SELECT id, source_ref AS ref FROM presentations').all() as {
      id: string;
      ref: string;
    }[];
    for (const { id, ref } of rows) {
      const made = madeOf(scratch, id);
      if (made) makes.set(ref, [made, ...earlierMakes(ref, made)]);
    }
    return makes;
  } finally {
    scratch.close();
  }
}

/** The ways an earlier Drashti made a placeholder, where they differ from today's make. */
function earlierMakes(ref: string, made: Made): Made[] {
  if (ref !== KIRTAN_PRESENTATION_REF) return [];
  const red = made.groups.map((g) => (g.color === GROUP_COLOURS.teal ? { ...g, color: EARLIER_CHORUS } : g));
  return [{ ...made, groups: red }];
}

/**
 * A presentation as stored (db/content.ts reads it), every id left out and each row inside what holds it, in
 * order: its settings, its groups with their slides and each slide's elements, cues and the lines Drashti made,
 * its arrangements (by their groups' places) and its kirtan details. Null when it is gone.
 */
function madeOf(db: Db, id: string): Made | null {
  const presentation = db
    .prepare(
      `SELECT p.name, l.name AS library, p.width, p.height, p.theme_id, p.notes, p.transition, p.loop,
              p.source_kind, p.source_path, p.source_ref, p.source_imported_at, p.source_hash
         FROM presentations p JOIN libraries l ON l.id = p.library_id
        WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(id);
  const rows = readContent(db, id);
  if (presentation === undefined || !rows) return null;
  const groupPlace = new Map(rows.groups.map((g, i) => [g.id, i]));
  const slides = (groupId: string) =>
    rows.slides
      .filter((s) => s.group_id === groupId)
      .map((s) => {
        const { id: slideId, group_id: _group, ...slide } = s;
        return {
          ...slide,
          elements: rows.elements
            .filter((e) => e.slide_id === slideId)
            .map((e) => {
              const { id: _id, slide_id: _slide, props, ...element } = e;
              return { ...element, props: parsed(props) };
            }),
          cues: rows.cues
            .filter((c) => c.slide_id === slideId)
            .map((c) => {
              const { id: _id, slide_id: _slide, props, ...cue } = c;
              return { ...cue, props: parsed(props) };
            }),
          lines: rows.autoLines
            .filter((a) => a.slide_id === slideId)
            .map((a) => ({ lang: a.lang, text: a.text })),
        };
      });
  return {
    presentation,
    groups: rows.groups.map((g) => {
      const { id: groupId, ...group } = g;
      return { ...group, slides: slides(groupId) };
    }),
    arrangements: rows.arrangements.map((a) => {
      const { id: arrangementId, ...arrangement } = a;
      return {
        ...arrangement,
        groups: rows.arrangementEntries
          .filter((e) => e.arrangement_id === arrangementId)
          .map((e) => groupPlace.get(e.group_id) ?? -1),
        chosen: arrangementId === rows.selectedArrangementId,
      };
    }),
    kirtan: rows.kirtan,
  };
}

/** Stored JSON as its value (the order of its keys never counts), or the text itself when it is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
