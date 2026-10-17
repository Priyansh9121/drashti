import { describe, expect, it } from 'vitest';
import { type Block, imagesOf, inlineText, parseInline, parseMarkdown, passagesOf } from './markdown';

/*
 * Drashti's own small Markdown reader (the guides inside Drashti): what the four guides use, read into a
 * tree the window draws as elements, never as HTML.
 */

describe('reading a line', () => {
  it('reads bold, code (bold around code too), pictures, and leaves everything else as text', () => {
    expect(parseInline('Press **Next** or `Space`.')).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'Next' }] },
      { kind: 'text', text: ' or ' },
      { kind: 'code', text: 'Space' },
      { kind: 'text', text: '.' },
    ]);
    expect(parseInline('**`.local`** names')).toEqual([
      { kind: 'strong', children: [{ kind: 'code', text: '.local' }] },
      { kind: 'text', text: ' names' },
    ]);
    expect(parseInline('![Midnight](screenshots/theme-midnight.png) Midnight')).toEqual([
      { kind: 'image', alt: 'Midnight', src: 'screenshots/theme-midnight.png' },
      { kind: 'text', text: ' Midnight' },
    ]);
    // Never HTML, never a link: an address, a <name> and a lone star are words.
    expect(parseInline('named "<name> (4m 00s).mp4" at https://example.org/x, 2 * 3')).toEqual([
      { kind: 'text', text: 'named "<name> (4m 00s).mp4" at https://example.org/x, 2 * 3' },
    ]);
    // A ** or ` with no end is a character.
    expect(inlineText(parseInline('a ** b ` c'))).toBe('a ** b ` c');
  });
});

describe('reading a guide', () => {
  it('reads headings, paragraphs, rules, tables, and lists with task boxes, nesting and pictures inside', () => {
    const blocks = parseMarkdown(
      [
        '# The guide',
        '',
        'Intro **one**',
        'goes on.',
        '',
        '---',
        '',
        '## 1. First',
        '',
        '| Key | What |',
        '| --- | ---- |',
        '| **B** | Black-out |',
        '| **L** | Logo |',
        '',
        '1. One',
        '2. Two:',
        '   - nested a',
        '   - nested b',
        '',
        '   More of two.',
        '',
        '   ![A picture](screenshots/x.png)',
        '',
        '3. Three',
        '',
        '- [ ] Check this',
        '- [x] Done that',
      ].join('\n'),
    );
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toEqual(['heading', 'paragraph', 'rule', 'heading', 'table', 'list', 'list']);
    const para = blocks[1] as Extract<Block, { kind: 'paragraph' }>;
    expect(inlineText(para.children)).toBe('Intro one goes on.');
    const table = blocks[4] as Extract<Block, { kind: 'table' }>;
    expect(table.head.map(inlineText)).toEqual(['Key', 'What']);
    expect(table.rows.map((r) => r.cells.map(inlineText))).toEqual([
      ['B', 'Black-out'],
      ['L', 'Logo'],
    ]);
    const numbered = blocks[5] as Extract<Block, { kind: 'list' }>;
    expect(numbered.ordered).toBe(true);
    expect(numbered.items).toHaveLength(3);
    const two = numbered.items[1];
    expect(two?.blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'paragraph', 'paragraph']);
    const tasks = blocks[6] as Extract<Block, { kind: 'list' }>;
    expect(tasks.items.map((i) => i.task)).toEqual(['open', 'done']);
    expect(imagesOf(blocks)).toEqual(['screenshots/x.png']);
  });

  it('numbers each passage once, in order: headings, paragraphs, list items and table rows', () => {
    const passages = passagesOf(
      parseMarkdown('# T\n\nA para.\n\n## S\n\n- one\n- two\n\n| a | b |\n| - | - |\n| c | d |'),
    );
    expect(passages.map((p) => [p.id, p.section, p.text])).toEqual([
      [0, 'T', 'T'],
      [1, 'T', 'A para.'],
      [2, 'S', 'S'],
      [3, 'S', 'one'],
      [4, 'S', 'two'],
      [5, 'S', 'c · d'],
    ]);
  });
});
