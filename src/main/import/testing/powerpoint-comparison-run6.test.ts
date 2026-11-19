import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { powerPointPlan } from '../deck/plan';
import { readEditablePptx } from '../deck/editable-pptx';
import { readPptxDeck } from '../pictures';
import { readZipEntries } from '../zip';
import { COMPARISON_RUN6_MOTION, writeComparisonDeck } from './powerpoint-comparison-deck';
import {
  POWERPOINT_TABLE_STYLES,
  RUN6_LINE_SIZES,
  RUN6_SPACINGS,
  STILLS_RUN6_LINES,
  STILLS_RUN6_NOTO,
  STILLS_RUN6_TABLES,
  type StillsDeck,
  writeStillsDeck,
} from './powerpoint-comparison-stills';

/*
 * Run 6 (h-run6, Session 59): what real PowerPoint is asked next (prompt 05): X16's table style families with every
 * part on and both bands (the cells where the bands meet), and every one of PowerPoint's 74 style IDs, so that its saved
 * copy writes each definition; X20's first lines (Arial, PowerPoint's own Calibri, Times New Roman and Verdana, and
 * Drashti's bundled Noto fonts embedded in their deck) at four sizes under every kind of line spacing; Wheel with each
 * spoke count and Random Bars both ways, as movies.
 */
const where = mkdtempSync(join(tmpdir(), 'drashti-comparison-run6-'));
afterAll(() => {
  rmSync(where, { recursive: true, force: true });
});
/** A new folder of `where` for one deck. */
const folder = (name: string) => {
  const dir = join(where, name);
  mkdirSync(dir);
  return dir;
};
const xmlOf = async (file: string, part: string) =>
  (await readZipEntries(file, (name) => name === part)).get(part)?.toString('utf8') ?? '';
const slideXml = (file: string, index: number) => xmlOf(file, `ppt/slides/slide${String(index + 1)}.xml`);
const markersOf = (deck: StillsDeck) => deck.slides.map((slide) => slide.marker);

describe('run 6’s tables (X16)', () => {
  it('names every one of PowerPoint’s 74 table style IDs, the two published typos corrected', () => {
    expect(POWERPOINT_TABLE_STYLES).toHaveLength(74);
    const ids = POWERPOINT_TABLE_STYLES.map((style) => style.id);
    expect(new Set(ids).size).toBe(74);
    for (const id of ids)
      expect(id).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/u);
    const named = (name: string) => POWERPOINT_TABLE_STYLES.find((style) => style.name === name)?.id;
    expect(named('Medium Style 2 - Accent 2')).toBe('{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}');
    expect(named('Light Style 1')).toBe('{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}');
    expect(named('Medium Style 2 - Accent 1')).toBe('{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}');
    expect(named('No Style, Table Grid')).toBe('{5940675A-B579-460E-94D1-54222C63F5DA}');
  });

  it('draws each of the 20 families with every part on, and banded both ways, and all 74 IDs in small tables', async () => {
    const file = await writeStillsDeck(folder('tables'), STILLS_RUN6_TABLES);
    expect(file.endsWith('Placeholder PowerPoint run6 tables.pptx')).toBe(true);
    expect(markersOf(STILLS_RUN6_TABLES)).toEqual(STILLS_RUN6_TABLES.slides.map((_, i) => 20 + 4 * i));
    expect(Math.max(...markersOf(STILLS_RUN6_TABLES))).toBeLessThanOrEqual(250);
    const read = await readPptxDeck(file);
    expect(read.slides).toHaveLength(STILLS_RUN6_TABLES.slides.length);
    for (const slide of powerPointPlan(read.slides).slides) expect(slide.groups).toEqual([]);
    // Every ID once among the small tables, with PowerPoint's flags for a new table.
    const small = STILLS_RUN6_TABLES.slides.flatMap((slide) => slide.tables ?? []);
    expect(small.map((table) => table.style).sort()).toEqual(POWERPOINT_TABLE_STYLES.map((s) => s.id).sort());
    for (const table of small) expect(table.flags).toEqual(['firstRow', 'bandRow']);
    // The 20 families: every part on (first and last row and column, both bands), and both bands alone.
    const every = STILLS_RUN6_TABLES.slides.filter((slide) => slide.name.endsWith(', every part on'));
    const banded = STILLS_RUN6_TABLES.slides.filter((slide) =>
      slide.name.endsWith(', rows and columns banded'),
    );
    expect(every).toHaveLength(20);
    expect(banded).toHaveLength(20);
    for (const slide of every) {
      const index = STILLS_RUN6_TABLES.slides.indexOf(slide);
      const xml = await slideXml(file, index);
      expect(xml, slide.name).toContain(
        '<a:tblPr firstRow="1" firstCol="1" lastRow="1" lastCol="1" bandRow="1" bandCol="1">',
      );
      expect(xml, slide.name).toContain(`<a:tableStyleId>${slide.table?.style ?? '?'}</a:tableStyleId>`);
      expect(slide.table, slide.name).toMatchObject({ rows: 6, columns: 5 });
    }
    for (const slide of banded) {
      const xml = await slideXml(file, STILLS_RUN6_TABLES.slides.indexOf(slide));
      expect(xml, slide.name).toContain('<a:tblPr bandRow="1" bandCol="1">');
    }
    // Office's own theme colours, as run 5's.
    const theme = await xmlOf(file, 'ppt/theme/theme1.xml');
    expect(theme).toContain('<a:accent6><a:srgbClr val="70AD47"/>');
    const deck = await readEditablePptx(file, join(where, 'tables-read'));
    expect(deck.slides).toHaveLength(STILLS_RUN6_TABLES.slides.length);
  });
});

