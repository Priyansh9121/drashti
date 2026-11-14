import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { powerPointPlan } from '../deck/plan';
import { readEditablePptx } from '../deck/editable-pptx';
import { readPptxDeck } from '../pictures';
import { readZipEntries } from '../zip';
import { STILLS_DARK, STILLS_LIGHT, writeStillsDeck } from './powerpoint-comparison-stills';

/*
 * PF-12 (Session 58): PowerPoint's own stills of what Drashti's reader assumes about spacing and tables, never seen in
 * real PowerPoint (the review of C15's 12c35e3d, LOW-1; of 0b15c784): spcPct's base, the first/last-paragraph rule and
 * PowerPoint's default table style on a light and a dark theme.
 */
const dir = mkdtempSync(join(tmpdir(), 'drashti-comparison-stills-'));
const out = join(dir, 'editable');
let light = '';
let dark = '';
beforeAll(async () => {
  light = await writeStillsDeck(dir, STILLS_LIGHT);
  dark = await writeStillsDeck(dir, STILLS_DARK);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const PX = 12_192_000 / 1280; // EMU a pixel of Drashti's 1280-wide slide
/** 40 pt words, as Drashti's slide pixels: 40 x 4/3 (to the thousandth, as `space` gives them). */
const SIZE = Math.round(((40 * 4) / 3) * 1000) / 1000;
const thousandths = (n: number) => Math.round(n * 1000) / 1000;

describe('the stills PowerPoint draws for PF-12', () => {
  it('writes a light deck and a dark one, each slide a gray marker as the motion decks have, all 16:9', async () => {
    for (const [file, deck] of [
      [light, STILLS_LIGHT],
      [dark, STILLS_DARK],
    ] as const) {
      expect(file.endsWith(deck.file)).toBe(true);
      const read = await readPptxDeck(file);
      expect(read.size).toEqual({ cx: 12_192_000, cy: 6_858_000 });
      expect(read.slides).toHaveLength(deck.slides.length);
      expect(deck.slides.map((slide) => slide.marker)).toEqual(deck.slides.map((_, i) => 20 + 4 * i));
      // Stills: no clicks, no transitions; each slide held as the plan holds a still.
      const plan = powerPointPlan(read.slides);
      for (const slide of plan.slides) {
        expect(slide.groups).toEqual([]);
        expect(slide.transitionMs).toBe(0);
      }
    }
    const master = await readZipEntries(dark, (name) => name === 'ppt/slideMasters/slideMaster1.xml');
    expect(master.get('ppt/slideMasters/slideMaster1.xml')?.toString('utf8')).toContain(
      '<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"',
    );
    for (const file of [light, dark]) {
      const parts = await readZipEntries(file, (name) =>
        /^ppt\/(theme\/theme1|tableStyles)\.xml$/u.test(name),
      );
      // Office's own accent 1, so that PowerPoint's well-known default table colours can be checked.
      expect(parts.get('ppt/theme/theme1.xml')?.toString('utf8')).toContain(
        '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>',
      );
      expect(parts.get('ppt/tableStyles.xml')?.toString('utf8')).toContain(
        'def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"',
      );
    }
  });

  it('spaces paragraphs by spcPct and spcPts, and at a box’s edges with and without spcFirstLastPara, as Drashti reads them', async () => {
    const deck = await readEditablePptx(light, out);
    const paragraphsOf = (name: string) => {
      const index = STILLS_LIGHT.slides.findIndex((slide) => slide.name === name);
      expect(index, name).toBeGreaterThanOrEqual(0);
      const element = deck.slides[index]?.elements.find((e) => e.kind === 'text');
      expect(element, name).toBeDefined();
      return element?.kind === 'text' ? element : null;
    };
    // Each paragraph's runs carry its one formatting (the reader shares it among them).
    const space = (name: string) =>
      [...new Set((paragraphsOf(name)?.runs ?? []).map((run) => run.paragraph))].map((p) => [
        thousandths(p?.spaceBefore ?? 0),
        thousandths(p?.spaceAfter ?? 0),
      ]);
    expect(space('Spacing · none')).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    // spcPct: of the text size here (ECMA's words), 100 % of 40 pt words.
    expect(space('Spacing · before 100% (spcPct)')).toEqual([
      [0, 0],
      [SIZE, 0],
      [SIZE, 0],
    ]);
    expect(space('Spacing · before 50%, after 100% (spcPct)')).toEqual([
      [0, SIZE],
      [thousandths(SIZE / 2), 0],
      [0, 0],
    ]);
    // spcPts: 24 pt, exact by its definition: the measure's own check.
    expect(space('Spacing · before 24 pt (spcPts)')).toEqual([
      [0, 0],
      [32, 0],
      [32, 0],
    ]);
    expect(space('Edges · before the first paragraph, top')[0]).toEqual([SIZE, 0]);
    expect(space('Edges · after the last paragraph, bottom')[2]).toEqual([0, SIZE]);
    // Dropped unless the box says spcFirstLastPara (Drashti's reading of ECMA-376's rule: PowerPoint's to be seen).
    expect(paragraphsOf('Edges · before the first paragraph, top')?.style.spaceAtTextEdges).toBeUndefined();
    expect(paragraphsOf('Edges · before the first paragraph, spcFirstLastPara')?.style.spaceAtTextEdges).toBe(
      true,
    );
    // The words' box where the slide puts it.
    const box = paragraphsOf('Spacing · none')?.frame;
    expect(box).toEqual({
      x: STILLS_LIGHT.slides[0]?.box.x / PX,
      y: STILLS_LIGHT.slides[0]?.box.y / PX,
      width: STILLS_LIGHT.slides[0]?.box.w / PX,
      height: STILLS_LIGHT.slides[0]?.box.h / PX,
    });
  });

  it('draws the default-style table from the deck’s own tableStyles.xml, on the light deck and the dark one', async () => {
    for (const [file, deck] of [
      [light, STILLS_LIGHT],
      [dark, STILLS_DARK],
    ] as const) {
      const read = await readEditablePptx(file, join(out, deck.file));
      const index = deck.slides.findIndex((slide) => slide.table);
      // A table comes in as its cells' words (each with its place in the table) over their fills.
      const cells = (read.slides[index]?.elements ?? []).filter((e) => e.kind === 'text' && e.tableCell);
      expect(cells, deck.file).toHaveLength(12);
      expect(read.slides[index]?.issues ?? [], deck.file).toEqual([]);
    }
  });
});
