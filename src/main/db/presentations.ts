import type { Statement } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { MediaFit } from '../../shared/engine/state';
import type {
  ArrangementInfo,
  GroupInfo,
  ImportSource,
  PresentationDoc,
  PresentationSummary,
  SlideCue,
  SlideInfo,
} from '../../shared/library';
import type { KirtanDetails } from '../../shared/kirtans';
import { occasionsFrom } from '../../shared/kirtans';
import { type Lang, LANGS, type RenderSlide, type SlideElement, type Transition } from '../../shared/model';
import { slideElementSchema } from '../../shared/model-schema';
import { langsOf } from '../../shared/tracks';
import type { PlayOrder, SlideSource } from '../engine/slide-source';
import { playOrder } from '../../shared/order';
import type { Db } from './database';
import type { ContentRows } from './content';
import { readContent, transitionFromJson, transitionToJson, writeContent } from './content';
import { SearchIndex } from './search';

interface SourceColumns {
  source_kind: ImportSource['kind'] | null;
  source_path: string | null;
  source_ref: string | null;
  source_imported_at: string | null;
}

function toSource(row: SourceColumns): ImportSource | null {
  if (!row.source_kind) return null;
  return {
    kind: row.source_kind,
    path: row.source_path,
    ref: row.source_ref,
    importedAt: row.source_imported_at,
  };
}

function toLangs(csv: string | null): Lang[] {
  if (!csv) return [];
  const set = new Set(csv.split(','));
  return LANGS.filter((l) => set.has(l));
}

interface ElementRow {
  id: string;
  slide_id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise (its own column, never in props). */
  rotation?: number;
  props: string;
}

export interface CueRow {
  slide_id: string;
  kind: string;
  label: string;
  props: string;
  media_id: string | null;
  media_name: string | null;
  media_kind: string | null;
  media_missing: number | null;
  media_playable?: number | null;
  media_format?: string | null;
}

const FITS: readonly string[] = ['fit', 'fill', 'stretch'] satisfies MediaFit[];

function propsOf(row: CueRow): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(row.props);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    // Keep the defaults.
  }
  return {};
}

/**
 * A stored cue as the engine runs it; null for kinds Drashti does not run
 * yet, and for cues whose media item is gone.
 */
export function cueFromRow(row: CueRow): SlideCue | null {
  if (!row.media_id) return null;
  const media = row.media_kind;
  const props = propsOf(row);
  const unplayable =
    row.media_playable === 0 ? (row.media_format ?? 'a kind of file Drashti cannot play') : null;
  if (row.kind === 'audio') {
    // A video file's sound plays too.
    if (media !== 'audio' && media !== 'video') return null;
    const volume =
      typeof props['volume'] === 'number' && Number.isFinite(props['volume']) ? props['volume'] : 1;
    return {
      kind: 'audio',
      label: row.label,
      name: row.media_name ?? '',
      missing: row.media_missing === 1,
      unplayable,
      mediaId: row.media_id,
      volume: Math.min(1, Math.max(0, volume)),
      loop: props['loop'] === true,
    };
  }
  if (row.kind !== 'background' || (media !== 'image' && media !== 'video')) return null;
  const fit =
    typeof props['fit'] === 'string' && FITS.includes(props['fit']) ? (props['fit'] as MediaFit) : 'fit';
  return {
    kind: 'background',
    label: row.label,
    name: row.media_name ?? '',
    missing: row.media_missing === 1,
    unplayable,
    background: {
      kind: 'media',
      mediaId: row.media_id,
      media,
      fit,
      loop: media === 'video' && props['loop'] === true,
    },
  };
}

