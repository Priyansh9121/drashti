import { describe, expect, it } from 'vitest';
import { NOT_USED, usageLines } from './media-removal';

describe('where deleted media is used, as the question says it', () => {
  it('says nothing for media nothing uses', () => {
    expect(usageLines(NOT_USED)).toEqual([]);
  });

  it('names what uses it, a few at most, for one item or several', () => {
    const usage = {
      ...NOT_USED,
      presentations: { names: ['Placeholder Katha'], count: 1 },
      playlists: { names: ['Sunday', 'Youth', 'Evening', 'Shibir', 'Bal'], count: 7 },
      music: { names: ['Before sabha'], count: 1 },
      themes: { names: ['Placeholder theme', 'Other theme'], count: 2 },
      idle: true,
    };
    expect(usageLines(usage)).toEqual([
      'The slides of “Placeholder Katha”: nothing will show in its place.',
      'The playlists “Sunday”, “Youth”, “Evening”, “Shibir”, “Bal” and 2 more: taken out of them.',
      'The music “Before sabha”: taken out of it.',
      'The themes “Placeholder theme” and “Other theme”: nothing will show in its place.',
      'The idle rotation’s pictures: taken out of them.',
    ]);
    expect(usageLines(usage, 3)[0]).toBe(
      'The slides of “Placeholder Katha”: nothing will show in their place.',
    );
  });
});
