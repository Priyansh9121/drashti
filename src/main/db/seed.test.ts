import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { PresentationRepo } from './presentations';
import { slideLines } from '../../shared/tracks';
import { KIRTAN_PRESENTATION_NAME, seedPlaceholders, TEST_LINES, TEST_PRESENTATION_NAME } from './seed';

describe('seedPlaceholders', () => {
  it('adds the two placeholder presentations once', () => {
    const db = openDatabase(':memory:');
    expect(seedPlaceholders(db)).toBe(true);
    expect(seedPlaceholders(db)).toBe(false);
    const list = new PresentationRepo(db).list();
    expect(list.map((p) => p.name)).toEqual([TEST_PRESENTATION_NAME, KIRTAN_PRESENTATION_NAME].sort());
  });

  it('puts one line in each language on the first test slide', () => {
    const db = openDatabase(':memory:');
    seedPlaceholders(db);
    const repo = new PresentationRepo(db);
    const test = repo.list().find((p) => p.name === TEST_PRESENTATION_NAME);
    const first = test && repo.get(test.id)?.groups[0]?.slides[0]?.slide;
    const lines = first?.elements.flatMap((e) => (e.kind === 'text' ? [[e.lang, e.text]] : []));
    expect(lines).toEqual([
      ['en', TEST_LINES.en],
      ['gu', TEST_LINES.gu],
      ['hi', TEST_LINES.hi],
      ['translit', TEST_LINES.translit],
    ]);
    expect(test && repo.get(test.id)?.source).toMatchObject({ kind: 'drashti', ref: 'seed:language-test' });
  });

  it('gives the sample kirtan all four language tracks on every slide', () => {
    const db = openDatabase(':memory:');
    seedPlaceholders(db);
    const repo = new PresentationRepo(db);
    const summary = repo.list().find((p) => p.name === KIRTAN_PRESENTATION_NAME);
    expect(summary?.kirtanTracks).toEqual(['en', 'gu', 'hi', 'translit']);
    const doc = summary && repo.get(summary.id);
    const slides = doc?.groups.flatMap((g) => g.slides) ?? [];
    expect(slides).toHaveLength(3);
    // The tracks are the slides' own words, one line in each language.
    for (const s of slides)
      expect(Object.keys(slideLines(s.slide.elements).lines).sort()).toEqual(['en', 'gu', 'hi', 'translit']);
    expect(doc?.kirtan).toMatchObject({ category: 'Kirtan', tracks: ['en', 'gu', 'hi', 'translit'] });
    expect(slides.every((s) => s.slide.kirtan === true)).toBe(true);
  });

  it('does not come back after the operator deletes the placeholders', () => {
    const db = openDatabase(':memory:');
    seedPlaceholders(db);
    db.prepare('DELETE FROM presentations').run();
    expect(seedPlaceholders(db)).toBe(false);
    expect(new PresentationRepo(db).list()).toEqual([]);
  });
});
