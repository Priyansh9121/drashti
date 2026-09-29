import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../../shared/model';
import type { ContentRows } from '../db/content';
import { readContent, writeContent } from '../db/content';
import { type Db, openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { LYRICS_STYLE } from '../import/formats/text';
import type { NewSlideLook } from './words';
import { applyWords, legacyFonts, wordsOf } from './words';

/* Placeholder words only. */

/** The value, or the test fails here. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

const text = (
  value: string,
  runs?: TextRun[],
  frame = { x: 96, y: 96, width: 1728, height: 888 },
): TextElement => ({
  id: 'x',
  kind: 'text',
  frame,
  text: value,
  lang: null,
  style: LYRICS_STYLE,
  ...(runs ? { runs } : {}),
});

const look: NewSlideLook = {
  frame: { x: 10, y: 20, width: 300, height: 200 },
  style: { ...LYRICS_STYLE, fontSize: 66 },
  langs: { translit: { size: 44, italic: true } },
  background: '#101010',
};

function setup() {
  const db: Db = openDatabase(':memory:');
  const repo = new PresentationRepo(db);
  const lib = repo.ensureLibrary('Kirtans');
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable) VALUES ('bg', 'image', 'Placeholder.png', 'ab/c.png', 1)",
  ).run();
  const id = repo.insert({
    libraryId: lib,
    name: 'Placeholder Song',
    groups: [
      {
        name: 'Verse 1',
        slides: [
          {
            background: '#223344',
            elements: [
              text('નમૂના પંક્તિ\nNamūnā pankti', [
                { text: 'નમૂના પંક્તિ\n', size: 90, lang: 'gu' },
                { text: 'Namūnā pankti', size: 60, italic: true, lang: 'translit' },
              ]),
            ],
            cues: [
              {
                kind: 'background',
                label: '',
                mediaId: 'bg',
                props: { media: 'image', fit: 'fill', loop: false },
              },
            ],
          },
          { elements: [text('Placeholder second slide')] },
          { enabled: false, elements: [text('Placeholder hidden slide')] },
          {
            elements: [
              {
                id: 'i',
                kind: 'image',
                frame: { x: 0, y: 0, width: 10, height: 10 },
                mediaId: 'bg',
                fit: 'fit',
              },
            ],
          },
        ],
      },
      { name: 'Chorus', slides: [{ elements: [text('Placeholder chorus')] }] },
    ],
    arrangements: [{ name: 'Usual', groups: [0, 1, 0] }],
    selectedArrangement: 0,
  });
  let n = 0;
  const newId = () => `new-${++n}`;
  const content = () => must(readContent(db, id));
  return { db, repo, id, newId, content };
}

/** Rows in a fixed order (writing them does not depend on the order). */
const sorted = (rows: ContentRows) => ({
  ...rows,
  groups: [...rows.groups].sort((a, b) => a.id.localeCompare(b.id)),
  slides: [...rows.slides].sort((a, b) => a.id.localeCompare(b.id)),
  elements: [...rows.elements].sort((a, b) => a.id.localeCompare(b.id)),
  cues: [...rows.cues].sort((a, b) => a.id.localeCompare(b.id)),
  arrangementEntries: [...rows.arrangementEntries].sort(
    (a, b) => a.arrangement_id.localeCompare(b.arrangement_id) || a.position - b.position,
  ),
});

const textOf = (rows: ContentRows, slideId: string) =>
  JSON.parse(must(rows.elements.find((e) => e.slide_id === slideId)).props) as TextElement;

const WORDS =
  '[Verse 1]\nનમૂના પંક્તિ\nNamūnā pankti\n\nPlaceholder second slide\n\n[Chorus]\nPlaceholder chorus\n';

describe('editing the words', () => {
  it('shows the words group by group, without disabled slides and slides with no words', () => {
    const { content } = setup();
    expect(wordsOf(content())).toBe(WORDS);
  });

  it('changes nothing when the words are the same', () => {
    const { content, newId } = setup();
    const before = content();
    const change = must(applyWords(before, WORDS, look, newId));
    expect([change.kept, change.changed, change.added, change.removed]).toEqual([3, 0, 0, 0]);
    expect(sorted(change.rows)).toEqual(sorted(before));
  });

  it('fixing a word keeps the slide: its id, background, cue and the look of each language', () => {
    const { db, content, newId } = setup();
    const before = content();
    const first = must(before.slides[0]);
    const change = must(applyWords(before, WORDS.replace('Namūnā pankti', 'Namūnā pankti ek'), look, newId));
    expect([change.kept, change.changed]).toEqual([2, 1]);
    db.transaction(() => {
      writeContent(db, change.rows);
    })();
    const after = content();
    expect(must(after.slides.find((s) => s.id === first.id)).background).toBe('#223344');
    expect(after.cues.map((c) => c.slide_id)).toEqual([first.id]);
    const props = textOf(after, first.id);
    expect(props.text).toBe('નમૂના પંક્તિ\nNamūnā pankti ek');
    expect(props.runs).toEqual([
      { text: 'નમૂના પંક્તિ\n', size: 90, lang: 'gu' },
      { text: 'Namūnā pankti ek', size: 60, italic: true, lang: 'translit' },
    ]);
  });

  it('a new slide in a group looks like its first slide; a new group looks like the theme', () => {
    const { content, newId } = setup();
    const words = `${WORDS.replace('[Chorus]', 'નવી પંક્તિ\nNavī pankti\n\n[Chorus]')}\n[Verse 2]\nPlaceholder new verse\nNamūnā navī\n`;
    const change = must(applyWords(content(), words, look, newId));
    expect([change.kept, change.added]).toEqual([3, 2]);
    const rows = change.rows;
    const verse = must(rows.groups.find((g) => g.name === 'Verse 1'));
    const added = must(rows.slides.find((s) => s.group_id === verse.id && s.id.startsWith('new-')));
    expect(textOf(rows, added.id).runs).toEqual([
      { text: 'નવી પંક્તિ\n', size: 90, lang: 'gu' },
      { text: 'Navī pankti', size: 60, italic: true, lang: 'translit' },
    ]);
    // No cues come with it, and it keeps the first slide's colour.
    expect(rows.cues.filter((c) => c.slide_id === added.id)).toEqual([]);
    expect(added.background).toBe('#223344');
    const verse2 = must(rows.groups.find((g) => g.name === 'Verse 2'));
    expect(verse2.color).toBe('#3e63dd');
    const fresh = must(rows.slides.find((s) => s.group_id === verse2.id));
    expect(fresh.background).toBe('#101010');
    const box = must(rows.elements.find((e) => e.slide_id === fresh.id));
    expect([box.x, box.y, box.width, box.height]).toEqual([10, 20, 300, 200]);
    const freshText = textOf(rows, fresh.id);
    expect(freshText.style.fontSize).toBe(66);
    expect(freshText.runs).toEqual([
      { text: 'Placeholder new verse\n', lang: 'en' },
      { text: 'Namūnā navī', lang: 'translit', size: 44, italic: true },
    ]);
  });

  it('moving and removing groups keeps arrangements pointing at the groups still there', () => {
    const { content, newId } = setup();
    const before = content();
    const [verse, chorus] = before.groups.map((g) => g.id);
    const moved = must(
      applyWords(
        before,
        '[Chorus]\nPlaceholder chorus\n\n[Verse 1]\nનમૂના પંક્તિ\nNamūnā pankti\n\nPlaceholder second slide\n',
        look,
        newId,
      ),
    ).rows;
    expect(moved.groups.map((g) => [g.id, g.position])).toEqual([
      [chorus, 0],
      [verse, 1],
    ]);
    expect(moved.arrangementEntries.map((e) => e.group_id)).toEqual([verse, chorus, verse]);
    const removed = must(applyWords(before, '[Chorus]\nPlaceholder chorus\n', look, newId));
    expect(removed.removed).toBe(2);
    expect(removed.rows.arrangementEntries.map((e) => e.group_id)).toEqual([chorus]);
    // The pictures-only slide went with its group; nothing was left dangling.
    expect(removed.rows.slides.map((s) => s.group_id)).toEqual([chorus]);
  });

  it('keeps disabled slides and slides without words where they were', () => {
    const { content, newId } = setup();
    const before = content();
    const words = WORDS.replace('Placeholder second slide', 'Placeholder second slide, fixed');
    const change = must(applyWords(before, words, look, newId));
    const verse = must(change.rows.groups[0]).id;
    const order = (rows: ContentRows) =>
      rows.slides
        .filter((s) => s.group_id === verse)
        .sort((a, b) => a.position - b.position)
        .map((s) => s.id);
    expect(order(change.rows)).toEqual(order(before));
  });

  it('repeated headers set the "As written" order, as the importer does', () => {
    const { content, newId } = setup();
    const change = must(applyWords(content(), `${WORDS}[Verse 1]\n`, look, newId));
    const written = must(change.rows.arrangements.find((a) => a.name === 'As written'));
    const [verse, chorus] = change.rows.groups.map((g) => g.id);
    expect(
      change.rows.arrangementEntries.filter((e) => e.arrangement_id === written.id).map((e) => e.group_id),
    ).toEqual([verse, chorus, verse]);
    // The presentation had its own order selected, and keeps it.
    expect(change.rows.selectedArrangementId).toBe(content().selectedArrangementId);
  });

  it('shares lines among several text boxes as before', () => {
    const { db, repo, newId } = setup();
    const two = repo.insert({
      libraryId: repo.ensureLibrary('Kirtans'),
      name: 'Two boxes',
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              elements: [
                text('Top one\nTop two', undefined, { x: 0, y: 0, width: 100, height: 50 }),
                text('Bottom', undefined, { x: 0, y: 60, width: 100, height: 50 }),
              ],
            },
          ],
        },
      ],
    });
    const rows = must(readContent(db, two));
    expect(wordsOf(rows)).toBe('[Verse]\nTop one\nTop two\nBottom\n');
    const change = must(applyWords(rows, '[Verse]\nTop one\nTop 2\nBottom\nExtra\n', look, newId));
    const texts = change.rows.elements.map((e) => (JSON.parse(e.props) as TextElement).text);
    expect(texts).toEqual(['Top one\nTop 2', 'Bottom\nExtra']);
  });

  it('refuses no words at all, and knows legacy-font text', () => {
    const { content, newId, db, repo } = setup();
    expect(applyWords(content(), '\n\n', look, newId)).toBeNull();
    expect(legacyFonts(content())).toEqual([]);
    const old = repo.insert({
      libraryId: repo.ensureLibrary('Kirtans'),
      name: 'Old',
      groups: [
        {
          name: 'G',
          slides: [{ elements: [text('Rkk', [{ text: 'Rkk', legacy: true, font: 'Gopika' }])] }],
        },
      ],
    });
    expect(legacyFonts(must(readContent(db, old)))).toEqual(['Gopika']);
  });

  it('writes the rows back exactly as read', () => {
    const { db, content } = setup();
    const before = content();
    db.transaction(() => {
      writeContent(db, before);
    })();
    expect(content()).toEqual(before);
  });
});
