import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { slideElementSchema } from '../../../shared/model-schema';
import { editablePptxFixture, slideXml, wordsShape } from '../testing/editable-pptx-fixture';
import { readEditablePptx } from './editable-pptx';

const paragraph = (properties: string) =>
  '<a:p><a:pPr>' + properties + '</a:pPr><a:r><a:t>Placeholder words</a:t></a:r></a:p>';
const font = (name: string) => '<a:buFont typeface="' + name + '"/>';
const bullet = (character: string) => '<a:buChar char="' + character + '"/>';

async function readBullets(words: string) {
  const work = mkdtempSync(join(tmpdir(), 'drashti-pptx-bullets-'));
  try {
    const file = join(work, 'Placeholder bullets.pptx');
    writeFileSync(file, editablePptxFixture({ slides: [slideXml(words)] }));
    const deck = await readEditablePptx(file, join(work, 'prepared'));
    const slide = deck.slides[0];
    const text = slideElementSchema.parse(slide?.elements.find((element) => element.kind === 'text'));
    if (!slide || text.kind !== 'text' || !text.runs) throw new Error('The editable words are missing.');
    return { runs: text.runs.filter((run) => run.text !== '\n'), issues: slide.issues };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('PowerPoint bullet fonts', () => {
  it('maps common symbol-font bullets from both legacy character forms', async () => {
    const marks = [
      ['Wingdings', '§', '▪'],
      ['Wingdings', '&#xF0A7;', '▪'],
      ['Wingdings', 'Ø', '➢'],
      ['Wingdings', 'ü', '✓'],
      ['Wingdings', 'n', '■'],
      ['Wingdings', 'l', '●'],
      ['Wingdings', 'q', '❑'],
      ['Wingdings', 'v', '❖'],
      ['Wingdings', 'è', '➔'],
      ['Wingdings 2', 'P', '✓'],
      ['Wingdings 3', 'q', '▼'],
      ['Webdings', 'a', '✔'],
      ['Symbol', '&#xF0B7;', '•'],
      ['Symbol', '•', '•'],
    ] as const;
    const { runs, issues } = await readBullets(
      wordsShape(marks.map(([name, code]) => paragraph(font(name) + bullet(code))).join('')),
    );

    expect(runs.map((run) => run.paragraph?.bullet)).toEqual(marks.map(([, , glyph]) => glyph));
    expect(runs.every((run) => run.list === 'disc')).toBe(true);
    for (const run of runs) expect(run.paragraph).not.toHaveProperty('bulletFont');
    expect(issues).toEqual([]);
  });

  it('draws an unmapped symbol as a disc and describes it once', async () => {
    const unknown = paragraph(font('Wingdings') + bullet('&#xF0FF;'));
    const { runs, issues } = await readBullets(wordsShape(unknown + unknown));

    for (const run of runs) {
      expect(run.list).toBe('disc');
      expect(run.paragraph).not.toHaveProperty('bullet');
    }
    expect(issues.filter((issue) => /symbol bullet.*dot/iu.test(issue))).toHaveLength(1);
  });

  it('keeps an ordinary marker font separate from the words and honors follow-text overrides', async () => {
    const explicit = paragraph(font('Placeholder Marker') + bullet('◇'));
    const inherited = paragraph(bullet('n'));
    const followText = paragraph('<a:buFontTx/>' + bullet('n'));
    const words = wordsShape(explicit + inherited + followText).replace(
      '<a:lstStyle/>',
      '<a:lstStyle><a:lvl1pPr>' + font('Wingdings') + '</a:lvl1pPr></a:lstStyle>',
    );
    const { runs } = await readBullets(words);

    expect(runs).toMatchObject([
      { font: 'Placeholder Sans', paragraph: { bullet: '◇', bulletFont: 'Placeholder Marker' } },
      { paragraph: { bullet: '■' } },
      { paragraph: { bullet: 'n' } },
    ]);
    expect(runs[2]?.paragraph).not.toHaveProperty('bulletFont');
  });
});
