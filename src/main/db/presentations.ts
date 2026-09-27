import { randomUUID } from 'node:crypto';
import type {
  GroupInfo,
  ImportSource,
  PresentationDoc,
  PresentationSummary,
  SlideInfo,
} from '../../shared/library';
import { type Lang, LANGS, type RenderSlide, type SlideElement } from '../../shared/model';
import { slideElementSchema } from '../../shared/model-schema';
import type { SlideSource } from '../engine/slide-source';
import type { Db } from './database';

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
  props: string;
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
  };
  const parsed = slideElementSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export interface NewSlide {
  label?: string;
  notes?: string;
  background?: string | null;
  elements: SlideElement[];
}

export interface NewPresentation {
  libraryId: string;
  name: string;
  width?: number;
  height?: number;
  groups: { name: string; color?: string | null; slides: NewSlide[] }[];
  /** Optional kirtan metadata and per-slide language lines (slide order across groups). */
  kirtan?: {
    category?: string | null;
    kavi?: string | null;
    tracks: Lang[];
    lines: Partial<Record<Lang, string>>[];
  };
  source?: ImportSource | null;
}

export class PresentationRepo {
  /** Elements that failed validation on the last get(), for diagnostics. */
  skippedElements: string[] = [];

  constructor(private readonly db: Db) {}

  ensureLibrary(name: string): string {
    const found = this.db.prepare('SELECT id FROM libraries WHERE name = ?').get(name) as
      { id: string } | undefined;
    if (found) return found.id;
    const id = randomUUID();
    this.db.prepare('INSERT INTO libraries (id, name) VALUES (?, ?)').run(id, name);
    return id;
  }

