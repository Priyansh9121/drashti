import { randomUUID } from 'node:crypto';
import type { Lang } from '../../shared/model';
import { LANGS } from '../../shared/model';
import { toDevanagari, toGujaratiScript } from '../../shared/scripts';
import { foldText, ftsQuery, matchesAll, SEARCH_LIMIT, searchWords } from '../../shared/search';
import type {
  LoadedItem,
  LoadedSection,
  LoadedText,
  PassageKey,
  RefSection,
  RefText,
  ShastraHit,
  ShastraItemRow,
  ShastraSectionNode,
  ShastraTextInfo,
  ShastraTree,
} from '../../shared/shastra';
import { passageId, referenceLine, refKey } from '../../shared/shastra';
import type { TranslitStyle } from '../../shared/translit';
import { capitalize, transliterate } from '../../shared/translit';
import type { Db } from './database';

/*
 * Shastra texts in the library (migration 25). Loading a text whose
 * abbreviation is already there updates it in place: sections keep their ids
 * by their path, items by their section and number, and what is no longer
 * in the file goes. Missing transliteration, and Sanskrit in the script the
 * file did not give, are made here and marked as made (shared/scripts.ts,
 * shared/translit.ts), as for kirtans.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export interface LoadResult {
  textId: string;
  outcome: 'added' | 'updated' | 'unchanged';
  name: string;
  items: number;
  sections: number;
  /** Words Drashti made, by what they are. */
  made: { translit: number; script: number };
}

/** A passage's words, as its slides need them. */
export interface PassageContent {
  text: { id: string; name: string; abbreviation: string; themeId: string | null; loadedAt: string };
  sectionLabels: string[];
  items: { id: string; number: number; title: string; texts: Partial<Record<Lang, string>> }[];
}

interface TextRow {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  theme_id: string | null;
  languages: string;
  item_count: number;
  section_count: number;
  source_path: string | null;
  source_hash: string | null;
  loaded_at: string;
}

const TEXT_COLUMNS =
  'id, name, abbreviation, description, theme_id, languages, item_count, section_count, source_path, source_hash, loaded_at';

function info(row: TextRow): ShastraTextInfo {
  let languages: Partial<Record<Lang, number>> = {};
  try {
    const parsed = JSON.parse(row.languages) as Record<string, unknown>;
    languages = Object.fromEntries(
      Object.entries(parsed).filter(
        (e): e is [Lang, number] => (LANGS as readonly string[]).includes(e[0]) && typeof e[1] === 'number',
      ),
    );
  } catch {
    // None known.
  }
  return {
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    description: row.description,
    themeId: row.theme_id,
    itemCount: row.item_count,
    sectionCount: row.section_count,
    languages,
    sourcePath: row.source_path,
    loadedAt: row.loaded_at,
  };
}

/** An item's words with what Drashti makes when the file leaves it out. */
export function withMadeWords(
  texts: Partial<Record<Lang, string>>,
  style: TranslitStyle,
): { texts: Partial<Record<Lang, string>>; made: Lang[] } {
  const out = { ...texts };
  const made: Lang[] = [];
  if (out.sa !== undefined && out['sa-gu'] === undefined) {
    out['sa-gu'] = toGujaratiScript(out.sa);
    made.push('sa-gu');
  } else if (out['sa-gu'] !== undefined && out.sa === undefined) {
    out.sa = toDevanagari(out['sa-gu']);
    made.push('sa');
  }
  if (out.translit === undefined) {
    const sanskrit = out.sa ?? out['sa-gu'];
    const source = sanskrit ?? out.gu ?? out.hi;
    if (source !== undefined) {
      out.translit = source
        .split('\n')
        .map((line) => capitalize(transliterate(line, style, { sanskrit: sanskrit !== undefined })))
        .join('\n');
      made.push('translit');
    }
  }
  return { texts: out, made };
}

export class ShastraRepo {
  constructor(private readonly db: Db) {}

  // ---- loading -----------------------------------------------------------------

