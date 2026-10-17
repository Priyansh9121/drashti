/*
 * Drashti's own small Markdown reader (Phase B of Sessions 31–36: the guides inside Drashti). It reads what
 * the four guides use (docs/*.md: headings, paragraphs, **bold** and `code`, lists, numbered or with task
 * boxes, nested and with indented pictures and paragraphs, pipe tables, pictures and rules) into a tree,
 * which the window draws as React elements. No HTML is ever made from a guide, so nothing in one can run,
 * load or open anything: a "<name>" is words, and an address is words, never a link.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'image'; alt: string; src: string };

/** A passage: a heading, a paragraph, a list's item or a table's row, numbered in the guide's order (`pid`). */
export interface ListItem {
  /** A checklist's box: 'open' to tick, 'done' ticked; null for a plain item. */
  task: 'open' | 'done' | null;
  blocks: Block[];
  pid: number;
  line: number;
}

export interface TableRow {
  cells: Inline[][];
  pid: number;
  line: number;
}

export type Block =
  | { kind: 'heading'; level: number; children: Inline[]; pid: number; line: number }
  | { kind: 'paragraph'; children: Inline[]; pid: number; line: number }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[]; line: number }
  | { kind: 'table'; head: Inline[][]; rows: TableRow[]; line: number }
  | { kind: 'rule'; line: number };

interface Line {
  text: string;
  line: number;
}

// ---- a line's words ---------------------------------------------------------------------------------

/** Where the ** that closes one opened just before `from` is (code inside it skipped), or -1. */
function closingStrong(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (text.startsWith('**', i)) return i;
  }
  return -1;
}

const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)/u;

/** A line's words: bold, code and pictures; everything else, stars and angle brackets included, is text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let words = '';
  const flush = () => {
    if (words !== '') out.push({ kind: 'text', text: words });
    words = '';
  };
  for (let i = 0; i < text.length;) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ kind: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('![', i)) {
      const m = IMAGE.exec(text.slice(i));
      if (m) {
        flush();
        out.push({ kind: 'image', alt: m[1] ?? '', src: m[2] ?? '' });
        i += m[0].length;
        continue;
      }
    }
    if (text.startsWith('**', i)) {
      const end = closingStrong(text, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: 'strong', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    words += text.charAt(i);
    i++;
  }
  flush();
  return out;
}

/** The words of a line as plain text (a picture by its description). */
export function inlineText(inlines: readonly Inline[]): string {
  return inlines
    .map((n) => (n.kind === 'strong' ? inlineText(n.children) : n.kind === 'image' ? n.alt : n.text))
    .join('');
}

// ---- blocks -----------------------------------------------------------------------------------------

const indentOf = (text: string) => text.length - text.trimStart().length;
const blank = (text: string) => text.trim() === '';
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/u;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/u;
const TABLE_ROW = /^\s*\|/u;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/u;

interface Marker {
  indent: number;
  ordered: boolean;
  number: number;
  /** Where the item's words start: lines indented this far belong to it. */
  content: number;
  rest: string;
}

function listMarker(text: string): Marker | null {
  const m = /^( *)([-*+]|(\d{1,9})[.)])( +)(.*)$/u.exec(text);
  if (!m) return null;
  const indent = (m[1] ?? '').length;
  const marker = (m[2] ?? '').length;
  const spaces = (m[4] ?? '').length;
  return {
    indent,
    ordered: m[3] !== undefined,
    number: m[3] !== undefined ? Number(m[3]) : 1,
    content: indent + marker + (spaces > 4 ? 1 : spaces),
    rest: m[5] ?? '',
  };
}

/** A table's cells, without the outer pipes. */
function cells(text: string): string[] {
  const t = text.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return t.split('|').map((c) => c.trim());
}

/** Whether this line starts a block of its own (so it ends a paragraph above it). */
function startsBlock(lines: readonly Line[], i: number): boolean {
  const text = lines[i]?.text ?? '';
  if (HEADING.test(text) || RULE.test(text)) return true;
  if (TABLE_ROW.test(text) && TABLE_RULE.test(lines[i + 1]?.text ?? '')) return true;
  const m = listMarker(text);
  // As in GitHub's Markdown, a numbered list breaks into a paragraph only when it starts at 1.
  return m !== null && m.rest.trim() !== '' && (!m.ordered || m.number === 1);
}

