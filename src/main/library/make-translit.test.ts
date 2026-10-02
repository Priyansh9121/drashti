import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../../shared/model';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { LYRICS_STYLE } from '../import/formats/text';
import { planTransliteration } from './make-translit';
import { applyTrackEdits, trackSlidesOf } from './tracks';
import type { NewSlideLook } from './words';

/* Common words only: never lines from kirtans. */

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

const box = (runs: TextRun[]): TextElement => ({
  id: 'x',
  kind: 'text',
  frame: { x: 100, y: 200, width: 1720, height: 500 },
  text: runs.map((r) => r.text).join(''),
  lang: 'gu',
  style: LYRICS_STYLE,
  runs,
});

const look: NewSlideLook = {
  frame: { x: 10, y: 20, width: 300, height: 200 },
  style: LYRICS_STYLE,
  langs: { translit: { size: 44, italic: true } },
  background: null,
};

function setup() {
  const db = openDatabase(':memory:');
  const repo = new PresentationRepo(db);
  const id = repo.insert({
    libraryId: repo.ensureLibrary('Kirtans'),
    name: 'Placeholder Words',
    groups: [
      {
        name: 'Verse',
        slides: [
          { elements: [box([{ text: 'ઘર અને મંદિર', lang: 'gu' }])] },
          { elements: [box([{ text: 'भजन और आरती', lang: 'hi' }])] },
          { elements: [box([{ text: 'Placeholder only', lang: 'en' }])] },
        ],
      },
    ],
    kirtan: {},
  });
  const content = () => must(repo.content(id));
  /** Make the track as the main process would, and keep the result. */
  const make = (style: 'plain' | 'iso', replaceManual = false) => {
    const before = content();
    const plan = planTransliteration(before, style, replaceManual);
    const { rows } = applyTrackEdits(before, plan.edits, look);
    repo.setContent({ ...rows, autoLines: plan.autoLines });
    return plan;
  };
  const translit = () => trackSlidesOf(content()).slides.map((s) => s.lines.translit ?? null);
  const made = () => trackSlidesOf(content()).slides.map((s) => s.made.includes('translit'));
  return { repo, id, content, make, translit, made };
}

describe('making a kirtan’s transliteration', () => {
  it('fills it from the Gujarati, or the Hindi, in the style chosen, marked as made by Drashti', () => {
    const t = setup();
    const plan = t.make('plain');
    expect(plan).toMatchObject({ added: 2, renewed: 0, same: 0, manual: [], noSource: 1 });
    expect(t.translit()).toEqual([['Ghar ane mandir'], ['Bhajan aur arti'], null]);
    expect(t.made()).toEqual([true, true, false]);
    // It goes after the words it reads, in the look the theme gives it.
    const first = must(t.repo.get(t.id)).groups[0]?.slides[0]?.slide.elements[0];
    expect(first?.kind === 'text' ? first.runs : null).toEqual([
      { text: 'ઘર અને મંદિર\n', lang: 'gu' },
      { text: 'Ghar ane mandir', size: 44, italic: true, lang: 'translit' },
    ]);
  });

  it('makes lines it made again (a new style), and keeps a line changed by hand unless asked to replace it', () => {
    const t = setup();
    t.make('plain');
    // The operator changes the first slide's line (in any editor: it is the slide's own words).
    const first = must(trackSlidesOf(t.content()).slides[0]).slideId;
    t.repo.setContent(
      applyTrackEdits(t.content(), [{ slideId: first, lang: 'translit', lines: ['Ghar ne mandir'] }], look)
        .rows,
    );
    expect(t.made()).toEqual([false, true, false]);

    const again = t.make('iso');
    expect(again).toMatchObject({ added: 0, renewed: 1, same: 0, noSource: 1 });
    expect(again.manual).toEqual([
      expect.objectContaining({ number: 1, now: 'Ghar ne mandir', made: 'Ghar anē maṁdir' }),
    ]);
    expect(t.translit()).toEqual([['Ghar ne mandir'], ['Bhajan aur ārtī'], null]);
    expect(t.made()).toEqual([false, true, false]);

    // Making it again in the same style changes nothing.
    expect(t.make('iso')).toMatchObject({ added: 0, renewed: 0, same: 1, edits: [] });

    // Asked to, it replaces the operator's line too, which is then made by Drashti again.
    const replaced = t.make('iso', true);
    expect(replaced.edits).toHaveLength(1);
    expect(t.translit()).toEqual([['Ghar anē maṁdir'], ['Bhajan aur ārtī'], null]);
    expect(t.made()).toEqual([true, true, false]);
  });

  it('counts a line typed by hand that says just what it would make as made by Drashti', () => {
    const t = setup();
    const first = must(trackSlidesOf(t.content()).slides[0]).slideId;
    t.repo.setContent(
      applyTrackEdits(t.content(), [{ slideId: first, lang: 'translit', lines: ['Ghar ane mandir'] }], look)
        .rows,
    );
    expect(t.made()).toEqual([false, false, false]);
    expect(t.make('plain')).toMatchObject({ added: 1, same: 1, manual: [] });
    expect(t.made()).toEqual([true, true, false]);
  });
});