  /**
   * Load a text, or update the one with its abbreviation; nothing changes for
   * the same file loaded again. Call inside a transaction.
   */
  load(
    text: LoadedText,
    source: { path: string | null; hash: string | null },
    style: TranslitStyle,
  ): LoadResult {
    const key = refKey(text.abbreviation);
    const earlier = this.db.prepare('SELECT id, source_hash FROM shastra_texts WHERE key = ?').get(key) as
      { id: string; source_hash: string | null } | undefined;
    const sectionCount = countSections(text.sections);
    if (earlier && source.hash !== null && earlier.source_hash === source.hash)
      return {
        textId: earlier.id,
        outcome: 'unchanged',
        name: text.name,
        items: text.itemCount,
        sections: sectionCount,
        made: { translit: 0, script: 0 },
      };
    const textId = earlier?.id ?? randomUUID();
    if (earlier) {
      this.db
        .prepare(
          `UPDATE shastra_texts SET name = ?, abbreviation = ?, description = ?, languages = '{}', item_count = ?,
             section_count = ?, source_path = ?, source_hash = ?, loaded_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`,
        )
        .run(
          text.name,
          text.abbreviation,
          text.description,
          text.itemCount,
          sectionCount,
          source.path,
          source.hash,
          textId,
        );
    } else {
      const position = (
        this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM shastra_texts').get() as {
          p: number;
        }
      ).p;
      this.db
        .prepare(
          `INSERT INTO shastra_texts (id, name, abbreviation, key, description, item_count, section_count, source_path,
             source_hash, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          textId,
          text.name,
          text.abbreviation,
          key,
          text.description,
          text.itemCount,
          sectionCount,
          source.path,
          source.hash,
          position,
        );
    }

    // The search index loses this text's items first (it has no foreign keys).
    this.db
      .prepare('DELETE FROM shastra_fts WHERE rowid IN (SELECT rowid FROM shastra_items WHERE text_id = ?)')
      .run(textId);

    const sectionIds = new Map(
      (
        this.db.prepare('SELECT id, path FROM shastra_sections WHERE text_id = ?').all(textId) as {
          id: string;
          path: string;
        }[]
      ).map((r) => [r.path, r.id]),
    );
    const itemIds = new Map(
      (
        this.db
          .prepare('SELECT id, section_path, number FROM shastra_items WHERE text_id = ?')
          .all(textId) as {
          id: string;
          section_path: string;
          number: number;
        }[]
      ).map((r) => [`${r.section_path}#${r.number}`, r.id]),
    );
    const keptSections = new Set<string>();
    const keptItems = new Set<string>();
    const languages: Partial<Record<Lang, number>> = {};
    const made = { translit: 0, script: 0 };
    let position = 0;

    const upsertSection = this.db.prepare(
      `INSERT INTO shastra_sections (id, text_id, parent_id, path, position, label, abbreviation) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (text_id, path) DO UPDATE SET parent_id = excluded.parent_id, position = excluded.position,
         label = excluded.label, abbreviation = excluded.abbreviation`,
    );
    const upsertItem = this.db.prepare(
      `INSERT INTO shastra_items (id, text_id, section_id, section_path, number, position, title) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (text_id, section_path, number) DO UPDATE SET section_id = excluded.section_id,
         position = excluded.position, title = excluded.title`,
    );
    const clearWords = this.db.prepare('DELETE FROM shastra_item_texts WHERE item_id = ?');
    const addWords = this.db.prepare(
      'INSERT INTO shastra_item_texts (item_id, lang, text, made) VALUES (?, ?, ?, ?)',
    );
    const rowidOf = this.db.prepare('SELECT rowid FROM shastra_items WHERE id = ?');
    const index = this.db.prepare('INSERT INTO shastra_fts (rowid, reference, body) VALUES (?, ?, ?)');

    const writeItems = (
      items: readonly LoadedItem[],
      sectionId: string | null,
      path: string,
      labels: string[],
    ) => {
      for (const item of items) {
        const id = itemIds.get(`${path}#${item.number}`) ?? randomUUID();
        keptItems.add(id);
        upsertItem.run(id, textId, sectionId, path, item.number, position++, item.title);
        const words = withMadeWords(item.texts, style);
        clearWords.run(id);
        for (const lang of LANGS) {
          const value = words.texts[lang];
          if (value === undefined) continue;
          const isMade = words.made.includes(lang);
          addWords.run(id, lang, value, isMade ? 1 : 0);
          languages[lang] = (languages[lang] ?? 0) + 1;
          if (isMade) {
            if (lang === 'translit') made.translit++;
            else made.script++;
          }
        }
        const { rowid } = rowidOf.get(id) as { rowid: number };
        const reference = referenceLine(text.name, labels, item.number, item.number);
        index.run(rowid, foldText(reference), foldText(Object.values(words.texts).join('\n')));
      }
    };
    const writeSections = (
      sections: readonly LoadedSection[],
      parentId: string | null,
      parentPath: string,
      labels: string[],
    ) => {
      sections.forEach((s, i) => {
        const path = parentPath === '' ? s.key : `${parentPath}/${s.key}`;
        const id = sectionIds.get(path) ?? randomUUID();
        keptSections.add(id);
        upsertSection.run(id, textId, parentId, path, i, s.label, s.abbreviation);
        writeSections(s.sections, id, path, [...labels, s.label]);
        writeItems(s.items, id, path, [...labels, s.label]);
      });
    };
    writeSections(text.sections, null, '', []);
    writeItems(text.items, null, '', []);

    // What is no longer in the file goes (items first: sections cascade to theirs).
    for (const id of itemIds.values())
      if (!keptItems.has(id)) this.db.prepare('DELETE FROM shastra_items WHERE id = ?').run(id);
    for (const id of sectionIds.values())
      if (!keptSections.has(id)) this.db.prepare('DELETE FROM shastra_sections WHERE id = ?').run(id);
    this.db
      .prepare('UPDATE shastra_texts SET languages = ? WHERE id = ?')
      .run(JSON.stringify(languages), textId);
    return {
      textId,
      outcome: earlier ? 'updated' : 'added',
      name: text.name,
      items: text.itemCount,
      sections: sectionCount,
      made,
    };
  }