  list(): PresentationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, p.width, p.height, l.name AS library_name,
                p.source_kind, p.source_path, p.source_ref, p.source_imported_at,
                (SELECT COUNT(*) FROM slides s JOIN slide_groups g ON g.id = s.group_id
                  WHERE g.presentation_id = p.id AND s.enabled = 1) AS slide_count,
                EXISTS (SELECT 1 FROM kirtans k WHERE k.presentation_id = p.id) AS is_kirtan,
                (SELECT group_concat(t.lang) FROM kirtan_tracks t WHERE t.kirtan_id = p.id) AS tracks
           FROM presentations p JOIN libraries l ON l.id = p.library_id
          ORDER BY l.position, l.name, p.name COLLATE NOCASE`,
      )
      .all() as (SourceColumns & {
      id: string;
      name: string;
      width: number;
      height: number;
      library_name: string;
      slide_count: number;
      is_kirtan: number;
      tracks: string | null;
    })[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      libraryName: r.library_name,
      slideCount: r.slide_count,
      width: r.width,
      height: r.height,
      kirtanTracks: r.is_kirtan ? toLangs(r.tracks) : null,
      source: toSource(r),
    }));
  }

  get(id: string): PresentationDoc | null {
    const p = this.db
      .prepare(
        'SELECT id, name, width, height, source_kind, source_path, source_ref, source_imported_at FROM presentations WHERE id = ?',
      )
      .get(id) as (SourceColumns & { id: string; name: string; width: number; height: number }) | undefined;
    if (!p) return null;
    const groups = this.db
      .prepare('SELECT id, name, color FROM slide_groups WHERE presentation_id = ? ORDER BY position, rowid')
      .all(id) as { id: string; name: string; color: string | null }[];
    const slides = this.db
      .prepare(
        `SELECT s.id, s.group_id, s.label, s.notes, s.background
           FROM slides s JOIN slide_groups g ON g.id = s.group_id
          WHERE g.presentation_id = ? AND s.enabled = 1
          ORDER BY g.position, g.rowid, s.position, s.rowid`,
      )
      .all(id) as { id: string; group_id: string; label: string; notes: string; background: string | null }[];
    const elements = this.db
      .prepare(
        `SELECT e.id, e.slide_id, e.kind, e.x, e.y, e.width, e.height, e.props
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
      const info: SlideInfo = { id: s.id, index, label: s.label, notes: s.notes, slide };
      groupInfos.get(s.group_id)?.slides.push(info);
    });

    const kirtanRow = this.db
      .prepare('SELECT category, kavi FROM kirtans WHERE presentation_id = ?')
      .get(id) as { category: string | null; kavi: string | null } | undefined;
    let kirtan: PresentationDoc['kirtan'] = null;
    if (kirtanRow) {
      const trackRows = this.db.prepare('SELECT lang FROM kirtan_tracks WHERE kirtan_id = ?').all(id) as {
        lang: Lang;
      }[];
      const lineRows = this.db
        .prepare('SELECT slide_id, lang, text FROM kirtan_track_lines WHERE kirtan_id = ?')
        .all(id) as { slide_id: string; lang: Lang; text: string }[];
      const lines: Record<string, Partial<Record<Lang, string>>> = {};
      for (const l of lineRows) (lines[l.slide_id] ??= {})[l.lang] = l.text;
      kirtan = {
        category: kirtanRow.category,
        kavi: kirtanRow.kavi,
        tracks: toLangs(trackRows.map((t) => t.lang).join(',')),
        lines,
      };
    }

    return {
      id: p.id,
      name: p.name,
      width: p.width,
      height: p.height,
      groups: [...groupInfos.values()],
      kirtan,
      source: toSource(p),
    };
  }

  /** Insert a whole presentation in one transaction; returns its id. */
  insert(input: NewPresentation): string {
    const id = randomUUID();
    const db = this.db;
    const insertPresentation = db.prepare(
      `INSERT INTO presentations (id, library_id, name, width, height, source_kind, source_path, source_ref, source_imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertGroup = db.prepare(
      'INSERT INTO slide_groups (id, presentation_id, name, color, position) VALUES (?, ?, ?, ?, ?)',
    );
    const insertSlide = db.prepare(
      'INSERT INTO slides (id, group_id, position, label, notes, background) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertElement = db.prepare(
      'INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    db.transaction(() => {
      const s = input.source ?? null;
      insertPresentation.run(
        id,
        input.libraryId,
        input.name,
        input.width ?? 1920,
        input.height ?? 1080,
        s?.kind ?? null,
        s?.path ?? null,
        s?.ref ?? null,
        s?.importedAt ?? null,
      );
      const slideIds: string[] = [];
      input.groups.forEach((group, gi) => {
        const groupId = randomUUID();
        insertGroup.run(groupId, id, group.name, group.color ?? null, gi);
        group.slides.forEach((slide, si) => {
          const slideId = randomUUID();
          slideIds.push(slideId);
          insertSlide.run(
            slideId,
            groupId,
            si,
            slide.label ?? '',
            slide.notes ?? '',
            slide.background ?? null,
          );
          slide.elements.forEach((element, ei) => {
            const { id: _id, kind, frame, ...props } = element;
            insertElement.run(
              randomUUID(),
              slideId,
              ei,
              kind,
              frame.x,
              frame.y,
              frame.width,
              frame.height,
              JSON.stringify(props),
            );
          });
        });
      });
      if (input.kirtan) {
        const k = input.kirtan;
        db.prepare('INSERT INTO kirtans (presentation_id, category, kavi) VALUES (?, ?, ?)').run(
          id,
          k.category ?? null,
          k.kavi ?? null,
        );
        const insertTrack = db.prepare('INSERT INTO kirtan_tracks (kirtan_id, lang) VALUES (?, ?)');
        for (const lang of k.tracks) insertTrack.run(id, lang);
        const insertLine = db.prepare(
          'INSERT INTO kirtan_track_lines (kirtan_id, lang, slide_id, text) VALUES (?, ?, ?, ?)',
        );
        k.lines.forEach((perLang, i) => {
          const slideId = slideIds[i];
          if (!slideId) return;
          for (const lang of k.tracks) {
            const text = perLang[lang];
            if (text !== undefined) insertLine.run(id, lang, slideId, text);
          }
        });
      }
    })();
    return id;
  }
}

/** The engine's view of the library: slides in order, cached per presentation. */
export class DbSlideSource implements SlideSource {
  private readonly cache = new Map<string, RenderSlide[] | null>();

  constructor(private readonly repo: PresentationRepo) {}

  /** Forget cached slides after a presentation changes (or all of them). */
  invalidate(presentationId?: string): void {
    if (presentationId) this.cache.delete(presentationId);
    else this.cache.clear();
  }

  private slides(presentationId: string): RenderSlide[] | null {
    if (!this.cache.has(presentationId)) {
      const doc = this.repo.get(presentationId);
      this.cache.set(presentationId, doc ? doc.groups.flatMap((g) => g.slides.map((s) => s.slide)) : null);
    }
    return this.cache.get(presentationId) ?? null;
  }

  slideCount(presentationId: string): number | null {
    return this.slides(presentationId)?.length ?? null;
  }

  slide(presentationId: string, index: number): RenderSlide | null {
    return this.slides(presentationId)?.[index] ?? null;
  }
}
