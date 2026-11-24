import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../shared/model';
import { openDatabase } from './db/database';
import { PresentationRepo, type NewPresentation } from './db/presentations';
import { LYRICS_STYLE } from './import/formats/text';
import { wordsFooter, wordsHtml, wordsPdfName, wordsSheet } from './words-print';

/*
 * A singers' sheet (alpha.22): a presentation's words by group, in its language tracks, with the kirtan's kavi and
 * raag. Placeholder words only: never real kirtan text.
 */

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

const box = (id: string, runs: TextRun[], y = 200): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 100, y, width: 1720, height: 500 },
  text: runs.map((r) => r.text).join(''),
  lang: runs[0]?.lang ?? null,
  style: LYRICS_STYLE,
  runs,
});

/** The content rows of a presentation made from these groups (and kirtan details, when it is one). */
function rowsOf(p: Pick<NewPresentation, 'groups'> & { name?: string; kirtan?: NewPresentation['kirtan'] }) {
  const db = openDatabase(':memory:');
  const repo = new PresentationRepo(db);
  const libraryId = repo.ensureLibrary('Kirtans');
  const id = repo.insert({ libraryId, name: p.name ?? 'Placeholder Kirtan', ...p });
  return must(repo.content(id));
}

/** A two-track kirtan: Gujarati placeholder words with their Roman reading under each line. */
function gujaratiKirtan() {
  return rowsOf({
    groups: [
      {
        name: 'Verse',
        slides: [
          {
            elements: [
              box('a', [
                { text: 'પહેલી પંક્તિ\n', lang: 'gu' },
                { text: 'Paheli pankti', lang: 'translit' },
              ]),
            ],
          },
          {
            elements: [
              box('b', [
                { text: 'બીજી પંક્તિ\n', lang: 'gu' },
                { text: 'Biji pankti', lang: 'translit' },
              ]),
            ],
          },
          // A hidden slide is not sung: not on the sheet.
          { elements: [box('h', [{ text: 'છુપી પંક્તિ', lang: 'gu' }])], enabled: false },
        ],
      },
      {
        name: 'Chorus',
        slides: [
          {
            elements: [
              box('c', [
                { text: 'ટેક\n', lang: 'gu' },
                { text: 'Tek', lang: 'translit' },
              ]),
            ],
          },
        ],
      },
    ],
    kirtan: { category: 'Kirtan', kavi: 'Placeholder Kavi', raag: 'Placeholder Raag' },
  });
}

/** The text of the page between two marks, for checking what is in a part of it. */
function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from);
  const end = html.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`no ${from} … ${to}`);
  return html.slice(start, end);
}