describe('run 6’s first lines (X20)', () => {
  it('lays four boxes a slide, 18, 28, 40 and 66 pt, two lines each, under every kind of line spacing', async () => {
    expect(RUN6_LINE_SIZES).toEqual([18, 28, 40, 66]);
    expect(RUN6_SPACINGS.map((spacing) => spacing.label)).toEqual([
      'single',
      'lines 100%',
      'lines 80%',
      'lines 90%',
      'lines 120%',
      'lines 150%',
      'lines 200%',
      'exactly 1.0 x size',
      'exactly 1.2 x size',
      'exactly 1.5 x size',
      'shrunk 62.5%, 20% less',
      'shrunk 77.5%, 10% less',
      'shrunk 90%',
    ]);
    const file = await writeStillsDeck(folder('lines'), STILLS_RUN6_LINES);
    expect(file.endsWith('Placeholder PowerPoint run6 lines.pptx')).toBe(true);
    expect(markersOf(STILLS_RUN6_LINES)).toEqual(STILLS_RUN6_LINES.slides.map((_, i) => 20 + 4 * i));
    expect(Math.max(...markersOf(STILLS_RUN6_LINES))).toBeLessThanOrEqual(250);
    for (const font of ['Arial', 'Calibri', 'Times New Roman', 'Verdana'])
      expect(STILLS_RUN6_LINES.slides.filter((slide) => slide.name.startsWith(`${font} · `))).toHaveLength(
        13,
      );
    expect(STILLS_RUN6_LINES.slides.filter((slide) => slide.name.includes('anchored'))).toHaveLength(6);
    const deck = await readEditablePptx(file, join(where, 'lines-read'));
    for (const [index, slide] of STILLS_RUN6_LINES.slides.entries()) {
      expect(
        slide.boxes?.map((box) => box.size),
        slide.name,
      ).toEqual([1800, 2800, 4000, 6600]);
      const texts = deck.slides[index]?.elements.filter((e) => e.kind === 'text') ?? [];
      expect(texts, slide.name).toHaveLength(4);
    }
    const exact = STILLS_RUN6_LINES.slides.find((slide) => slide.name === 'Arial · exactly 1.5 x size');
    expect(exact?.boxes?.map((box) => box.lineSpacingPoints)).toEqual([2700, 4200, 6000, 9900]);
    const xml = await slideXml(
      file,
      STILLS_RUN6_LINES.slides.findIndex((s) => s.name === 'Arial · shrunk 62.5%, 20% less'),
    );
    expect(xml).toContain('<a:normAutofit fontScale="62500" lnSpcReduction="20000"/>');
    expect(xml).toContain('<a:latin typeface="Arial"/>');
  });

  it('embeds Drashti’s bundled Noto fonts in their own deck, so PowerPoint draws them without installing them', async () => {
    const file = await writeStillsDeck(folder('noto'), STILLS_RUN6_NOTO);
    expect(file.endsWith('Placeholder PowerPoint run6 noto.pptx')).toBe(true);
    for (const font of ['Noto Sans', 'Noto Sans Gujarati', 'Noto Sans Devanagari'])
      expect(STILLS_RUN6_NOTO.slides.filter((slide) => slide.name.startsWith(`${font} · `))).toHaveLength(13);
    const presentation = await xmlOf(file, 'ppt/presentation.xml');
    expect(presentation).toContain('embedTrueTypeFonts="1"');
    for (const font of ['Noto Sans', 'Noto Sans Gujarati', 'Noto Sans Devanagari'])
      expect(presentation).toContain(`<p:font typeface="${font}"`);
    const types = await xmlOf(file, '[Content_Types].xml');
    expect(types).toContain('<Default Extension="fntdata" ContentType="application/x-fontdata"/>');
    const fonts = await readZipEntries(file, (name) => /^ppt\/fonts\/font\d\.fntdata$/u.test(name));
    expect(fonts.size).toBe(3);
    for (const [name, data] of fonts) {
      // Embedded OpenType 2.1, uncompressed: its size, its font's size, the version and the magic number.
      expect(data.readUInt32LE(0), name).toBe(data.length);
      expect(data.readUInt32LE(8), name).toBe(0x0002_0001);
      expect(data.readUInt32LE(12), name).toBe(0);
      expect(data.readUInt16LE(34), name).toBe(0x504c);
      const font = data.subarray(data.length - data.readUInt32LE(4));
      expect(font.readUInt32BE(0), name).toBe(0x0001_0000);
    }
    const gujarati = STILLS_RUN6_NOTO.slides.find((slide) => slide.name === 'Noto Sans Gujarati · single');
    expect(gujarati?.boxes?.[0]?.paragraphs.map((p) => p.text)).toEqual(['નમૂના', 'નમૂના']);
  });
});