  // ---- reading -----------------------------------------------------------------

  list(): ShastraTextInfo[] {
    return (
      this.db.prepare(`SELECT ${TEXT_COLUMNS} FROM shastra_texts ORDER BY position, rowid`).all() as TextRow[]
    ).map(info);
  }

  get(id: string): ShastraTextInfo | null {
    const row = this.db.prepare(`SELECT ${TEXT_COLUMNS} FROM shastra_texts WHERE id = ?`).get(id) as
      TextRow | undefined;
    return row ? info(row) : null;
  }

  /** Every text with its sections and items' numbers, as references are resolved against. */
  refTexts(): RefText[] {
    const texts = this.db
      .prepare('SELECT id, name, abbreviation FROM shastra_texts ORDER BY position, rowid')
      .all() as {
      id: string;
      name: string;
      abbreviation: string;
    }[];
    const sections = this.db
      .prepare('SELECT id, text_id, parent_id, label, abbreviation FROM shastra_sections ORDER BY position')
      .all() as {
      id: string;
      text_id: string;
      parent_id: string | null;
      label: string;
      abbreviation: string | null;
    }[];
    const items = this.db
      .prepare('SELECT text_id, section_id, number FROM shastra_items ORDER BY position')
      .all() as { text_id: string; section_id: string | null; number: number }[];
    const nodes = new Map<string, RefSection>(
      sections.map((s) => [
        s.id,
        { id: s.id, label: s.label, abbreviation: s.abbreviation, sections: [], numbers: [] },
      ]),
    );
    const own = new Map<string, number[]>(texts.map((t) => [t.id, []]));
    const top = new Map<string, RefSection[]>(texts.map((t) => [t.id, []]));
    for (const s of sections) {
      const node = nodes.get(s.id);
      if (!node) continue;
      if (s.parent_id) nodes.get(s.parent_id)?.sections.push(node);
      else top.get(s.text_id)?.push(node);
    }
    for (const it of items) {
      if (it.section_id) nodes.get(it.section_id)?.numbers.push(it.number);
      else own.get(it.text_id)?.push(it.number);
    }
    return texts.map((t) => ({ ...t, sections: top.get(t.id) ?? [], numbers: own.get(t.id) ?? [] }));
  }

