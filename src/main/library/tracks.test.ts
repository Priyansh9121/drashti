import { describe, expect, it } from 'vitest';
import type { SlideElement, TextElement, TextRun } from '../../shared/model';
import { slideLines } from '../../shared/tracks';
import type { ContentRows } from '../db/content';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { LYRICS_STYLE } from '../import/formats/text';
import { applySlideEdit, editDocOf } from './slides';
import { applyTrackEdits, detailsOf, trackSlidesOf, withDetails } from './tracks';
import type { NewSlideLook } from './words';
import { applyWords, wordsOf } from './words';

/* Placeholder words only: never real kirtan text. */

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

const box = (id: string, runs: TextRun[], y = 200): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 100, y, width: 1720, height: 500 },
  text: runs.map((r) => r.text).join(''),
  lang: 'gu',
  style: LYRICS_STYLE,
  runs,
});

const look: NewSlideLook = {
  frame: { x: 10, y: 20, width: 300, height: 200 },
  style: { ...LYRICS_STYLE, fontSize: 66 },
  langs: { en: { size: 40, color: '#dddddd' }, translit: { size: 44, italic: true } },
  background: null,
};

function setup() {
  const db = openDatabase(':memory:');
  const repo = new PresentationRepo(db);
  const libraryId = repo.ensureLibrary('Kirtans');
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable) VALUES ('pic', 'image', 'Placeholder.png', 'ab/c.png', 1)",
  ).run();
  const picture: SlideElement = {
    id: 'p',
    kind: 'image',
    frame: { x: 0, y: 0, width: 300, height: 300 },
    mediaId: 'pic',
    fit: 'fit',
  };
  const id = repo.insert({
    libraryId,
    name: 'Placeholder Kirtan',
    groups: [
      {
        name: 'Verse',
        slides: [
          {
            elements: [
              box('a', [
                { text: 'પહેલી પંક્તિ\n', lang: 'gu', size: 90 },
                { text: 'Paheli pankti', lang: 'translit', size: 60, italic: true },
              ]),
            ],
          },
          { elements: [picture, box('b', [{ text: 'બીજી પંક્તિ', lang: 'gu', size: 90 }])] },
          { elements: [box('c', [{ text: 'Hidden line', lang: 'en' }])], enabled: false },
        ],
      },
      { name: 'Chorus', slides: [{ elements: [box('d', [{ text: 'ટેક', lang: 'gu', size: 90 }])] }] },
    ],
    kirtan: { category: 'Kirtan', kavi: 'Placeholder Kavi' },
  });
  const content = () => must(repo.content(id));
  return { db, repo, id, content };
}

describe('a kirtan by language', () => {
  it('lists every slide that plays, with its lines in each language', () => {
    const { content } = setup();
    const { slides, order } = trackSlidesOf(content());
    expect(slides.map((s) => [s.number, s.groupName, s.lines])).toEqual([
      [1, 'Verse', { gu: ['પહેલી પંક્તિ'], translit: ['Paheli pankti'] }],
      [2, 'Verse', { gu: ['બીજી પંક્તિ'] }],
      [3, 'Chorus', { gu: ['ટેક'] }],
    ]);
    // The slides' own order first, then the languages none of them has yet.
    expect(order).toEqual(['gu', 'translit', 'en', 'hi']);
  });

  it('puts changed lines back, slide by slide, and keeps every other row exactly', () => {
    const { repo, id, content } = setup();
    const before = content();
    const [s1, s2, s3] = trackSlidesOf(before).slides.map((s) => s.slideId);
    const { rows, changed } = applyTrackEdits(
      before,
      [
        { slideId: must(s1), lang: 'translit', lines: ['Paheli badleli'] },
        { slideId: must(s2), lang: 'translit', lines: ['Biji pankti'] },
        { slideId: must(s3), lang: 'en', lines: ['Placeholder refrain'] },
        // The same words again: nothing to change.
        { slideId: must(s1), lang: 'gu', lines: ['પહેલી પંક્તિ'] },
      ],
      look,
      () => 'new-id',
    );
    expect(changed).toBe(3);
    repo.setContent(rows);
    const after = trackSlidesOf(content()).slides;
    expect(after.map((s) => s.lines)).toEqual([
      { gu: ['પહેલી પંક્તિ'], translit: ['Paheli badleli'] },
      { gu: ['બીજી પંક્તિ'], translit: ['Biji pankti'] },
      { gu: ['ટેક'], en: ['Placeholder refrain'] },
    ]);
    // The picture and the hidden slide are untouched; changed boxes keep their place in the slide.
    const now = new Map(content().elements.map((e) => [e.id, e]));
    for (const e of before.elements)
      if (e.kind !== 'text' || ![s1, s2, s3].includes(e.slide_id)) expect(now.get(e.id)).toEqual(e);
    expect(
      content()
        .elements.map((e) => [e.slide_id, e.position])
        .sort(),
    ).toEqual(before.elements.map((e) => [e.slide_id, e.position]).sort());
    // A language new to a slide takes its look from elsewhere in the kirtan (translit), else the theme's (en).
    const doc = must(repo.get(id));
    const runsOf = (n: number) =>
      doc.groups.flatMap((g) => g.slides)[n]?.slide.elements.find((e): e is TextElement => e.kind === 'text')
        ?.runs;
    expect(runsOf(1)?.[1]).toEqual({ text: 'Biji pankti', lang: 'translit', size: 60, italic: true });
    expect(runsOf(2)?.[1]).toEqual({ text: 'Placeholder refrain', size: 40, color: '#dddddd', lang: 'en' });
    expect(repo.list()[0]?.kirtanTracks).toEqual(['en', 'gu', 'translit']);
  });

  it('takes a language off a slide, which then shows it as missing', () => {
    const { repo, content } = setup();
    const [s1] = trackSlidesOf(content()).slides;
    const { rows } = applyTrackEdits(
      content(),
      [{ slideId: must(s1).slideId, lang: 'translit', lines: [] }],
      look,
    );
    repo.setContent(rows);
    expect(trackSlidesOf(content()).slides[0]?.lines).toEqual({ gu: ['પહેલી પંક્તિ'] });
  });

  it('makes a presentation a kirtan and back without touching its words', () => {
    const { repo, id, content } = setup();
    const before = content();
    repo.setContent(withDetails(before, null));
    expect(repo.get(id)?.kirtan).toBeNull();
    expect(content().elements).toEqual(before.elements);
    expect(repo.list()[0]?.kirtanTracks).toBeNull();
    repo.setContent(withDetails(content(), { ...must(detailsOf(before)), raag: 'Placeholder Raag' }));
    expect(repo.get(id)?.kirtan).toMatchObject({ kavi: 'Placeholder Kavi', raag: 'Placeholder Raag' });
    expect(content().elements).toEqual(before.elements);
    expect(repo.list()[0]?.kirtanTracks).toEqual(['gu', 'translit']);
  });
});