/** Turn a stored element into a render element; null when it is invalid or not drawable yet. */
export function elementFromRow(row: ElementRow): SlideElement | null {
  let props: unknown;
  try {
    props = JSON.parse(row.props);
  } catch {
    return null;
  }
  if (typeof props !== 'object' || props === null) return null;
  const candidate = {
    ...props,
    id: row.id,
    kind: row.kind,
    frame: { x: row.x, y: row.y, width: row.width, height: row.height },
    ...(row.rotation ? { rotation: row.rotation } : {}),
  };
  const parsed = slideElementSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export interface NewSlide {
  label?: string;
  notes?: string;
  background?: string | null;
  /** Disabled slides are kept but skipped in the show (ProPresenter can disable slides). */
  enabled?: boolean;
  elements: SlideElement[];
  /** What else happens when the slide goes live (see migration 4). */
  cues?: NewSlideCue[];
  /** Its own transition; left out or null for the presentation's. */
  transition?: Transition | null;
  /** Moves on by itself after this long; left out or null to wait for the operator. */
  autoAdvanceMs?: number | null;
}

export interface NewSlideCue {
  kind: 'background' | 'audio' | 'media' | 'clear' | 'message' | 'timer' | 'other';
  label: string;
  mediaId: string | null;
  props?: Record<string, unknown>;
}

export interface NewPresentation {
  libraryId: string;
  name: string;
  width?: number;
  height?: number;
  notes?: string;
  groups: { name: string; color?: string | null; slides: NewSlide[] }[];
  /** Named orders of groups, as indexes into `groups` (repeats allowed); ref: its id in the source file. */
  arrangements?: { name: string; groups: number[]; ref?: string | null }[];
  /** The arrangement it plays in (an index into `arrangements`), or null/left out for every slide. */
  selectedArrangement?: number | null;
  /** The transition for slides without their own; left out or null for the app's default. */
  transition?: Transition | null;
  /** Auto-advance loops from the last slide to the first. */
  loop?: boolean;
  /**
   * Makes it a kirtan, with these details. Its tracks are the languages of
   * its slides' words: nothing else to give.
   */
  kirtan?: Partial<KirtanDetails>;
  source?: ImportSource | null;
  /** sha256 of the source file, to recognise a re-import. */
  sourceHash?: string | null;
}

/** An earlier import of a file, found by the file's own id or its path. */
export interface ImportedMatch {
  id: string;
  name: string;
  sourcePath: string | null;
  sourceHash: string | null;
}

interface ListRow {
  id: string;
  name: string;
  width: number;
  height: number;
  slide_count: number;
  kirtan_tracks: string | null;
}

export class PresentationRepo {
  private librariesStmt: Statement<[], { id: string; name: string }> | null = null;
  private listStmt: Statement<[string], ListRow> | null = null;

  /** Elements that failed validation on the last get(), for diagnostics. */
  skippedElements: string[] = [];
  private readonly search: SearchIndex;

  constructor(private readonly db: Db) {
    this.search = new SearchIndex(db);
  }

  ensureLibrary(name: string): string {
    const found = this.db.prepare('SELECT id FROM libraries WHERE name = ?').get(name) as
      { id: string } | undefined;
    if (found) return found.id;
    const id = randomUUID();
    this.db.prepare('INSERT INTO libraries (id, name) VALUES (?, ?)').run(id, name);
    return id;
  }

  /**
   * Every presentation, for the library list, library by library. Cheap at
   * any size: slide counts and kirtan languages are kept on the presentation
   * (migration 5), and an index gives each library's presentations in order.
   */
  list(): PresentationSummary[] {
    this.librariesStmt ??= this.db.prepare('SELECT id, name FROM libraries ORDER BY position, name');
    this.listStmt ??= this.db.prepare(
      `SELECT id, name, width, height, slide_count, kirtan_tracks FROM presentations
        WHERE library_id = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE`,
    );
    const list = this.listStmt;
    return this.librariesStmt.all().flatMap((library) =>
      list.all(library.id).map((r) => ({
        id: r.id,
        name: r.name,
        libraryName: library.name,
        slideCount: r.slide_count,
        width: r.width,
        height: r.height,
        kirtanTracks: r.kirtan_tracks === null ? null : toLangs(r.kirtan_tracks),
      })),
    );
  }

  get(id: string): PresentationDoc | null {
    const p = this.db
      .prepare(
        'SELECT id, name, width, height, selected_arrangement_id, transition, loop, source_kind, source_path, source_ref, source_imported_at FROM presentations WHERE id = ? AND deleted_at IS NULL',
      )
      .get(id) as
      | (SourceColumns & {
          id: string;
          name: string;
          width: number;
          height: number;
          selected_arrangement_id: string | null;
          transition: string | null;
          loop: number;
        })
      | undefined;
    if (!p) return null;
    const arrangements: ArrangementInfo[] = [];
    for (const row of this.db
      .prepare(
        `SELECT a.id, a.name, ag.group_id FROM arrangements a
           LEFT JOIN arrangement_groups ag ON ag.arrangement_id = a.id
          WHERE a.presentation_id = ?
          ORDER BY a.position, a.rowid, ag.position`,
      )
      .all(id) as { id: string; name: string; group_id: string | null }[]) {
      let a = arrangements.at(-1);
      if (a?.id !== row.id) {
        a = { id: row.id, name: row.name, groupIds: [] };
        arrangements.push(a);
      }
      if (row.group_id) a.groupIds.push(row.group_id);
    }
    const groups = this.db
      .prepare('SELECT id, name, color FROM slide_groups WHERE presentation_id = ? ORDER BY position, rowid')
      .all(id) as { id: string; name: string; color: string | null }[];
    const slides = this.db
      .prepare(
        `SELECT s.id, s.group_id, s.label, s.notes, s.background, s.transition, s.auto_advance_ms
           FROM slides s JOIN slide_groups g ON g.id = s.group_id
          WHERE g.presentation_id = ? AND s.enabled = 1
          ORDER BY g.position, g.rowid, s.position, s.rowid`,
      )
      .all(id) as {
      id: string;
      group_id: string;
      label: string;
      notes: string;
      background: string | null;
      transition: string | null;
      auto_advance_ms: number | null;
    }[];
    const elements = this.db
      .prepare(
        `SELECT e.id, e.slide_id, e.kind, e.x, e.y, e.width, e.height, e.rotation, e.props
           FROM elements e JOIN slides s ON s.id = e.slide_id JOIN slide_groups g ON g.id = s.group_id
          WHERE g.presentation_id = ?
          ORDER BY e.slide_id, e.position, e.rowid`,
      )
      .all(id) as ElementRow[];

    this.skippedElements = [];
    const bySlide = new Map<string, SlideElement[]>();
    for (const row of elements) {
      const element = elementFromRow(row);
      if (!element) {
        if (row.kind === 'text' || row.kind === 'shape') this.skippedElements.push(row.id);
        continue;
      }
      const list = bySlide.get(row.slide_id) ?? [];
      list.push(element);
      bySlide.set(row.slide_id, list);
    }

    const cueRows = this.db
      .prepare(
        `SELECT c.slide_id, c.kind, c.label, c.props, c.media_id,
                m.name AS media_name, m.kind AS media_kind, m.missing AS media_missing,
                m.playable AS media_playable, m.format AS media_format
           FROM slide_cues c JOIN slides s ON s.id = c.slide_id JOIN slide_groups g ON g.id = s.group_id
           LEFT JOIN media m ON m.id = c.media_id
          WHERE g.presentation_id = ?
          ORDER BY c.slide_id, c.position`,
      )
      .all(id) as CueRow[];
    const cuesBySlide = new Map<string, SlideCue[]>();
    for (const row of cueRows) {
      const cue = cueFromRow(row);
      if (!cue) continue;
      const list = cuesBySlide.get(row.slide_id) ?? [];
      list.push(cue);
      cuesBySlide.set(row.slide_id, list);
    }

    const groupInfos = new Map<string, GroupInfo>(
      groups.map((g) => [g.id, { id: g.id, name: g.name, color: g.color, slides: [] }]),
    );
    slides.forEach((s, index) => {
      const slide: RenderSlide = {
        id: s.id,
        width: p.width,
        height: p.height,
        background: s.background,
        elements: bySlide.get(s.id) ?? [],
      };
      const info: SlideInfo = {
        id: s.id,
        index,
        label: s.label,
        notes: s.notes,
        slide,
        cues: cuesBySlide.get(s.id) ?? [],
        transition: transitionFromJson(s.transition),
        autoAdvanceMs: s.auto_advance_ms,
      };
      groupInfos.get(s.group_id)?.slides.push(info);
    });

    const kirtanRow = this.db
      .prepare(
        'SELECT category, kavi, raag, occasions, audio_media_id FROM kirtans WHERE presentation_id = ?',
      )
      .get(id) as
      | {
          category: string | null;
          kavi: string | null;
          raag: string | null;
          occasions: string;
          audio_media_id: string | null;
        }
      | undefined;
    const groupList = [...groupInfos.values()];
    let kirtan: PresentationDoc['kirtan'] = null;
    if (kirtanRow) {
      kirtan = {
        category: kirtanRow.category,
        kavi: kirtanRow.kavi,
        raag: kirtanRow.raag,
        occasions: occasionsFrom(kirtanRow.occasions),
        audioMediaId: kirtanRow.audio_media_id,
        tracks: langsOf(groupList.flatMap((g) => g.slides.flatMap((s) => s.slide.elements))),
      };
      // Each screen shows a kirtan's slides in its own languages.
      for (const g of groupList) for (const s of g.slides) s.slide.kirtan = true;
    }

    return {
      id: p.id,
      name: p.name,
      width: p.width,
      height: p.height,
      groups: groupList,
      arrangements,
      selectedArrangementId: p.selected_arrangement_id,
      transition: transitionFromJson(p.transition),
      loop: p.loop === 1,
      kirtan,
      source: toSource(p),
    };
  }

  /** A kirtan's details as stored; null when it is not a kirtan (or is gone). */
  kirtanDetails(id: string): KirtanDetails | null {
    const k = this.db
      .prepare(
        'SELECT category, kavi, raag, occasions, audio_media_id FROM kirtans WHERE presentation_id = ?',
      )
      .get(id) as
      | {
          category: string | null;
          kavi: string | null;
          raag: string | null;
          occasions: string;
          audio_media_id: string | null;
        }
      | undefined;
    return k
      ? {
          category: k.category,
          kavi: k.kavi,
          raag: k.raag,
          occasions: occasionsFrom(k.occasions),
          audioMediaId: k.audio_media_id,
        }
      : null;
  }

  /** A presentation's content as stored, ids and all (see content.ts); null if it is gone. */
  content(id: string): ContentRows | null {
    return readContent(this.db, id);
  }

  /** Put content back (edited words, a theme, Undo), search index included, in one transaction. */
  setContent(rows: ContentRows): void {
    this.db.transaction(() => {
      writeContent(this.db, rows);
      this.search.update(rows.presentationId);
    })();
  }

  /** Choose the order a presentation plays in: one of its arrangements, or null for every slide. */
  setSelectedArrangement(presentationId: string, arrangementId: string | null): boolean {
    if (arrangementId !== null) {
      const own = this.db
        .prepare('SELECT 1 FROM arrangements WHERE id = ? AND presentation_id = ?')
        .get(arrangementId, presentationId);
      if (!own) return false;
    }
    return (
      this.db
        .prepare('UPDATE presentations SET selected_arrangement_id = ? WHERE id = ? AND deleted_at IS NULL')
        .run(arrangementId, presentationId).changes === 1
    );
  }

  /** Insert a whole presentation in one transaction; returns its id. */
  insert(input: NewPresentation): string {
    const id = randomUUID();
    this.db.transaction(() => {
      const s = input.source ?? null;
      this.db
        .prepare(
          `INSERT INTO presentations (id, library_id, name, width, height, notes, transition, loop, source_kind, source_path, source_ref, source_imported_at, source_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.libraryId,
          input.name,
          input.width ?? 1920,
          input.height ?? 1080,
          input.notes ?? '',
          transitionToJson(input.transition),
          input.loop ? 1 : 0,
          s?.kind ?? null,
          s?.path ?? null,
          s?.ref ?? null,
          s?.importedAt ?? null,
          input.sourceHash ?? null,
        );
      this.writeContent(id, input);
    })();
    return id;
  }

  /**
   * Replace a presentation's content (groups, slides, arrangements, kirtan
   * lines) and source in one transaction. It keeps its id, library and name,
   * so playlists and the operator's renaming survive a re-import.
   */
  replace(id: string, input: NewPresentation): boolean {
    let found = false;
    this.db.transaction(() => {
      const s = input.source ?? null;
      const changed = this.db
        .prepare(
          `UPDATE presentations SET width = ?, height = ?, notes = ?, transition = ?, loop = ?, source_kind = ?,
             source_path = ?, source_ref = ?, source_imported_at = ?, source_hash = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(
          input.width ?? 1920,
          input.height ?? 1080,
          input.notes ?? '',
          transitionToJson(input.transition),
          input.loop ? 1 : 0,
          s?.kind ?? null,
          s?.path ?? null,
          s?.ref ?? null,
          s?.importedAt ?? null,
          input.sourceHash ?? null,
          id,
        );
      if (changed.changes === 0) return;
      found = true;
      // Groups cascade to slides, elements and arrangement entries.
      this.db.prepare('DELETE FROM slide_groups WHERE presentation_id = ?').run(id);
      this.db.prepare('DELETE FROM arrangements WHERE presentation_id = ?').run(id);
      this.db.prepare('DELETE FROM kirtans WHERE presentation_id = ?').run(id);
      this.writeContent(id, input);
    })();
    return found;
  }

  private writeContent(id: string, input: NewPresentation): void {
    const db = this.db;
    const insertGroup = db.prepare(
      'INSERT INTO slide_groups (id, presentation_id, name, color, position) VALUES (?, ?, ?, ?, ?)',
    );
    const insertSlide = db.prepare(
      `INSERT INTO slides (id, group_id, position, label, notes, background, transition, auto_advance_ms, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertElement = db.prepare(
      'INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, rotation, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertCue = db.prepare(
      'INSERT INTO slide_cues (id, slide_id, position, kind, label, media_id, props) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const groupIds: string[] = [];
    input.groups.forEach((group, gi) => {
      const groupId = randomUUID();
      groupIds.push(groupId);
      insertGroup.run(groupId, id, group.name, group.color ?? null, gi);
      group.slides.forEach((slide, si) => {
        const slideId = randomUUID();
        insertSlide.run(
          slideId,
          groupId,
          si,
          slide.label ?? '',
          slide.notes ?? '',
          slide.background ?? null,
          transitionToJson(slide.transition),
          slide.autoAdvanceMs ?? null,
          slide.enabled === false ? 0 : 1,
        );
        slide.elements.forEach((element, ei) => {
          const { id: _id, kind, frame, rotation, ...props } = element;
          insertElement.run(
            randomUUID(),
            slideId,
            ei,
            kind,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            rotation ?? 0,
            JSON.stringify(props),
          );
        });
        slide.cues?.forEach((cue, ci) => {
          insertCue.run(
            randomUUID(),
            slideId,
            ci,
            cue.kind,
            cue.label,
            cue.mediaId,
            JSON.stringify(cue.props ?? {}),
          );
        });
      });
    });
    if (input.arrangements?.length) {
      const insertArrangement = db.prepare(
        'INSERT INTO arrangements (id, presentation_id, name, position, source_ref) VALUES (?, ?, ?, ?, ?)',
      );
      const insertEntry = db.prepare(
        'INSERT INTO arrangement_groups (arrangement_id, position, group_id) VALUES (?, ?, ?)',
      );
      input.arrangements.forEach((arrangement, ai) => {
        const arrangementId = randomUUID();
        insertArrangement.run(arrangementId, id, arrangement.name, ai, arrangement.ref ?? null);
        let position = 0;
        for (const index of arrangement.groups) {
          const groupId = groupIds[index];
          if (groupId) insertEntry.run(arrangementId, position++, groupId);
        }
        if (input.selectedArrangement === ai) {
          db.prepare('UPDATE presentations SET selected_arrangement_id = ? WHERE id = ?').run(
            arrangementId,
            id,
          );
        }
      });
    }
    if (input.kirtan) {
      const k = input.kirtan;
      db.prepare(
        'INSERT INTO kirtans (presentation_id, category, kavi, raag, occasions, audio_media_id) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        k.category ?? null,
        k.kavi ?? null,
        k.raag ?? null,
        JSON.stringify(k.occasions ?? []),
        k.audioMediaId ?? null,
      );
    }
    // What the library list shows, kept here so the list never has to count (migration 5).
    const slideCount = input.groups.reduce(
      (n, g) => n + g.slides.filter((sl) => sl.enabled !== false).length,
      0,
    );
    const tracks = input.kirtan
      ? langsOf(
          input.groups.flatMap((g) =>
            g.slides.filter((sl) => sl.enabled !== false).flatMap((sl) => sl.elements),
          ),
        ).join(',')
      : null;
    db.prepare('UPDATE presentations SET slide_count = ?, kirtan_tracks = ? WHERE id = ?').run(
      slideCount,
      tracks,
      id,
    );
    // Searchable as soon as it is written (same transaction).
    this.search.update(id);
  }

  /**
   * Earlier imports of a source that are still in the library: by the
   * file's own id when it has one, otherwise by path. Newest first.
   */
  findImported(kind: ImportSource['kind'], ref: string | null, path: string): ImportedMatch[] {
    const rows = (
      ref
        ? this.db
            .prepare(
              'SELECT id, name, source_path, source_hash FROM presentations WHERE source_kind = ? AND source_ref = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC',
            )
            .all(kind, ref)
        : this.db
            .prepare(
              'SELECT id, name, source_path, source_hash FROM presentations WHERE source_kind = ? AND source_path = ? AND source_ref IS NULL AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC',
            )
            .all(kind, path)
    ) as { id: string; name: string; source_path: string | null; source_hash: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sourcePath: r.source_path,
      sourceHash: r.source_hash,
    }));
  }

  /** A presentation imported from a file with exactly these bytes (from anywhere). */
  findByHash(kind: ImportSource['kind'], hash: string): ImportedMatch | null {
    const r = this.db
      .prepare(
        'SELECT id, name, source_path, source_hash FROM presentations WHERE source_kind = ? AND source_hash = ? AND deleted_at IS NULL LIMIT 1',
      )
      .get(kind, hash) as
      { id: string; name: string; source_path: string | null; source_hash: string | null } | undefined;
    return r ? { id: r.id, name: r.name, sourcePath: r.source_path, sourceHash: r.source_hash } : null;
  }

  /**
   * The newest presentation still in the library that was imported from this
   * file: by its exact path, or else by its file name from any folder (a
   * playlist names files by their path on the machine it was made on).
   */
  findBySourceFile(kind: ImportSource['kind'], path: string): string | null {
    const exact = this.db
      .prepare(
        'SELECT id FROM presentations WHERE source_kind = ? AND source_path = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(kind, path) as { id: string } | undefined;
    if (exact) return exact.id;
    const name = path.split(/[\\/]/u).pop() ?? '';
    if (name === '') return null;
    const escaped = name.replace(/[\\%_]/gu, (c) => `\\${c}`);
    const byName = this.db
      .prepare(
        `SELECT id FROM presentations WHERE source_kind = ? AND deleted_at IS NULL
           AND (source_path LIKE ? ESCAPE '\\' OR source_path LIKE ? ESCAPE '\\' OR source_path = ?)
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      // The LIKE escape character is a backslash, so a literal backslash is doubled in the pattern.
      .get(kind, `%/${escaped}`, `%\\\\${escaped}`, name) as { id: string } | undefined;
    return byName?.id ?? null;
  }

  /** `name`, or `name (2)`, `name (3)`... whichever is free in the library. */
  uniqueName(libraryId: string, name: string): string {
    const taken = new Set(
      (
        this.db
          .prepare(
            'SELECT name FROM presentations WHERE library_id = ? AND deleted_at IS NULL AND (name = ? OR name LIKE ?)',
          )
          .all(libraryId, name, `${name} (%)`) as { name: string }[]
      ).map((r) => r.name),
    );
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name} (${n})`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** Remove presentations; Undo (restore) can bring them back until they are purged. Returns those removed. */
  remove(ids: readonly string[]): string[] {
    const stmt = this.db.prepare(
      "UPDATE presentations SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND deleted_at IS NULL",
    );
    const removed: string[] = [];
    this.db.transaction(() => {
      for (const id of ids)
        if (stmt.run(id).changes > 0) {
          removed.push(id);
          this.search.drop(id);
        }
    })();
    return removed;
  }

  /** Bring removed presentations back. Returns those restored. */
  restore(ids: readonly string[]): string[] {
    const stmt = this.db.prepare(
      'UPDATE presentations SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
    );
    const restored: string[] = [];
    this.db.transaction(() => {
      for (const id of ids)
        if (stmt.run(id).changes > 0) {
          restored.push(id);
          this.search.update(id);
        }
    })();
    return restored;
  }

  /** Delete for good what was removed before `before` (an ISO time). Returns how many. */
  purgeRemoved(before: string): number {
    return this.db
      .prepare('DELETE FROM presentations WHERE deleted_at IS NOT NULL AND deleted_at < ?')
      .run(before).changes;
  }
}

/** The engine's view of the library: slides in order, cached per presentation. */
export class DbSlideSource implements SlideSource {
  private readonly cache = new Map<string, PresentationDoc | null>();

  constructor(private readonly repo: PresentationRepo) {}

  /** Forget cached slides after a presentation changes (or all of them). */
  invalidate(presentationId?: string): void {
    if (presentationId) this.cache.delete(presentationId);
    else this.cache.clear();
  }

  private doc(presentationId: string): PresentationDoc | null {
    if (!this.cache.has(presentationId)) this.cache.set(presentationId, this.repo.get(presentationId));
    return this.cache.get(presentationId) ?? null;
  }

  order(presentationId: string, arrangementId?: string | null): PlayOrder | null {
    const doc = this.doc(presentationId);
    if (!doc) return null;
    const played = playOrder(doc, arrangementId === undefined ? doc.selectedArrangementId : arrangementId);
    return {
      arrangementId: played.arrangementId,
      slides: played.slides.map((o) => ({
        id: o.slide.id,
        slide: o.slide.slide,
        cues: o.slide.cues,
        notes: o.slide.notes,
        transition: o.slide.transition,
        autoAdvanceMs: o.slide.autoAdvanceMs,
      })),
      transition: doc.transition,
      loop: doc.loop,
    };
  }
}