function parseList(lines: readonly Line[], from: number, first: Marker): { block: Block; next: number } {
  const items: ListItem[] = [];
  let i = from;
  for (;;) {
    const m = listMarker(lines[i]?.text ?? '');
    if (m?.indent !== first.indent || m.ordered !== first.ordered) break;
    const body: Line[] = [{ text: m.rest, line: lines[i]?.line ?? 0 }];
    let j = i + 1;
    while (j < lines.length) {
      const text = lines[j]?.text ?? '';
      if (blank(text)) {
        // A blank line ends the item, unless what comes after it is indented to the item's words.
        let k = j + 1;
        while (k < lines.length && blank(lines[k]?.text ?? '')) k++;
        if (k < lines.length && indentOf(lines[k]?.text ?? '') >= m.content) {
          for (; j < k; j++) body.push({ text: '', line: lines[j]?.line ?? 0 });
          continue;
        }
        break;
      }
      if (indentOf(text) >= m.content) {
        body.push({ text: text.slice(m.content), line: lines[j]?.line ?? 0 });
        j++;
        continue;
      }
      if (listMarker(text) || startsBlock(lines, j)) break;
      // A line going on with the item's words, not indented.
      body.push({ text: text.trim(), line: lines[j]?.line ?? 0 });
      j++;
    }
    let task: ListItem['task'] = null;
    const first0 = body[0];
    const box = first0 ? /^\[([ xX])\]\s+(.*)$/u.exec(first0.text) : null;
    if (first0 && box) {
      task = box[1] === ' ' ? 'open' : 'done';
      body[0] = { text: box[2] ?? '', line: first0.line };
    }
    items.push({ task, blocks: parseBlocks(body), pid: -1, line: lines[i]?.line ?? 0 });
    i = j;
    // Blank lines between items of one list.
    let k = i;
    while (k < lines.length && blank(lines[k]?.text ?? '')) k++;
    const next = listMarker(lines[k]?.text ?? '');
    if (next?.indent === first.indent && next.ordered === first.ordered) i = k;
    else break;
  }
  return {
    block: {
      kind: 'list',
      ordered: first.ordered,
      start: first.number,
      items,
      line: lines[from]?.line ?? 0,
    },
    next: i,
  };
}

function parseBlocks(lines: readonly Line[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  for (let here = lines[i]; here; here = lines[i]) {
    const text = here.text;
    if (blank(text)) {
      i++;
      continue;
    }
    const h = HEADING.exec(text);
    if (h) {
      out.push({
        kind: 'heading',
        level: (h[1] ?? '#').length,
        children: parseInline(h[2] ?? ''),
        pid: -1,
        line: here.line,
      });
      i++;
      continue;
    }
    if (RULE.test(text)) {
      out.push({ kind: 'rule', line: here.line });
      i++;
      continue;
    }
    if (TABLE_ROW.test(text) && TABLE_RULE.test(lines[i + 1]?.text ?? '')) {
      const head = cells(text).map(parseInline);
      const rows: TableRow[] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]?.text ?? '')) {
        rows.push({
          cells: cells(lines[i]?.text ?? '').map(parseInline),
          pid: -1,
          line: lines[i]?.line ?? 0,
        });
        i++;
      }
      out.push({ kind: 'table', head, rows, line: here.line });
      continue;
    }
    const marker = listMarker(text);
    if (marker) {
      const { block, next } = parseList(lines, i, marker);
      out.push(block);
      i = next;
      continue;
    }
    // A paragraph: its lines, up to a blank one or the start of another block.
    const words: string[] = [];
    do {
      words.push((lines[i]?.text ?? '').trim());
      i++;
    } while (i < lines.length && !blank(lines[i]?.text ?? '') && !startsBlock(lines, i));
    out.push({ kind: 'paragraph', children: parseInline(words.join(' ')), pid: -1, line: here.line });
  }
  return out;
}

/** Number every passage in order: headings, paragraphs (not those inside an item), items and rows. */
function number(blocks: Block[], next: { n: number }, insideItem: boolean): void {
  for (const b of blocks) {
    if (b.kind === 'heading' || (b.kind === 'paragraph' && !insideItem)) b.pid = next.n++;
    else if (b.kind === 'list')
      for (const item of b.items) {
        item.pid = next.n++;
        number(item.blocks, next, true);
      }
    else if (b.kind === 'table') for (const row of b.rows) row.pid = next.n++;
  }
}

/** A guide's Markdown, read. */
export function parseMarkdown(text: string): Block[] {
  const lines = text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((t, i) => ({ text: t.replace(/\t/gu, '    '), line: i + 1 }));
  const blocks = parseBlocks(lines);
  number(blocks, { n: 0 }, false);
  return blocks;
}

// ---- passages and pictures --------------------------------------------------------------------------

export interface Passage {
  id: number;
  /** The section it is in: the nearest heading of level 2 above it (or the guide's title before any). */
  section: string;
  text: string;
  heading: boolean;
}

/** The words of an item: its own paragraphs (a list inside it is passages of its own). */
const itemText = (item: ListItem) =>
  item.blocks
    .filter((b) => b.kind === 'paragraph')
    .map((b) => inlineText(b.children))
    .join(' ');

/** Every passage of a guide, in its order, with the section it is in. */
export function passagesOf(blocks: readonly Block[]): Passage[] {
  const out: Passage[] = [];
  let section = '';
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.kind === 'heading') {
        if (b.level <= 2) section = inlineText(b.children);
        out.push({ id: b.pid, section, text: inlineText(b.children), heading: true });
      } else if (b.kind === 'paragraph' && b.pid >= 0)
        out.push({ id: b.pid, section, text: inlineText(b.children), heading: false });
      else if (b.kind === 'list')
        for (const item of b.items) {
          out.push({ id: item.pid, section, text: itemText(item), heading: false });
          walk(item.blocks.filter((c) => c.kind !== 'paragraph'));
        }
      else if (b.kind === 'table')
        for (const row of b.rows)
          out.push({ id: row.pid, section, text: row.cells.map(inlineText).join(' · '), heading: false });
    }
  };
  walk(blocks);
  return out;
}

/** Every picture a guide shows, in order (their paths as written). */
export function imagesOf(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  const inline = (list: readonly Inline[]) => {
    for (const n of list) {
      if (n.kind === 'image') out.push(n.src);
      else if (n.kind === 'strong') inline(n.children);
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
