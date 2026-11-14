import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { powerPointPlan } from '../deck/plan';
import { readEditablePptx } from '../deck/editable-pptx';
import { readPptxDeck } from '../pictures';
import { readZipEntries } from '../zip';
import {
  STILLS_DARK,
  STILLS_LIGHT,
  STILLS_RUN5_TABLES,
  STILLS_RUN5_WORDS,
  STILLS_SHRINK,
  writeStillsDeck,
} from './powerpoint-comparison-stills';

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
/** A 40 pt line, single spaced, in slide px: PowerPoint's own measure of spcPct (PF-12, C17: 1.2 times the size). */
const LINE = thousandths(SIZE * 1.2);

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
    // spcPct: of the line, as PowerPoint's stills measure it (PF-12, C17): 100 % of 40 pt words' single line.
    expect(space('Spacing · before 100% (spcPct)')).toEqual([
      [0, 0],
      [LINE, 0],
      [LINE, 0],
    ]);
    expect(space('Spacing · before 50%, after 100% (spcPct)')).toEqual([
      [0, LINE],
      [thousandths(LINE / 2), 0],
      [0, 0],
    ]);
    // spcPts: 24 pt, exact by its definition: the measure's own check.
    expect(space('Spacing · before 24 pt (spcPts)')).toEqual([
      [0, 0],
      [32, 0],
      [32, 0],
    ]);
    expect(space('Edges · before the first paragraph, top')[0]).toEqual([LINE, 0]);
    expect(space('Edges · after the last paragraph, bottom')[2]).toEqual([0, LINE]);
    // Dropped unless the box says spcFirstLastPara (Drashti's reading of ECMA-376's rule: PowerPoint's to be seen).
    expect(paragraphsOf('Edges · before the first paragraph, top')?.style.spaceAtTextEdges).toBeUndefined();
    expect(paragraphsOf('Edges · before the first paragraph, spcFirstLastPara')?.style.spaceAtTextEdges).toBe(
      true,
    );
    // The words where the slide puts them: the box less PowerPoint's own insets (0.1 in each side, 0.05 in above and
    // below: 9.6 and 4.8 of Drashti's pixels).
    const words = STILLS_LIGHT.slides[0]?.box;
    expect(paragraphsOf('Spacing · none')?.frame).toEqual({
      x: (words?.x ?? 0) / PX + 9.6,
      y: (words?.y ?? 0) / PX + 4.8,
      width: (words?.w ?? 0) / PX - 19.2,
      height: (words?.h ?? 0) / PX - 9.6,
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

/*
 * PF-4b (h-pptx3, 14 Nov evening): boxes PowerPoint shrinks, their words past the box at full size, with the shrink PowerPoint
 * saves (normAutofit's fontScale and lnSpcReduction), so that its own movie shows them as it draws them and Drashti's
 * drawing (its fit starting at PowerPoint's scale, the line spacing cut as PowerPoint cuts it) can be measured against it.
 */
describe('the shrink stills (PF-4b)', () => {
  const where = mkdtempSync(join(tmpdir(), 'drashti-comparison-shrink-'));
  let file = '';
  beforeAll(async () => {
    file = await writeStillsDeck(where, STILLS_SHRINK);
  });
  afterAll(() => {
    rmSync(where, { recursive: true, force: true });
  });

  it('saves each box’s shrink as PowerPoint does, and Drashti reads it, its sizes, line spacings and bullets', async () => {
    expect(file.endsWith('Placeholder PowerPoint shrink.pptx')).toBe(true);
    const read = await readPptxDeck(file);
    expect(read.slides).toHaveLength(STILLS_SHRINK.slides.length);
    expect(STILLS_SHRINK.slides.map((slide) => slide.marker)).toEqual(
      STILLS_SHRINK.slides.map((_, i) => 20 + 4 * i),
    );
    const parts = await readZipEntries(file, (name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
    const deck = await readEditablePptx(file, join(where, 'editable'));
    let shrunk = 0;
    for (const [index, slide] of STILLS_SHRINK.slides.entries()) {
      const xml = parts.get(`ppt/slides/slide${String(index + 1)}.xml`)?.toString('utf8') ?? '';
      const words = deck.slides[index]?.elements.find((e) => e.kind === 'text');
      expect(words, slide.name).toBeDefined();
      if (words?.kind !== 'text') continue;
      const fit = slide.fit;
      if (fit) {
        shrunk++;
        expect(xml, slide.name).toContain(
          `<a:normAutofit fontScale="${String(fit.fontScale)}"${fit.lnSpcReduction ? ` lnSpcReduction="${String(fit.lnSpcReduction)}"` : ''}/>`,
        );
        expect(words.style.sourceFit, slide.name).toEqual({
          fontScale: fit.fontScale / 100_000,
          lineSpacingReduction: (fit.lnSpcReduction ?? 0) / 100_000,
        });
      } else {
        expect(xml, slide.name).toContain('<a:noAutofit/>');
        expect(words.style.sourceFit, slide.name).toBeUndefined();
      }
      // The words' size and line spacing as written (the reader's slide pixels: 4/3 a point; 1.2 lines a 100% spacing).
      const sizes = new Set(
        (words.runs ?? []).filter((r) => r.text.trim() !== '').map((r) => thousandths(r.size ?? 0)),
      );
      expect([...sizes], slide.name).toEqual([thousandths(((slide.size ?? 4000) / 100) * (4 / 3))]);
      const spacing = slide.lineSpacing ?? 100;
      const heights = new Set((words.runs ?? []).map((r) => r.paragraph?.lineHeight ?? 1.2));
      expect(
        [...heights].map((h) => Math.round(h * 1000) / 1000),
        slide.name,
      ).toEqual([Math.round((spacing / 100) * 1.2 * 1000) / 1000]);
      if (slide.bullets)
        expect(
          (words.runs ?? []).some((r) => r.paragraph?.bullet === '•'),
          slide.name,
        ).toBe(true);
    }
    expect(shrunk).toBeGreaterThanOrEqual(6);
    // A Gujarati placeholder box among them.
    expect(
      STILLS_SHRINK.slides.some((slide) => slide.paragraphs?.some((p) => p.text.includes('નમૂના'))),
    ).toBe(true);
  });
});

/*
 * Run 5 (h-pptx3, 14 Nov night): what Drashti now assumes and nobody has seen PowerPoint draw. C17's percentage paragraph
 * spacing under a paragraph's own line spacing; PF-4b's shrink of a box whose words have two sizes (does PowerPoint round
 * each run's size?); and for X14, the HSL shades at an exact half, a cell banded by row and by column, and PowerPoint's
 * table style families beyond Medium Style 2 (named by their IDs alone, as decks that don't save a style's definition).
 */
describe('run 5’s stills', () => {
  const where = mkdtempSync(join(tmpdir(), 'drashti-comparison-run5-'));
  let words = '';
  let tables = '';
  beforeAll(async () => {
    words = await writeStillsDeck(where, STILLS_RUN5_WORDS);
    tables = await writeStillsDeck(where, STILLS_RUN5_TABLES);
  });
  afterAll(() => {
    rmSync(where, { recursive: true, force: true });
  });
  const xmlOf = async (file: string, index: number) =>
    (await readZipEntries(file, (name) => name === `ppt/slides/slide${String(index + 1)}.xml`))
      .get(`ppt/slides/slide${String(index + 1)}.xml`)
      ?.toString('utf8') ?? '';
  const at = (deck: typeof STILLS_RUN5_WORDS, name: string) => {
    const index = deck.slides.findIndex((slide) => slide.name === name);
    expect(index, name).toBeGreaterThanOrEqual(0);
    return index;
  };

  it('spaces paragraphs by a percentage under their own line spacing, each against a control with that spacing', async () => {
    expect(words.endsWith('Placeholder PowerPoint run5 words.pptx')).toBe(true);
    expect(STILLS_RUN5_WORDS.slides.map((s) => s.marker)).toEqual(
      STILLS_RUN5_WORDS.slides.map((_, i) => 20 + 4 * i),
    );
    const deck = await readEditablePptx(words, join(where, 'words'));
    for (const [name, control, spacing] of [
      [
        'Spacing · lines 150%, before 100%',
        'Spacing · lines 150%, none (control)',
        '<a:spcPct val="150000"/>',
      ],
      ['Spacing · lines 80%, before 100%', 'Spacing · lines 80%, none (control)', '<a:spcPct val="80000"/>'],
      [
        'Spacing · lines exactly 36 pt, before 50%',
        'Spacing · lines exactly 36 pt, none (control)',
        '<a:spcPts val="3600"/>',
      ],
    ] as const) {
      const index = at(STILLS_RUN5_WORDS, name);
      expect(STILLS_RUN5_WORDS.slides[index]?.control, name).toBe(control);
      at(STILLS_RUN5_WORDS, control);
      expect(await xmlOf(words, index), name).toContain(`<a:lnSpc>${spacing}</a:lnSpc>`);
      const box = deck.slides[index]?.elements.find((e) => e.kind === 'text');
      expect(
        box?.kind === 'text' ? box.runs?.some((r) => (r.paragraph?.spaceBefore ?? 0) > 0) : false,
        name,
      ).toBe(true);
    }
  });

  it('shrinks boxes whose words have two sizes, each against the same words unshrunk', async () => {
    const deck = await readEditablePptx(words, join(where, 'words-mixed'));
    for (const [name, control, sizes, scale] of [
      ['Mixed · 40 and 18 pt at 62.5%', 'Mixed · 40 and 18 pt unshrunk (control)', [40, 18], 0.625],
      ['Mixed · 36 and 24 pt at 70%', 'Mixed · 36 and 24 pt unshrunk (control)', [36, 24], 0.7],
      ['Mixed · 32 and 20 pt at 77.5%', 'Mixed · 32 and 20 pt unshrunk (control)', [32, 20], 0.775],
    ] as const) {
      const index = at(STILLS_RUN5_WORDS, name);
      expect(STILLS_RUN5_WORDS.slides[index]?.control, name).toBe(control);
      const box = deck.slides[index]?.elements.find((e) => e.kind === 'text');
      if (box?.kind !== 'text') throw new Error(name);
      expect(box.style.sourceFit?.fontScale, name).toBeCloseTo(scale, 10);
      const got = new Set(
        (box.runs ?? []).filter((r) => r.text.trim() !== '').map((r) => Math.round(((r.size ?? 0) * 3) / 4)),
      );
      expect(
        [...got].sort((a, b) => b - a),
        name,
      ).toEqual([...sizes]);
      const unshrunk = deck.slides[at(STILLS_RUN5_WORDS, control)]?.elements.find((e) => e.kind === 'text');
      expect(unshrunk?.kind === 'text' ? unshrunk.style.sourceFit : 'missing', name).toBeUndefined();
    }
  });

  it('draws HSL shades at an exact half, a table banded both ways, and table style families by their IDs', async () => {
    expect(tables.endsWith('Placeholder PowerPoint run5 tables.pptx')).toBe(true);
    const parts = await readZipEntries(tables, (name) => name === 'ppt/theme/theme1.xml');
    // Office's own colours, so that PowerPoint's well-known shades can be checked.
    const theme = parts.get('ppt/theme/theme1.xml')?.toString('utf8') ?? '';
    for (const accent of [
      '<a:accent1><a:srgbClr val="4472C4"/>',
      '<a:accent2><a:srgbClr val="ED7D31"/>',
      '<a:accent6><a:srgbClr val="70AD47"/>',
    ])
      expect(theme).toContain(accent);
    const halves = await xmlOf(tables, at(STILLS_RUN5_TABLES, 'Colours · halves'));
    expect(halves).toContain('<a:srgbClr val="FFFFFF"><a:lumMod val="50000"/></a:srgbClr>');
    expect(halves).toContain('<a:srgbClr val="000000"><a:lumOff val="50000"/></a:srgbClr>');
    const both = await xmlOf(
      tables,
      at(STILLS_RUN5_TABLES, 'Table · Medium Style 2 - Accent 1, rows and columns banded'),
    );
    expect(both).toContain('<a:tblPr firstRow="1" bandRow="1" bandCol="1">');
    const families = STILLS_RUN5_TABLES.slides.filter((s) => s.table?.style && !s.table.bandCol);
    expect(families.length).toBeGreaterThanOrEqual(18);
    for (const slide of families) {
      const xml = await xmlOf(tables, STILLS_RUN5_TABLES.slides.indexOf(slide));
      expect(xml, slide.name).toContain(`<a:tableStyleId>${slide.table?.style ?? ''}</a:tableStyleId>`);
    }
    const deck = await readEditablePptx(tables, join(where, 'tables'));
    expect(deck.slides).toHaveLength(STILLS_RUN5_TABLES.slides.length);
  });
});