  /** A text to browse: its sections and items (no words). */
  tree(textId: string): ShastraTree | null {
    const text = this.get(textId);
    if (!text) return null;
    const sections = this.db
      .prepare(
        'SELECT id, parent_id, label, abbreviation FROM shastra_sections WHERE text_id = ? ORDER BY position',
      )
      .all(textId) as { id: string; parent_id: string | null; label: string; abbreviation: string | null }[];
    const key = (this.db.prepare('SELECT key FROM shastra_texts WHERE id = ?').get(textId) as { key: string })
      .key;
    const items = this.db
      .prepare(
        'SELECT id, section_id, section_path, number, title FROM shastra_items WHERE text_id = ? ORDER BY position',
      )
      .all(textId) as {
      id: string;
      section_id: string | null;
      section_path: string;
      number: number;
      title: string;
    }[];
    const nodes = new Map<string, ShastraSectionNode>(
      sections.map((s) => [
        s.id,
        { id: s.id, label: s.label, abbreviation: s.abbreviation, sections: [], items: [] },
      ]),
    );
    const top: ShastraSectionNode[] = [];
    for (const s of sections) {
      const node = nodes.get(s.id);
      if (!node) continue;
      if (s.parent_id) nodes.get(s.parent_id)?.sections.push(node);
      else top.push(node);
    }
    const own: ShastraItemRow[] = [];
    for (const it of items) {
      const sections = it.section_path === '' ? [] : it.section_path.split('/');
      const row = {
        id: it.id,
        number: it.number,
        title: it.title,
        passageId: passageId({ text: key, sections, from: it.number, to: it.number }),
      };
      if (it.section_id) nodes.get(it.section_id)?.items.push(row);
      else own.push(row);
    }
    return { text, sections: top, items: own };
  }

  /** A passage's text, section labels and items with their words; null when the text or items are not there. */
  passage(key: PassageKey): PassageContent | null {
    const text = this.db
      .prepare('SELECT id, name, abbreviation, theme_id, loaded_at FROM shastra_texts WHERE key = ?')
      .get(key.text) as
      | { id: string; name: string; abbreviation: string; theme_id: string | null; loaded_at: string }
      | undefined;
    if (!text) return null;
    const path = key.sections.join('/');
    const labels: string[] = [];
    for (let i = 1; i <= key.sections.length; i++) {
      const row = this.db
        .prepare('SELECT label FROM shastra_sections WHERE text_id = ? AND path = ?')
        .get(text.id, key.sections.slice(0, i).join('/')) as { label: string } | undefined;
      if (!row) return null;
      labels.push(row.label);
    }
    const rows = this.db
      .prepare(
        `SELECT i.id, i.number, i.title, t.lang, t.text FROM shastra_items i
           LEFT JOIN shastra_item_texts t ON t.item_id = i.id
         WHERE i.text_id = ? AND i.section_path = ? AND i.number BETWEEN ? AND ?
         ORDER BY i.position`,
      )
      .all(text.id, path, key.from, key.to) as {
      id: string;
      number: number;
      title: string;
      lang: Lang | null;
      text: string | null;
    }[];
    const items: PassageContent['items'] = [];
    for (const r of rows) {
      let item = items.at(-1);
      if (item?.id !== r.id) {
        item = { id: r.id, number: r.number, title: r.title, texts: {} };
        items.push(item);
      }
      if (r.lang && r.text !== null) item.texts[r.lang] = r.text;
    }
    if (items.length === 0) return null;
    return {
      text: {
        id: text.id,
        name: text.name,
        abbreviation: text.abbreviation,
        themeId: text.theme_id,
        loadedAt: text.loaded_at,
      },
      sectionLabels: labels,
      items,
    };
  }

  /** What a passage reads as ("Satsang Diksha 14–16"), or null when no loaded text has it. */
  display(key: PassageKey): string | null {
    const content = this.passage(key);
    return content ? referenceLine(content.text.name, content.sectionLabels, key.from, key.to) : null;
  }