describe('a singers’ sheet of a kirtan’s words', () => {
  it('has one heading per group and each slide’s lines in the kirtan’s track order, with kavi and raag under the title', () => {
    const sheet = must(wordsSheet('Placeholder Kirtan', gujaratiKirtan()));
    expect(sheet.langs).toEqual(['gu', 'translit']);
    const html = wordsHtml(sheet);
    expect(html.match(/<h2>/gu)).toHaveLength(2);
    expect(html).toContain('<h2>Verse</h2>');
    expect(html).toContain('<h2>Chorus</h2>');
    expect(html.indexOf('<h2>Verse</h2>')).toBeLessThan(html.indexOf('<h2>Chorus</h2>'));
    expect(html).toContain('<h1>Placeholder Kirtan</h1>');
    expect(between(html, '<h1>', '<h2>')).toContain('Kavi: Placeholder Kavi');
    expect(between(html, '<h1>', '<h2>')).toContain('Raag: Placeholder Raag');
    // Both lines of a slide, Gujarati first and its Roman reading after it, slide by slide.
    const verse = between(html, '<h2>Verse</h2>', '<h2>Chorus</h2>');
    const order = ['પહેલી પંક્તિ', 'Paheli pankti', 'બીજી પંક્તિ', 'Biji pankti'].map((t) => verse.indexOf(t));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(verse).toContain('lang="gu"');
    // The Roman reading says what it reads: Gujarati in Latin letters.
    expect(verse).toContain('lang="gu-Latn"');
    expect(html.slice(html.indexOf('<h2>Chorus</h2>'))).toContain('ટેક');
    // The hidden slide is not sung, so it is not on the sheet.
    expect(html).not.toContain('છુપી પંક્તિ');
  });

  it('keeps the kirtan’s own order of its tracks (Hindi placeholder words, the meaning above them here)', () => {
    const rows = rowsOf({
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              elements: [
                box('m', [{ text: 'Placeholder meaning', lang: 'en' }], 100),
                box('w', [{ text: 'पहली पंक्ति', lang: 'hi' }], 600),
              ],
            },
            {
              elements: [
                box('m2', [{ text: 'Second placeholder meaning', lang: 'en' }], 100),
                box('w2', [{ text: 'दूसरी पंक्ति', lang: 'hi' }], 600),
              ],
            },
          ],
        },
      ],
      kirtan: { kavi: 'Placeholder Kavi' },
    });
    const sheet = must(wordsSheet('Placeholder Hindi Kirtan', rows));
    expect(sheet.langs).toEqual(['en', 'hi']);
    const html = wordsHtml(sheet);
    expect(html.indexOf('Placeholder meaning')).toBeLessThan(html.indexOf('पहली पंक्ति'));
    expect(html.indexOf('पहली पंक्ति')).toBeLessThan(html.indexOf('Second placeholder meaning'));
    expect(html).toContain('lang="hi"');
    expect(html).toContain('Kavi: Placeholder Kavi');
    // No raag given: none said.
    expect(html).not.toContain('Raag');
  });

  it('shows a presentation that is no kirtan by its words alone, and leaves out slides and groups with none', () => {
    const rows = rowsOf({
      name: 'Placeholder Announcements',
      groups: [
        {
          name: 'Welcome',
          slides: [{ elements: [box('a', [{ text: 'Placeholder welcome', lang: 'en' }])] }, { elements: [] }],
        },
        { name: 'Pictures', slides: [{ elements: [] }] },
      ],
    });
    const sheet = must(wordsSheet('Placeholder Announcements', rows));
    const html = wordsHtml(sheet);
    expect(html).toContain('Placeholder welcome');
    expect(html).toContain('<h2>Welcome</h2>');
    expect(html).not.toContain('Pictures');
    expect(html).not.toContain('Kavi');
    expect(html.match(/class="verse"/gu)).toHaveLength(1);
  });

  it('is nothing to print when no slide has words', () => {
    const rows = rowsOf({ groups: [{ name: 'Pictures', slides: [{ elements: [] }] }] });
    expect(wordsSheet('Placeholder Pictures', rows)).toBeNull();
  });

  it('says plainly when some words are in an old font (they are not on the sheet)', () => {
    const rows = rowsOf({
      groups: [
        {
          name: 'Verse',
          slides: [
            { elements: [box('a', [{ text: 'Placeholder line', lang: 'en' }])] },
            { elements: [box('l', [{ text: 'Placeholder old font', font: 'Placeholder Gopika', legacy: true }])] },
          ],
        },
      ],
    });
    const sheet = must(wordsSheet('Placeholder Old', rows));
    expect(sheet.legacy).toBe(1);
    const html = wordsHtml(sheet);
    expect(html).toContain('1 slide has words in an old font: they are not on this sheet.');
    expect(html).not.toContain('Placeholder old font');
  });

  it('writes every name, heading, line and detail as text, never as markup', () => {
    const rows = rowsOf({
      groups: [
        {
          name: 'Verse <b>&',
          slides: [{ elements: [box('a', [{ text: '<script>alert(1)</script> & "quoted"', lang: 'en' }])] }],
        },
      ],
      kirtan: { kavi: 'Kavi <i>', raag: "Raag 'x' &" },
    });
    const html = wordsHtml(must(wordsSheet('Name <img src=x onerror=alert(1)>', rows)));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('Name &lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<h2>Verse &lt;b&gt;&amp;</h2>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;');
    expect(html).toContain('Kavi: Kavi &lt;i&gt;');
    expect(html).toContain('Raag: Raag &#39;x&#39; &amp;');
    // The page holds no script and loads nothing.
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script|<[^>]*\s(?:src|href)=/iu);
  });

  it('puts the name in every page’s footer as text, and suggests a file name the system takes', () => {
    const footer = wordsFooter('Placeholder <Kirtan> & co');
    expect(footer).toContain('Placeholder &lt;Kirtan&gt; &amp; co');
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
    expect(wordsPdfName('Placeholder Kirtan')).toBe('Placeholder Kirtan words.pdf');
    expect(wordsPdfName('Placeholder: a/b\\c*?"<>|')).toBe('Placeholder_ a_b_c______ words.pdf');
    expect(wordsPdfName('પહેલી')).toBe('પહેલી words.pdf');
  });
});