describe('run 6’s Wheel and Random Bars', () => {
  it('has Wheel with each spoke count and Random Bars both ways, coming in and leaving, at 700 ms and 2 s', async () => {
    const names = COMPARISON_RUN6_MOTION.slides.map((slide) => slide.name);
    for (const ms of [700, 2000])
      for (const phase of ['in', 'out'] as const) {
        for (const spokes of [1, 2, 3, 4, 8])
          expect(names).toContain(
            `Wheel ${phase} · ${String(spokes)} spoke${spokes === 1 ? '' : 's'} · ${String(ms)} ms`,
          );
        for (const way of ['horizontal', 'vertical'])
          expect(names).toContain(`Random Bars ${phase} · ${way} · ${String(ms)} ms`);
      }
    // Random Bars again, the same effect, to see whether PowerPoint's bars fall the same way each time.
    expect(names.filter((name) => name.startsWith('Random Bars in · horizontal · 2000 ms'))).toHaveLength(2);
    expect(names.filter((name) => name.startsWith('Random Bars in · vertical · 2000 ms'))).toHaveLength(2);
    expect(COMPARISON_RUN6_MOTION.box).toEqual({ x: 80, y: 42, width: 160, height: 96 });
    expect(COMPARISON_RUN6_MOTION.slides.map((slide) => slide.marker)).toEqual(
      COMPARISON_RUN6_MOTION.slides.map((_, i) => 20 + 4 * i),
    );
    const written = await writeComparisonDeck(folder('motion'), COMPARISON_RUN6_MOTION);
    expect(written.endsWith('Placeholder PowerPoint run6 motion.pptx')).toBe(true);
    const read = await readPptxDeck(written);
    const plan = powerPointPlan(read.slides);
    // First, the control of the bigger box: Shape's Circle Out coming in, exact since run 4.
    expect(names[0]).toBe('Shape in · Circle Out · control');
    expect(read.slides[0]?.deck?.motion?.effects).toEqual([
      expect.objectContaining({ kind: 'shape', shape: 'circle', phase: 'in', durationMs: 700 }),
    ]);
    for (const [index, slide] of COMPARISON_RUN6_MOTION.slides.entries()) {
      if (index === 0) continue;
      const ms = slide.name.includes('· 2000 ms') ? 2000 : 700;
      const wheel = /^Wheel (in|out) · (\d) spoke/u.exec(slide.name);
      const bars = /^Random Bars (in|out) · (horizontal|vertical)/u.exec(slide.name);
      expect(read.slides[index]?.deck?.motion?.effects, slide.name).toEqual([
        expect.objectContaining({
          durationMs: ms,
          phase: (wheel ?? bars)?.[1],
          ...(wheel ? { kind: 'wheel', spokes: Number(wheel[2]) } : { kind: 'bars', bars: bars?.[2] }),
        }),
      ]);
      expect(
        plan.slides[index]?.groups.map((group) => group.endMs - group.startMs),
        slide.name,
      ).toEqual([ms]);
      const xml = await slideXml(written, index);
      expect(xml, slide.name).toContain(
        wheel
          ? `presetID="21" presetClass="${wheel[1] === 'in' ? 'entr' : 'exit'}" presetSubtype="${wheel[2] ?? ''}"`
          : `presetID="14" presetClass="${bars?.[1] === 'in' ? 'entr' : 'exit'}" presetSubtype="${bars?.[2] === 'horizontal' ? '10' : '5'}"`,
      );
    }
  });
});
