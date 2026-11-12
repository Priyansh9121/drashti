import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readPptxDeck } from '../pictures';
import { readZipEntries } from '../zip';
import { COMPARISON_SLIDES, writeComparisonDeck } from './powerpoint-comparison-deck';

const dir = mkdtempSync(join(tmpdir(), 'drashti-comparison-deck-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the deck PowerPoint’s own movie is compared against', () => {
  it('writes each effect as PowerPoint itself does, so Drashti reads it as PowerPoint plays it', async () => {
    const file = await writeComparisonDeck(dir);
    const deck = await readPptxDeck(file);
    expect(deck.slides).toHaveLength(COMPARISON_SLIDES.length);
    expect(COMPARISON_SLIDES.map((slide) => slide.marker)).toEqual(COMPARISON_SLIDES.map((_, i) => 20 + 4 * i));
    const motion = (name: string) =>
      deck.slides[COMPARISON_SLIDES.findIndex((slide) => slide.name === name)]?.deck?.motion;
    // A whole size is written #ppt_w and #ppt_h, as PowerPoint writes it, never #ppt_w*1 (PowerPoint plays both the
    // same, but Drashti reads only its own form as the shape's own size: run 1's deck lost Grow & Turn's turn so).
    const parts = await readZipEntries(file, (name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
    expect(parts.size).toBe(COMPARISON_SLIDES.length);
    for (const [name, xml] of parts) expect(xml.toString('utf8'), name).not.toMatch(/#ppt_[wh]\*1"/u);
    expect(motion('Grow & Turn')).toMatchObject({
      approximate: false,
      effects: [{ phase: 'in', kind: 'zoom', fade: true, scale: 0, degrees: 90, durationMs: 700 }],
    });
    expect(motion('Shrink & Turn')).toMatchObject({
      approximate: false,
      effects: [{ phase: 'out', kind: 'zoom', fade: true, scale: 0, degrees: 90, durationMs: 700 }],
    });
    expect(motion('Basic Zoom · In')).toMatchObject({
      approximate: false,
      effects: [{ phase: 'in', kind: 'zoom', durationMs: 700 }],
    });
    expect(motion('Float In Up')).toMatchObject({
      approximate: false,
      effects: [{ phase: 'in', kind: 'float', direction: 'up', distance: 0.08, durationMs: 700 }],
    });
  });
});