describe('one copy of the words', () => {
  /** What each editor reads: the All words text, the slide editor's text boxes, and the tracks. */
  function views(rows: ContentRows) {
    const { doc } = editDocOf(rows, 'Placeholder Kirtan');
    const boxes = doc.groups.flatMap((g) =>
      g.slides.filter((s) => s.enabled).map((s) => slideLines(s.elements).lines),
    );
    return { words: wordsOf(rows), boxes, tracks: trackSlidesOf(rows).slides.map((s) => s.lines) };
  }

  it('Edit words, the slide editor and the tracks all read the same words after each saves', () => {
    const { repo, content } = setup();
    // By language...
    const first = must(trackSlidesOf(content()).slides[0]).slideId;
    repo.setContent(
      applyTrackEdits(content(), [{ slideId: first, lang: 'translit', lines: ['Navi'] }], look).rows,
    );
    let v = views(content());
    expect(v.boxes).toEqual(v.tracks);
    expect(v.words).toContain('પહેલી પંક્તિ\nNavi');
    // ...then All words...
    const all = must(applyWords(content(), v.words.replace('Navi', 'Navi badli'), look));
    repo.setContent(all.rows);
    v = views(content());
    expect(v.boxes).toEqual(v.tracks);
    expect(v.tracks[0]).toEqual({ gu: ['પહેલી પંક્તિ'], translit: ['Navi badli'] });
    // ...then the slide editor (typing in the box replaces its runs).
    const rows = content();
    const { doc } = editDocOf(rows, 'Placeholder Kirtan');
    const slide = must(doc.groups[0]?.slides[0]);
    const el = must(slide.elements.find((e): e is TextElement => e.kind === 'text'));
    slide.elements = [
      {
        ...el,
        text: 'પહેલી પંક્તિ\nTyped here',
        runs: [
          { text: 'પહેલી પંક્તિ\n', lang: 'gu', size: 90 },
          { text: 'Typed here', lang: 'translit', size: 60, italic: true },
        ],
      },
    ];
    repo.setContent(applySlideEdit(rows, doc));
    v = views(content());
    expect(v.boxes).toEqual(v.tracks);
    expect(v.tracks[0]).toEqual({ gu: ['પહેલી પંક્તિ'], translit: ['Typed here'] });
    expect(v.words).toContain('પહેલી પંક્તિ\nTyped here');
  });

  it('keeps a plain transliteration line as transliteration when All words changes it', () => {
    const { repo, content } = setup();
    // "Paheli pankti" has no accent marks: by its letters it would read as English.
    const all = must(applyWords(content(), wordsOf(content()).replace('Paheli pankti', 'Paheli navi'), look));
    repo.setContent(all.rows);
    expect(trackSlidesOf(content()).slides[0]?.lines).toEqual({
      gu: ['પહેલી પંક્તિ'],
      translit: ['Paheli navi'],
    });
  });
});
