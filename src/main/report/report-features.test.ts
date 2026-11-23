import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANUAL_CHAPTERS } from '../../shared/manual';
import { featureGroups, guessFeatures, reportFeatures, SOMETHING_ELSE } from '../../shared/report-features';

/*
 * Help › Report a Problem…'s features are the Drashti Manual's (x49, Q60-38: one catalogue with x37's Manual): every
 * feature of every chapter, under its chapter, found by its name or its "What it is." sentence; a notice's words name
 * the feature it is about (Report this…).
 */

const chapters = MANUAL_CHAPTERS.map((c) => ({
  id: c.id,
  text: readFileSync(join(__dirname, '..', '..', '..', 'docs', 'manual', c.file), 'utf8'),
}));
const features = reportFeatures(chapters);

describe('the features a report can name', () => {
  it('are every feature of every chapter of the Manual, in its order, then Something else', () => {
    const headings = chapters.flatMap((c) =>
      [...c.text.matchAll(/^## (.+)$/gmu)].map((m) => ({ chapterId: c.id, name: (m[1] ?? '').trim() })),
    );
    expect(headings.length).toBeGreaterThan(100);
    expect(features.map((f) => ({ chapterId: f.chapterId, name: f.name }))).toEqual([
      ...headings,
      { chapterId: 'other', name: 'Something else' },
    ]);
    expect(features.at(-1)).toEqual(SOMETHING_ELSE);
    const titles = new Map(MANUAL_CHAPTERS.map((c) => [c.id, c.title]));
    for (const f of features.slice(0, -1)) {
      expect(f.chapter, f.name).toBe(titles.get(f.chapterId as never));
      expect(f.id, f.name).toMatch(/^[a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(f.about.length, f.name).toBeGreaterThan(10);
      expect(f.about, f.name).not.toMatch(/^What it is/u);
    }
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
    expect(features.find((f) => f.name === 'The time bar')?.id).toBe('live/the-time-bar');
  });

  it('are grouped by chapter, Simple Mode’s first in Simple Mode, and found by their words', () => {
    const all = featureGroups(features, { mode: 'pro', query: '' });
    expect(all.map((g) => g.title)).toEqual([...MANUAL_CHAPTERS.map((c) => c.title), 'Something else']);
    expect(featureGroups(features, { mode: 'simple', query: '' })[0]?.title).toBe('Simple Mode');
    const names = (query: string) =>
      featureGroups(features, { mode: 'pro', query }).flatMap((g) => g.features.map((f) => f.name));
    expect(names('time bar')).toContain('The time bar');
    expect(names('markers')).toContain('Markers');
    expect(names('captions').filter((n) => /captions/iu.test(n)).length).toBeGreaterThanOrEqual(3);
    // Something else is always there to choose, whatever is searched.
    expect(names('placeholder words found nowhere')).toEqual(['Something else']);
  });

  it('a notice’s own words name the feature it is about, or none when they name none', () => {
    const save = guessFeatures(features, 'Could not save diagnostics: see the log in the data folder.');
    expect(save.best?.name).toBe('Save Diagnostics');
    expect(save.order[0]?.name).toBe('Save Diagnostics');
    expect(guessFeatures(features, 'Placeholder xyzzy plugh.').best).toBeNull();
  });
});
