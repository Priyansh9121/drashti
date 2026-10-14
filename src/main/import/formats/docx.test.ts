import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TextElement } from '../../../shared/model';
import { slideElementSchema } from '../../../shared/model-schema';
import type { TestDocxBlock } from '../testing/make-docx';
import { makeOldWordDoc, makeProtectedDocx, makeTestDocx } from '../testing/make-docx';
import { makeZip } from '../testing/zip-writer';
import { readDocx } from './docx';
import { parseLyricsText } from './text';

/*
 * Word (.docx) lyrics (Session 26f): read as a .txt lyrics file is, each paragraph a line and an empty
 * one starting a new slide, by text.ts's own rules; Gujarati, Hindi and English as written; a legacy
 * font's runs kept as other importers keep them; formatting, pictures and tables left out and said so.
 * Placeholder words only.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-docx-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, bytes: Buffer) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

async function read(blocks: TestDocxBlock[], options?: Parameters<typeof makeTestDocx>[1]) {
  const path = write('Placeholder Song.docx', makeTestDocx(blocks, options));
  const result = await readDocx(path, path);
  if (!result.ok) throw new Error(result.message);
  return result.parsed;
}

const texts = (p: { groups: { name: string; slides: { elements: unknown[] }[] }[] }) =>
  p.groups.map((g) => [g.name, g.slides.map((s) => (s.elements[0] as TextElement).text)]);
const element = (p: Awaited<ReturnType<typeof read>>, group = 0, slide = 0) =>
  p.groups[group]?.slides[slide]?.elements[0] as TextElement;

describe('Word lyrics', () => {
  const LINES = [
    '[Verse 1]',
    'Placeholder line one',
    'નમૂના પંક્તિ',
    '',
    'नमूना पंक्ति',
    'Placeholder line four',
    '',
    '',
    '[Chorus]',
    'Placeholder chorus',
    '[Verse 1]',
  ];

  it('are read as a lyrics text file is: a paragraph a line, an empty one a new slide, [headers] start groups', async () => {
    const p = await read(LINES);
    expect(p.name).toBe('Placeholder Song');
    expect(texts(p)).toEqual([
      ['Verse 1', ['Placeholder line one\nનમૂના પંક્તિ', 'नमूना पंक्ति\nPlaceholder line four']],
      ['Chorus', ['Placeholder chorus']],
    ]);
    // The same presentation, slide for slide and run for run, as the same words in a .txt file.
    const txt = parseLyricsText(Buffer.from(LINES.join('\n')), 'Placeholder Song.txt');
    expect(p.groups).toEqual(txt.groups);
    expect(p.arrangements).toEqual(txt.arrangements);
    expect(p.selectedArrangement).toBe(0);
    // Gujarati, Hindi and English stay as written, each line in its own language.
    expect(element(p).runs?.map((r) => [r.text, r.lang])).toEqual([
      ['Placeholder line one\n', 'en'],
      ['નમૂના પંક્તિ', 'gu'],
    ]);
    expect(element(p, 0, 1).runs?.map((r) => r.lang)).toEqual(['hi', 'en']);
    for (const g of p.groups)
      for (const s of g.slides) expect(slideElementSchema.safeParse(s.elements[0]).success).toBe(true);
    expect(p.issues).toEqual([]);
  });

  it('take a line break as a line and a page break as a new slide; words over several runs join; hidden and deleted words are left out', async () => {
    const p = await read([
      {
        runs: [
          { text: 'Placeholder ' },
          { text: 'split', bold: false },
          { text: ' line', then: 'line' },
          { text: 'Placeholder second line', then: 'page' },
          { text: 'Placeholder after the page' },
          { text: ' (a hidden note)', hidden: true },
          { text: ' struck out', deleted: true },
        ],
      },
      '  Placeholder\tspaced  ',
    ]);
    expect(texts(p)).toEqual([
      [
        '',
        ['Placeholder split line\nPlaceholder second line', 'Placeholder after the page\nPlaceholder spaced'],
      ],
    ]);
    expect(p.issues.map((i) => i.code)).toEqual(['hidden-left-out']);
  });

  it('keep a run in a legacy font as typed, in its font, and say so as other files do', async () => {
    const p = await read(
      [
        { runs: [{ text: 'Placeholder legacy codes', font: 'Terafont-Varun' }] },
        { runs: [{ text: 'Placeholder English line', font: 'Calibri' }] },
        '',
        { runs: [{ text: 'Placeholder styled codes' }], style: 'Lyrics' },
        '',
        { runs: [{ text: 'Placeholder in the default font' }] },
      ],
      { styles: [{ id: 'Lyrics', font: 'LMG-Arun' }], defaultFont: 'Arial' },
    );
    expect(element(p).runs).toEqual([
      { text: 'Placeholder legacy codes\n', font: 'Terafont-Varun', legacy: true, lang: null },
      // Any other font is formatting: the slide takes its theme's.
      { text: 'Placeholder English line', lang: 'en' },
    ]);
    // A paragraph style's legacy font counts as the run's.
    expect(element(p, 0, 1).runs).toEqual([
      { text: 'Placeholder styled codes', font: 'LMG-Arun', legacy: true, lang: null },
    ]);
    expect(element(p, 0, 2).runs).toBeUndefined();
    expect(p.issues.filter((i) => i.code === 'legacy-font').map((i) => i.message)).toEqual([
      'Text in the legacy Gujarati font “Terafont-Varun” (one text box) is kept as typed: it shows correctly only where that font is installed, and cannot be searched or transliterated until it is converted.',
      'Text in the legacy Gujarati font “LMG-Arun” (one text box) is kept as typed: it shows correctly only where that font is installed, and cannot be searched or transliterated until it is converted.',
    ]);
  });

  it('leave out formatting, pictures and tables, and say so in the report', async () => {
    const p = await read([
      { runs: [{ text: 'Placeholder bold words', bold: true }], centred: true },
      { table: [['Placeholder cell one', 'Placeholder cell two']] },
      { table: [['Placeholder cell three']] },
      { picture: 'Placeholder caption' },
    ]);
    expect(texts(p)).toEqual([['', ['Placeholder bold words\nPlaceholder caption']]]);
    expect(p.issues.map((i) => [i.severity, i.code, i.message])).toEqual([
      [
        'info',
        'formatting-left-out',
        'Its formatting (bold, colours, sizes, alignment) was left out: the slides take their theme’s look.',
      ],
      ['warning', 'pictures-left-out', 'A picture was left out.'],
      ['warning', 'tables-left-out', '2 tables were left out, and the words in them.'],
    ]);
  });

  it('say plainly what is wrong with a damaged, protected or old Word file', async () => {
    const outcome = async (name: string, bytes: Buffer) => {
      const r = await readDocx(write(name, bytes), name);
      return r.ok ? null : [r.code, r.message];
    };
    expect(await outcome('Placeholder damaged.docx', Buffer.from('not a zip'))).toEqual([
      'damaged',
      'This Word file could not be read: it may be damaged. If it opens in Word, save it again there and import that.',
    ]);
    const whole = makeTestDocx(['Placeholder line']);
    expect((await outcome('Placeholder cut short.docx', whole.subarray(0, whole.length - 40)))?.[0]).toBe(
      'damaged',
    );
    const badXml = makeZip([{ name: 'word/document.xml', data: '<w:document><w:body><w:p>' }]);
    expect((await outcome('Placeholder bad words.docx', badXml))?.[0]).toBe('damaged');
    expect(await outcome('Placeholder not Word.docx', makeZip([{ name: 'notes.txt', data: 'x' }]))).toEqual([
      'not-word',
      'This is not a Word document: it holds no document. If it opens in Word, save it again there and import that.',
    ]);
    expect(await outcome('Placeholder protected.docx', makeProtectedDocx())).toEqual([
      'protected',
      'This Word file is protected with a password. Open it in Word, take the password off (File › Info › Protect Document), save it, and import it again.',
    ]);
    expect(await outcome('Placeholder old.docx', makeOldWordDoc())).toEqual([
      'old-word',
      'This is an old Word document (.doc) with a .docx name. Open it in Word and save it as a Word Document (.docx), then import that.',
    ]);
    // No words at all: as an empty text file, nothing to make slides from.
    const empty = await readDocx(
      write('Placeholder empty.docx', makeTestDocx(['', ''])),
      'Placeholder empty.docx',
    );
    expect(empty.ok && empty.parsed.issues.map((i) => i.code)).toEqual(['no-slides']);
  });
});
