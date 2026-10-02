import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Lang, SlideElement, TextElement } from '../../../shared/model';
import { LANGS } from '../../../shared/model';
import { slideElementSchema } from '../../../shared/model-schema';
import { langsOf, setLangLines, slideLines } from '../../../shared/tracks';

/**
 * Migration 11: the kirtan library (Session 8).
 *
 * A kirtan's words are its slides' runs, by language (src/shared/tracks.ts):
 * there is no second copy. Lines kept in kirtan_track_lines that were not
 * on their slides (until now only the seeded sample's English and Hindi)
 * are put into the slides' text first (`before`), then the two track
 * tables go.
 *
 * Kirtans get any number of occasions (the one occasion they could have
 * comes along) and a recording from the media library. Transliteration
 * lines that Drashti made are remembered as made (kirtan_auto_lines): such
 * a line counts as made by Drashti while the slide still says exactly that,
 * and as the operator's own once anyone changes it.
 */
export const up = `
DROP TABLE kirtan_track_lines;
DROP TABLE kirtan_tracks;
ALTER TABLE kirtans ADD COLUMN occasions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(occasions));
UPDATE kirtans SET occasions = json_array(trim(occasion)) WHERE occasion IS NOT NULL AND trim(occasion) <> '';
ALTER TABLE kirtans ADD COLUMN audio_media_id TEXT REFERENCES media(id) ON DELETE SET NULL;
UPDATE kirtans SET category = upper(substr(category, 1, 1)) || substr(category, 2)
 WHERE category IN ('arti', 'dhun', 'prarthana', 'stuti', 'thal', 'kirtan', 'ashtak', 'shlok');
CREATE TABLE kirtan_auto_lines (
  slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'gu', 'hi', 'translit')),
  text TEXT NOT NULL,
  PRIMARY KEY (slide_id, lang)
);
`;

interface ElementRow {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  props: string;
}

const TEXT_KEYS = new Set(['text', 'lang', 'style', 'runs', 'opacity']);

function parse(row: ElementRow): { el: TextElement; rest: Record<string, unknown> } | null {
  let props: Record<string, unknown>;
  try {
    props = JSON.parse(row.props) as Record<string, unknown>;
  } catch {
    return null;
  }
  const el = slideElementSchema.safeParse({
    ...props,
    id: row.id,
    kind: 'text',
    frame: { x: row.x, y: row.y, width: row.width, height: row.height },
  });
  if (!el.success || el.data.kind !== 'text') return null;
  return { el: el.data, rest: Object.fromEntries(Object.entries(props).filter(([k]) => !TEXT_KEYS.has(k))) };
}

/** A text element's own data, as stored in its props column. */
function propsOf(el: TextElement, rest: Record<string, unknown>): string {
  const { id: _id, kind: _kind, frame: _frame, rotation: _rotation, ...own } = el;
  return JSON.stringify({ ...rest, ...own });
}

export function before(db: Database.Database): void {
  const textRows = db.prepare(
    "SELECT id, x, y, width, height, props FROM elements WHERE slide_id = ? AND kind = 'text' ORDER BY position, rowid",
  );
  const update = db.prepare('UPDATE elements SET props = ? WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, rotation, props)
     VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM elements WHERE slide_id = ?), 'text', ?, ?, ?, ?, 0, ?)`,
  );
  const sizeOf = db.prepare(
    `SELECT p.width, p.height FROM slides s JOIN slide_groups g ON g.id = s.group_id
       JOIN presentations p ON p.id = g.presentation_id WHERE s.id = ?`,
  );

  // Track lines that are not on their slide go into its words.
  const lines = db.prepare('SELECT slide_id, lang, text FROM kirtan_track_lines ORDER BY slide_id').all() as {
    slide_id: string;
    lang: Lang;
    text: string;
  }[];
  const bySlide = new Map<string, { lang: Lang; text: string }[]>();
  for (const l of lines) bySlide.set(l.slide_id, [...(bySlide.get(l.slide_id) ?? []), l]);
  for (const [slideId, tracks] of bySlide) {
    const parsed = (textRows.all(slideId) as ElementRow[]).map(parse);
    const rest = new Map<SlideElement, Record<string, unknown>>();
    let elements: SlideElement[] = [];
    for (const p of parsed)
      if (p) {
        elements.push(p.el);
        rest.set(p.el, p.rest);
      }
    const before = new Set(elements);
    const size = (sizeOf.get(slideId) as { width: number; height: number } | undefined) ?? {
      width: 1920,
      height: 1080,
    };
    for (const lang of LANGS) {
      const text = tracks.find((t) => t.lang === lang)?.text;
      if (text === undefined || slideLines(elements).lines[lang]) continue;
      elements = setLangLines(elements, lang, text.split('\n'), {
        order: ['gu', 'hi', 'translit', 'en'],
        look: {},
        newBox: () => ({
          id: randomUUID(),
          kind: 'text',
          frame: {
            x: size.width * 0.05,
            y: size.height * 0.1,
            width: size.width * 0.9,
            height: size.height * 0.8,
          },
          text: '',
          lang: null,
          style: {
            fontFamily: null,
            fontSize: Math.round(size.height * 0.07),
            fontWeight: 500,
            color: '#ffffff',
            align: 'center',
            verticalAlign: 'middle',
            lineHeight: 1.25,
            shadow: true,
          },
        }),
      });
    }
    // The boxes as they were each have their row; a changed one gets its words, a new one a row of its own.
    const original = [...before];
    elements.forEach((el, i) => {
      if (el.kind !== 'text' || before.has(el)) return;
      const was = original[i];
      if (was?.id === el.id) update.run(propsOf(el, rest.get(was) ?? {}), el.id);
      else
        insert.run(
          el.id,
          slideId,
          slideId,
          el.frame.x,
          el.frame.y,
          el.frame.width,
          el.frame.height,
          propsOf(el, {}),
        );
    });
  }

  // The library list's languages for each kirtan, from the words of its slides that play.
  const kirtans = db.prepare('SELECT presentation_id FROM kirtans').pluck().all() as string[];
  const texts = db.prepare(
    `SELECT e.id, e.x, e.y, e.width, e.height, e.props FROM elements e
       JOIN slides s ON s.id = e.slide_id JOIN slide_groups g ON g.id = s.group_id
      WHERE g.presentation_id = ? AND e.kind = 'text' AND s.enabled = 1`,
  );
  const setTracks = db.prepare('UPDATE presentations SET kirtan_tracks = ? WHERE id = ?');
  for (const id of kirtans) {
    const els = (texts.all(id) as ElementRow[]).map(parse).flatMap((p) => (p ? [p.el] : []));
    setTracks.run(langsOf(els).join(','), id);
  }
}