  /** The key of a text's section path ("ppr", "p1/p2"), or the text's own items (""). */
  private keyOf(textId: string, sectionId: string | null): { text: string; sections: string[] } | null {
    const t = this.db.prepare('SELECT key FROM shastra_texts WHERE id = ?').get(textId) as
      { key: string } | undefined;
    if (!t) return null;
    if (!sectionId) return { text: t.key, sections: [] };
    const s = this.db.prepare('SELECT path FROM shastra_sections WHERE id = ?').get(sectionId) as
      { path: string } | undefined;
    return s ? { text: t.key, sections: s.path.split('/') } : null;
  }

  /** The passage of one item (by id), as a key. */
  itemKey(itemId: string): PassageKey | null {
    const it = this.db
      .prepare('SELECT text_id, section_id, number FROM shastra_items WHERE id = ?')
      .get(itemId) as { text_id: string; section_id: string | null; number: number } | undefined;
    if (!it) return null;
    const where = this.keyOf(it.text_id, it.section_id);
    return where ? { ...where, from: it.number, to: it.number } : null;
  }

  /**
   * Passages found by their words in any language, accents ignored (as the
   * library's search): every word typed must start one of the item's words.
   */
  search(input: string, limit = SEARCH_LIMIT): ShastraHit[] {
    const query = ftsQuery(input);
    if (!query) return [];
    const wanted = searchWords(input);
    const rows = this.db
      .prepare(
        `SELECT i.id, i.text_id, i.section_id, i.number, x.name, x.key FROM shastra_fts f
           JOIN shastra_items i ON i.rowid = f.rowid
           JOIN shastra_texts x ON x.id = i.text_id
         WHERE shastra_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit) as {
      id: string;
      text_id: string;
      section_id: string | null;
      number: number;
      name: string;
      key: string;
    }[];
    const wordsOf = this.db.prepare(
      'SELECT lang, text FROM shastra_item_texts WHERE item_id = ? ORDER BY made, lang',
    );
    const labelsOf = this.db.prepare(
      `WITH RECURSIVE up(id, parent_id, label, depth) AS (
         SELECT id, parent_id, label, 0 FROM shastra_sections WHERE id = ?
         UNION ALL SELECT s.id, s.parent_id, s.label, up.depth + 1 FROM shastra_sections s JOIN up ON s.id = up.parent_id)
       SELECT label FROM up ORDER BY depth DESC`,
    );
    return rows.flatMap((r) => {
      const key = this.keyOf(r.text_id, r.section_id);
      if (!key) return [];
      const labels = r.section_id
        ? (labelsOf.all(r.section_id) as { label: string }[]).map((l) => l.label)
        : [];
      const texts = wordsOf.all(r.id) as { lang: Lang; text: string }[];
      // The line the words were found in (or, failing that, the first line).
      let found: { lang: Lang | null; line: string } | null = null;
      for (const t of texts)
        for (const line of t.text.split('\n'))
          if (!found && matchesAll(wanted, searchWords(line))) found = { lang: t.lang, line };
      const first = texts[0];
      const pick = found ?? { lang: first?.lang ?? null, line: first?.text.split('\n')[0] ?? '' };
      return [
        {
          passageId: passageId({ ...key, from: r.number, to: r.number }),
          reference: referenceLine(r.name, labels, r.number, r.number),
          snippet: pick.line.length > 160 ? `${pick.line.slice(0, 157)}…` : pick.line,
          lang: pick.lang,
        },
      ];
    });
  }

  // ---- changing ----------------------------------------------------------------

  setTheme(textId: string, themeId: string | null): boolean {
    return (
      this.db
        .prepare(`UPDATE shastra_texts SET theme_id = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(themeId, textId).changes === 1
    );
  }

  /** Remove a text and everything in it. Playlists that name its passages show them as missing. */
  remove(textId: string): boolean {
    return this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM shastra_fts WHERE rowid IN (SELECT rowid FROM shastra_items WHERE text_id = ?)')
        .run(textId);
      return this.db.prepare('DELETE FROM shastra_texts WHERE id = ?').run(textId).changes === 1;
    })();
  }
}

function countSections(sections: readonly LoadedSection[]): number {
  return sections.reduce((n, s) => n + 1 + countSections(s.sections), 0);
}
