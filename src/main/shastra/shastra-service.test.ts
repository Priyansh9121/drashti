import { describe, expect, it } from 'vitest';
import { readShastraFile } from '../../shared/shastra';
import type { FitTargets } from '../../shared/shastra-slides';
import { FIT_EVERYWHERE } from '../../shared/shastra-slides';
import { DEFAULT_THEME } from '../../shared/themes';
import { openDatabase } from '../db/database';
import { ShastraRepo } from '../db/shastra';
import { ShastraService } from './shastra-service';

/* Passages as the engine and the slide grid see them (placeholder texts only). */

function setup() {
  const repo = new ShastraRepo(openDatabase(':memory:'));
  const read = readShastraFile({
    format: 'drashti-shastra',
    version: 1,
    name: 'Placeholder Granth',
    abbreviation: 'PG',
    items: [1, 2, 3].map((n) => ({
      number: n,
      text: {
        sa: `नमूना श्लोकः ${n}`,
        en:
          n === 3
            ? Array.from({ length: 40 }, (_, i) => `Placeholder sentence ${i + 1}.`).join(' ')
            : `Placeholder ${n}.`,
      },
    })),
  });
  if (!read.ok) throw new Error(read.message);
  repo.load(read.text, { path: null, hash: 'h' }, 'plain');
  let targets: FitTargets = FIT_EVERYWHERE;
  let theme = DEFAULT_THEME;
  const service = new ShastraService({
    repo,
    theme: () => theme,
    targets: () => targets,
  });
  return {
    service,
    setTargets: (t: FitTargets) => {
      targets = t;
    },
    setTheme: (t: typeof DEFAULT_THEME) => {
      theme = t;
    },
  };
}

describe('ShastraService', () => {
  it('gives the engine a passage’s slides, a long item over several', () => {
    const { service } = setup();
    const order = service.order('shastra:pg#1-3');
    expect(order?.arrangementId).toBeNull();
    const ids = order?.slides.map((s) => s.id) ?? [];
    expect(ids.slice(0, 2)).toEqual(['shastra:pg#1-3#1.1', 'shastra:pg#1-3#2.1']);
    expect(ids.length).toBeGreaterThan(3);
    // The same slide objects come back until something changes.
    expect(service.order('shastra:pg#1-3')?.slides[0]?.slide).toBe(order?.slides[0]?.slide);
    expect(service.order('shastra:pg#9')).toBeNull();
    expect(service.order('not-a-passage')).toBeNull();
  });

  it('shows the slide grid a group for each item, named by its reference', () => {
    const { service } = setup();
    const doc = service.doc('shastra:pg#2-3');
    expect(doc).toMatchObject({
      name: 'Placeholder Granth 2–3',
      passage: { reference: 'Placeholder Granth 2–3', key: { text: 'pg', from: 2, to: 3 } },
      kirtan: null,
    });
    expect(doc?.groups.map((g) => g.name)).toEqual(['Placeholder Granth 2', 'Placeholder Granth 3']);
    const third = doc?.groups[1]?.slides ?? [];
    expect(third.length).toBeGreaterThan(1);
    expect(third[0]?.label).toBe(`1 of ${third.length}`);
    // The slide grid's indexes run on through the groups, as the engine's order does.
    expect(doc?.groups.flatMap((g) => g.slides.map((s) => s.index))).toEqual(
      service.order('shastra:pg#2-3')?.slides.map((_, i) => i),
    );
  });

  it('makes the slides again when the theme or the live Look changes', () => {
    const { service, setTargets, setTheme } = setup();
    const before = service.order('shastra:pg#3')?.slides.length ?? 0;
    setTargets({ designed: ['en'], lowerThirds: [] });
    const englishOnly = service.order('shastra:pg#3')?.slides.length ?? 0;
    expect(englishOnly).toBeLessThanOrEqual(before);
    setTargets({ designed: 'none', lowerThirds: [['en']] });
    expect(service.order('shastra:pg#3')?.slides.length ?? 0).toBeGreaterThan(englishOnly);
    setTheme({ ...DEFAULT_THEME, background: { kind: 'color', color: '#203040' } });
    expect(service.order('shastra:pg#3')?.slides[0]?.slide.background).toBe('#203040');
  });

  it('resolves a reference to a passage ready to show, or says why not', () => {
    const { service } = setup();
    expect(service.resolve('PG 2-3')).toEqual({
      ok: true,
      passage: {
        passageId: 'shastra:pg#2-3',
        key: { text: 'pg', sections: [], from: 2, to: 3 },
        reference: 'Placeholder Granth 2–3',
      },
    });
    expect(service.resolve('PG 7')).toEqual({
      ok: false,
      message: 'Placeholder Granth has no 7: it goes from 1 to 3.',
    });
  });
});
