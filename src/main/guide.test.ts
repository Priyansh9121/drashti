import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDES } from '../shared/guides';
import { KEYMAP } from '../shared/keymap';
import { type Block, type Inline, inlineText, parseMarkdown } from '../shared/markdown';

/*
 * The guides' keys and Drashti's (Session 15; both ways since Sessions 31–36, DOC-3): the volunteers' key
 * card (docs/parallel-run.md) and the operator's guide name every key in KEYMAP, and every key they name in
 * bold is one of KEYMAP's, or another program's or part's own, each named below with why. Read with
 * Drashti's own Markdown reader, so a key is what the guide shows in bold.
 */

const docs = join(__dirname, '..', '..', 'docs');
const read = (file: string) => readFileSync(join(docs, file), 'utf8');

const NAMES: Record<string, string> = {
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageDown: 'Page Down',
  PageUp: 'Page Up',
  Escape: 'Esc',
};

/** A KEYMAP key as the guides write it ("Mod+Shift+S" is "Cmd+Shift+S"). */
const written = (key: string) =>
  key
    .split('+')
    .map((part) => (part === 'Mod' ? 'Cmd' : (NAMES[part] ?? part)))
    .join('+');

/** What a bold span says when it is a key: modifiers, then one key. */
const KEY =
  /^(?:(?:Cmd|Ctrl|Shift|Alt|Fn|Option)\+)*(?:F\d{1,2}|Space|Esc|Enter|Tab|Delete|Backspace|Page (?:Up|Down)|[←→↑↓]|[A-Z]|[.?])$/u;

/** A key as KEYMAP would hold it in the guides' spelling: Windows' Ctrl is the Mac's Cmd. */
const asMac = (key: string) => key.replace(/^Ctrl\+/u, 'Cmd+');

/**
 * Keys the guides name that are not Drashti's to bind, each with why: they stay true whatever KEYMAP
 * holds, and anything else a guide names in bold must be in KEYMAP.
 */
const NOT_KEYMAP: Record<string, string> = {
  'Shift+F10': 'a list’s menu, as a right-click: the list’s own key (and the system’s)',
  'Fn+Shift+F10': 'Shift+F10 on a Mac laptop',
  Tab: 'moving through the window: the browser’s own key',
  'Shift+Tab': 'moving back through the window: the browser’s own key',
  'Cmd+Enter': 'saving words: the words editor’s own key, while it has the keyboard',
  'Cmd+Q': 'quitting: the Mac’s own key',
};

/** Every bold span's words in some blocks. */
function bold(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  const inline = (list: readonly Inline[]) => {
    for (const n of list)
      if (n.kind === 'strong') {
        out.push(inlineText(n.children));
        inline(n.children);
      }
  };
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.kind === 'heading' || b.kind === 'paragraph') inline(b.children);
      else if (b.kind === 'list') for (const item of b.items) walk(item.blocks);
      else if (b.kind === 'table') {
        for (const c of b.head) inline(c);
        for (const row of b.rows) for (const c of row.cells) inline(c);
      }
    }
  };
  walk(blocks);
  return out;
}

/** The keys a guide names in bold, as KEYMAP would spell them. */
const keysIn = (blocks: readonly Block[]) => [
  ...new Set(
    bold(blocks)
      .filter((w) => KEY.test(w))
      .map(asMac),
  ),
];

/** The volunteers' key card: the first column of its table of keys (the slide editor's table is apart). */
function cardKeys(): string[] {
  const guide = read('parallel-run.md');
  const card = guide.slice(guide.indexOf('## Keys at a glance'), guide.indexOf('In the slide editor:'));
  const table = parseMarkdown(card).find((b) => b.kind === 'table');
  return table?.kind === 'table'
    ? keysIn(table.rows.map((r) => ({ kind: 'paragraph', children: r.cells[0] ?? [], pid: 0, line: 0 })))
    : [];
}

const bindings = KEYMAP.map((b) => ({ action: b.action, keys: b.keys.map(written) }));
const all = new Set(bindings.flatMap((b) => b.keys));

describe('the guides’ keys and Drashti’s, both ways', () => {
  it('the key card lists every key in the keymap', () => {
    const card = new Set(cardKeys());
    expect([...all].filter((k) => !card.has(k))).toEqual([]);
  });

  it('every key on the key card is in the keymap, or named as another’s', () => {
    expect(cardKeys().filter((k) => !all.has(k) && !(k in NOT_KEYMAP))).toEqual([]);
  });

  it('the operator’s guide names a key for every action in the keymap', () => {
    const guide = new Set(keysIn(parseMarkdown(read('operator-guide.md'))));
    expect(
      bindings
        .filter((b) => !b.keys.some((k) => guide.has(k)))
        .map((b) => `${b.action} (${b.keys.join(', ')})`),
    ).toEqual([]);
  });

  it('every key the operator’s guide names is in the keymap, or named as another’s', () => {
    const guide = keysIn(parseMarkdown(read('operator-guide.md')));
    expect(guide.filter((k) => !all.has(k) && !(k in NOT_KEYMAP))).toEqual([]);
  });

  it('every key named as another’s is named in a guide (the list never keeps a key no guide has)', () => {
    const named = new Set([...cardKeys(), ...keysIn(parseMarkdown(read('operator-guide.md')))]);
    expect(Object.keys(NOT_KEYMAP).filter((k) => !named.has(k))).toEqual([]);
  });
});

describe('the README', () => {
  it('links every guide: the four inside Drashti, the parallel run’s and the Windows checks', () => {
    const readme = readFileSync(join(docs, '..', 'README.md'), 'utf8');
    const guides = [...GUIDES.map((g) => g.file), 'parallel-run.md', 'windows-checks.md'];
    expect(guides.filter((file) => !readme.includes(`](docs/${file})`))).toEqual([]);
  });
});
