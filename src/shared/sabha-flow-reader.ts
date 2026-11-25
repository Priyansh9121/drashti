import {
  SABHA_FLOW_LIMITS,
  type SabhaFlowItem,
  type SabhaFlowLang,
  type SabhaFlowReading,
} from './sabha-flow';
import type { FlowRule, FlowTextPage } from './sabha-flow-text';
import { cutText } from './text';

/*
 * Sabha flow (alpha.23): the reader. From a PDF's own text layer and its straight lines (shared/sabha-flow-text.ts,
 * read by pdf.js in the pictures window), its numbered items, in the PDF's own words and language:
 *
 * - the runs of text on one baseline make a line; a line whose first run is a number (1, 2, 3 or ૧, ૨, ૩ or १, २, ३),
 *   the numbers going up and standing one under another, starts a row;
 * - a table's columns come from its upright borders, or (no borders) from the gaps no text crosses; the line above the
 *   first row is its header row;
 * - a merged cell (one cell over several rows) is known by the borders: no border across its column between those
 *   rows; with no borders at all, by its words sitting in the middle of rows whose cells there are empty. It is repeated
 *   on each row it covers. An empty cell with its own borders stays empty;
 * - no table (fewer than three columns and no header row): a numbered list, each number's line and the lines under
 *   it that are set in from the number;
 * - above the table or list: its title and subtitle; under it: the total (the line that says total, or a duration);
 * - the language by the script most of the words are in (Gujarati, Devanagari, Latin);
 * - no text (a scan, or a few words on one): 'no-text'; text that comes out as private-use, replacement or control
 *   characters, as unlikely Latin and Greek letters, or as the plain ASCII an old typing font writes for its Gujarati
 *   or Hindi letters (fonts with no real Unicode map): 'unreadable'. Never OCR, never a guess.
 *
 * It runs in the hidden pictures window (renderer/src/pictures/flow-reading.ts), never in Main, and what it takes in
 * is bounded: more text than a running order has (12,000 runs, 200,000 characters, 2,000 numbered lines) is no
 * running order ('no-items'), and every step is at most a sort over what is left.
 */

/** What reading a PDF finds (the contract's SabhaFlowReading). */
export type FlowReading = SabhaFlowReading;

/** More than a running order ever holds: read no further. */
export const FLOW_READ_LIMITS = { runs: 12_000, chars: 200_000, numbered: 2_000 } as const;
/** Fewer characters than this in all: no text (a scan's page number or watermark). */
const FEW_CHARS = 20;
/** How many rows a merged cell with no borders round it may cover, either way. */
const SPAN_REACH = 6;

interface Frag {
  s: string;
  x: number;
  r: number;
  y: number;
  h: number;
  pageTop: number;
}

interface Line {
  y: number;
  h: number;
  frags: Frag[];
  /** Where its page starts (pages are read one under another). */
  pageTop: number;
}

/** More than this share of odd characters, and the text is unreadable. */
const UNREADABLE_SHARE = 0.3;
/** A script with at least this share of the letters is the PDF's language. */
const LANG_SHARE = 0.6;

function isOdd(cp: number): boolean {
  return (
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    cp >= 0xf0000 ||
    cp === 0xfffd ||
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    // Letters no English, Gujarati or Hindi running order is written in: what a font with no real map comes out as.
    (cp >= 0x00c0 && cp <= 0x02ff && cp !== 0x00d7 && cp !== 0x00f7) ||
    (cp >= 0x0370 && cp <= 0x03ff)
  );
}

/** A character the panel and the phone would draw as a box: left out of a flow's words. */
const isBox = (cp: number) =>
  (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000 || cp === 0xfffd || cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);

const isSpace = (cp: number) =>
  cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) || cp === 0xa0 || cp === 0x2007 || cp === 0x202f || cp === 0x3000;

const OLD_FONT_SHARE = 0.3;
const FLIP = /[a-z][A-Z]/u;
const INNER_SYMBOL = /[A-Za-z][[\]{}\\|^~`;=+<>@#$%&*][A-Za-z]/u;
const VOWEL = /[aeiouyAEIOUY]/u;

/**
 * The plain ASCII an old (pre-Unicode) Gujarati or Hindi typing font writes for its letters: of the words of two or
 * more Latin letters, how many have a capital inside after a small letter, a symbol between letters, or no vowel.
 * English running orders stay well under a tenth; such text is most of its words.
 */
function oldTypingFont(texts: readonly string[]): boolean {
  let words = 0;
  let odd = 0;
  for (const text of texts)
    for (const word of text.split(/\s+/u)) {
      let letters = 0;
      for (const c of word) if (isLatin(c.codePointAt(0) ?? 0)) letters++;
      if (letters < 2) continue;
      words++;
      if (FLIP.test(word) || INNER_SYMBOL.test(word) || !VOWEL.test(word)) odd++;
    }
  return words > 0 && odd > OLD_FONT_SHARE * words;
}

const isGujarati = (cp: number) => cp >= 0x0a80 && cp <= 0x0aff;
const isDevanagari = (cp: number) => (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff);
const isLatin = (cp: number) => (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);

function langOf(texts: readonly string[]): SabhaFlowLang {
  let gu = 0;
  let hi = 0;
  let en = 0;
  for (const text of texts)
    for (const c of text) {
      const cp = c.codePointAt(0) ?? 0;
      if (isGujarati(cp)) gu++;
      else if (isDevanagari(cp)) hi++;
      else if (isLatin(cp)) en++;
    }
  const all = gu + hi + en;
  if (all === 0) return 'mixed';
  if (gu >= LANG_SHARE * all) return 'gu';
  if (hi >= LANG_SHARE * all) return 'hi';
  if (en >= LANG_SHARE * all) return 'en';
  return 'mixed';
}

/*
 * The short i (Gujarati િ U+0ABF, Devanagari ि U+093F) is written after its consonant but seen before it. Some
 * programs write the text layer in the order it is seen: then a short i stands where no Unicode text has one (at a
 * word's start, after a vowel). When that is so, each is put back after the consonant (or conjunct) it was seen
 * before. Text in Unicode order never has one there, so is never changed.
 */
const SHORT_I = [
  {
    i: '\u0ABF',
    cluster: '(?:[\u0A95-\u0AB9]\u0ABC?\u0ACD)*[\u0A95-\u0AB9]\u0ABC?',
    after: '[\u0A95-\u0AB9\u0ABC]',
  },
  {
    i: '\u093F',
    cluster:
      '(?:[\u0915-\u0939\u0958-\u095F\u0978-\u097F]\u093C?\u094D)*[\u0915-\u0939\u0958-\u095F\u0978-\u097F]\u093C?',
    after: '[\u0915-\u0939\u0958-\u095F\u0978-\u097F\u093C]',
  },
] as const;

function shortIRepairs(texts: readonly string[]): ((s: string) => string)[] {
  const repairs: ((s: string) => string)[] = [];
  for (const { i, cluster, after } of SHORT_I) {
    let all = 0;
    let misplaced = 0;
    const misplacedAt = new RegExp(`(?<!${after})${i}`, 'gu');
    for (const text of texts) {
      all += text.split(i).length - 1;
      misplaced += text.match(misplacedAt)?.length ?? 0;
    }
    if (misplaced === 0 || misplaced < 0.25 * all) continue;
    const swap = new RegExp(`${i}(${cluster})`, 'gu');
    repairs.push((s) => s.replace(swap, `$1${i}`));
  }
  return repairs;
}

const DIGIT_BASES = [0x30, 0x0ae6, 0x0966];
const NUMBER_START = /^\(?[0-9\u0AE6-\u0AEF\u0966-\u096F]/u;
const NUMBER = /^\(?([0-9\u0AE6-\u0AEF\u0966-\u096F]{1,3})[.):]?$/u;
// A time (3:30) is no item's number: no digit straight after the number's stop.
const LIST_LINE =
  /^\(?([0-9\u0AE6-\u0AEF\u0966-\u096F]{1,3})(?:[.):](?![0-9\u0AE6-\u0AEF\u0966-\u096F])\s*|\s+)(\S.*)$/u;

function valueOf(digits: string): number {
  let n = 0;
  for (const c of digits) {
    const cp = c.codePointAt(0) ?? 0;
    const base = DIGIT_BASES.find((b) => cp >= b && cp <= b + 9) ?? 0x30;
    n = n * 10 + (cp - base);
  }
  return n;
}

/** "Total" as a word of its own (a letter or mark either side makes it part of another word). */
const TOTAL = /(?<![\p{L}\p{M}])(?:total|કુલ|कुल)(?![\p{L}\p{M}])/iu;
const DURATION =
  /\d.*(?<![\p{L}\p{M}])(min|mins|minute|minutes|hr|hrs|hour|hours|મિનિટ|કલાક|मिनट|घंटा)(?![\p{L}\p{M}])/iu;

const tidy = (s: string): string => s.replace(/\s+/gu, ' ').trim();
const cut = (s: string): string => cutText(s, SABHA_FLOW_LIMITS.maxText);

/** A line's runs, left to right, joined: a space where they stand apart. */
function joined(frags: readonly Frag[]): string {
  let out = '';
  let last: Frag | undefined;
  for (const f of [...frags].sort((a, b) => a.x - b.x)) {
    if (last && f.x - last.r > 0.2 * Math.max(f.h, last.h)) out += ' ';
    out += f.s;
    last = f;
  }
  return tidy(out);
}

function median(values: readonly number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? fallback;
}

/** The smallest and largest of many numbers (no spread: a page can hand over more than a call takes). */
function least(values: Iterable<number>, fallback: number): number {
  let out = Infinity;
  for (const v of values) if (v < out) out = v;
  return out === Infinity ? fallback : out;
}
function most(values: Iterable<number>, fallback: number): number {
  let out = -Infinity;
  for (const v of values) if (v > out) out = v;
  return out === -Infinity ? fallback : out;
}

/** The longest run of numbers going up, kept in their order (each above the one before), in n log n. */
function goingUp<T extends { value: number }>(list: readonly T[]): T[] {
  const tails: number[] = [];
  const before: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const value = list[i]?.value ?? 0;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[tails[mid] ?? 0]?.value ?? 0) < value) lo = mid + 1;
      else hi = mid;
    }
    before[i] = lo > 0 ? (tails[lo - 1] ?? -1) : -1;
    tails[lo] = i;
  }
  const out: T[] = [];
  for (let at = tails[tails.length - 1] ?? -1; at >= 0; at = before[at] ?? -1) {
    const item = list[at];
    if (item) out.push(item);
  }
  return out.reverse();
}

/**
 * Of numbered lines, the rows: those standing one under another (their numbers' left edges in one group: sorted by
 * left edge, a new group wherever the next stands more than 6 points further right, so centred numbers of one and two
 * digits stay together and a stray number apart; review S15), going up. Of each group, the longest run going up; the
 * longest of those.
 */
function numberedRun<T extends { x: number; y: number; value: number }>(list: readonly T[]): T[] {
  const byX = [...list].sort((a, b) => a.x - b.x);
  let best: T[] = [];
  for (let start = 0; start < byX.length;) {
    let end = start + 1;
    while (end < byX.length && (byX[end]?.x ?? Infinity) - (byX[end - 1]?.x ?? -Infinity) <= 6) end++;
    const group = byX.slice(start, end).sort((a, b) => a.y - b.y);
    const run = goingUp(group);
    if (run.length > best.length) best = run;
    start = end;
  }
  return best;
}

function nothing(status: 'no-text' | 'unreadable' | 'no-items', lang: SabhaFlowLang = 'mixed'): FlowReading {
  return { status, lang, headers: [], items: [] };
}

interface Row {
  line: Line;
  index: number;
  no: string;
  value: number;
  x: number;
  y: number;
  /** The number's own run. */
  frag: Frag;
}

export function readSabhaFlow(pages: readonly FlowTextPage[]): FlowReading {
  // Every page one under another; no more than a running order ever holds.
  let raw: Frag[] = [];
  const rules: FlowRule[] = [];
  let offset = 0;
  let chars = 0;
  let odd = 0;
  let tooMuch = false;
  for (const page of pages) {
    for (const t of page.texts) {
      const s = t.s.normalize('NFC');
      let solid = 0;
      for (const c of s) {
        const cp = c.codePointAt(0) ?? 0;
        if (isSpace(cp)) continue;
        solid++;
        if (isOdd(cp)) odd++;
      }
      if (solid === 0) continue;
      chars += solid;
      if (raw.length >= FLOW_READ_LIMITS.runs || chars > FLOW_READ_LIMITS.chars) {
        tooMuch = true;
        break;
      }
      raw.push({ s, x: t.x, r: t.x + t.w, y: t.y + offset, h: t.h > 0 ? t.h : 1, pageTop: offset });
    }
    if (tooMuch) break;
    for (const rule of page.rules)
      if (rules.length < FLOW_READ_LIMITS.runs)
        rules.push({ x0: rule.x0, y0: rule.y0 + offset, x1: rule.x1, y1: rule.y1 + offset });
    offset += page.height;
  }
  if (!tooMuch && chars < FEW_CHARS) return nothing('no-text');
  if (odd > UNREADABLE_SHARE * chars) return nothing('unreadable');
  const texts = raw.map((f) => f.s);
  const lang = langOf(texts);
  // More text than a running order ever holds: none is read (its pages are shown).
  if (tooMuch) return nothing('no-items', lang);
  if (lang !== 'gu' && lang !== 'hi' && oldTypingFont(texts)) return nothing('unreadable');
  // A character that would draw as a box is left out of the words.
  raw = raw
    .map((f) => {
      let clean = '';
      for (const c of f.s) if (!isBox(c.codePointAt(0) ?? 0)) clean += c;
      return clean === f.s ? f : { ...f, s: clean };
    })
    .filter((f) => f.s.trim() !== '');
  const repairs = shortIRepairs(raw.map((f) => f.s));
  if (repairs.length > 0) raw = raw.map((f) => ({ ...f, s: repairs.reduce((s, fix) => fix(s), f.s) }));

  // Lines: runs on one baseline.
  raw.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const f of raw) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - f.y) <= 0.35 * Math.max(last.h, f.h)) {
      last.frags.push(f);
      last.h = Math.max(last.h, f.h);
    } else lines.push({ y: f.y, h: f.h, frags: [f], pageTop: f.pageTop });
  }
  for (const line of lines) line.frags.sort((a, b) => a.x - b.x);
  // More lines starting with a number than a running order ever has: none is read.
  let numberedLines = 0;
  for (const line of lines) if (NUMBER_START.test(line.frags[0]?.s.trim() ?? '')) numberedLines++;
  if (numberedLines > FLOW_READ_LIMITS.numbered) return nothing('no-items', lang);
  const textOf = (line: Line) => joined(line.frags);
  const pitch = median(
    lines.slice(1).map((line, k) => line.y - (lines[k]?.y ?? 0)),
    12,
  );

  const table = readTable(lines, rules, pitch);
  const found = table ?? readList(lines, pitch);
  if (!found || found.items.length === 0) return { status: 'no-items', lang, headers: [], items: [] };
  const above = lines
    .slice(0, found.first)
    .map(textOf)
    .filter((t) => t !== '');
  const below = lines.slice(found.end, found.end + 4).map(textOf);
  const total = below.find((t) => TOTAL.test(t)) ?? below.find((t) => DURATION.test(t));
  const reading: FlowReading = { status: 'read', lang, headers: found.headers, items: found.items };
  const title = above[0];
  const subtitle = above.slice(1, 4).join(' · ');
  if (title) reading.title = cut(title);
  if (subtitle) reading.subtitle = cut(subtitle);
  if (total) reading.total = cut(total);
  // Keep the keys in the contract's order.
  return {
    status: reading.status,
    lang: reading.lang,
    ...(reading.title !== undefined ? { title: reading.title } : {}),
    ...(reading.subtitle !== undefined ? { subtitle: reading.subtitle } : {}),
    headers: reading.headers,
    items: reading.items,
    ...(reading.total !== undefined ? { total: reading.total } : {}),
  };
}

interface Found {
  headers: string[];
  items: SabhaFlowItem[];
  /** The first line that is the table's or list's (title and subtitle are above it). */
  first: number;
  /** The first line after it (the total is at or under it). */
  end: number;
}

function numberedRows(lines: readonly Line[]): Row[] {
  const candidates: Row[] = [];
  lines.forEach((line, index) => {
    const frag = line.frags[0];
    const m = frag ? NUMBER.exec(frag.s.trim()) : null;
    if (!frag || !m?.[1]) return;
    candidates.push({ line, index, no: m[1], value: valueOf(m[1]), x: frag.x, y: line.y, frag });
  });
  return candidates.length > FLOW_READ_LIMITS.numbered ? [] : numberedRun(candidates);
}

/** A column: its left and right edges. */
interface Column {
  left: number;
  right: number;
}

function readTable(lines: readonly Line[], rules: readonly FlowRule[], pitch: number): Found | null {
  // At most the items a flow holds: the table ends where the next would start.
  const numbered = numberedRows(lines);
  const rows = numbered.slice(0, SABHA_FLOW_LIMITS.maxItems);
  const stopAt = numbered[SABHA_FLOW_LIMITS.maxItems]?.index ?? lines.length;
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  if (!firstRow || !lastRow || rows.length < 2) return null;
  const h = median(
    rows.map((r) => r.line.h),
    10,
  );
  // Where the table spans across, from its rows; the borders over it.
  const rowLines = lines.slice(firstRow.index, lastRow.index + 1);
  const leftmost = least(
    rowLines.flatMap((l) => l.frags.map((f) => f.x)),
    0,
  );
  const rightmost = most(
    rowLines.flatMap((l) => l.frags.map((f) => f.r)),
    0,
  );
  const width = rightmost - leftmost;
  // Borders across that reach over its words, and the upright ones within them (a short last column's border stands
  // well right of its words).
  const across = rules.filter((r) => r.y0 === r.y1 && r.x1 > leftmost && r.x0 < rightmost);
  const outerLeft =
    Math.min(
      leftmost,
      least(
        across.map((r) => r.x0),
        leftmost,
      ),
    ) - 3;
  const outerRight =
    Math.max(
      rightmost,
      most(
        across.map((r) => r.x1),
        rightmost,
      ),
    ) + 3;
  const down = rules.filter((r) => r.x0 === r.x1 && r.x0 >= outerLeft && r.x0 <= outerRight);
  const heights = bordersAcross(across);
  // Bordered: borders across between its rows.
  const bordered = heights.some((g) => g.y0 > firstRow.y && g.y0 < lastRow.y);
  // Where each row starts: the border above it (a number may sit in the middle of a tall row), else just above its
  // number's line.
  const starts = rows.map((row, k) => {
    const previous = rows[k - 1];
    if (bordered) {
      const above = heights.filter(
        (g) =>
          g.y0 < row.y - 0.3 * row.line.h &&
          (previous ? g.y0 > previous.y : g.y0 > row.y - 8 * h && g.length >= 0.5 * width),
      );
      const border = previous
        ? [...above].sort((a, b) => b.length - a.length)[0]
        : [...above].sort((a, b) => b.y0 - a.y0)[0];
      if (border) return border.y0;
    }
    return row.y - 0.5 * row.line.h;
  });
  const start = starts[0] ?? firstRow.y;
  // The header row: in a bordered table, the lines between its top border and the first row; else the one line just
  // above the first row, with at least two runs, close enough.
  const before = lines.filter((l) => l.y < start);
  let headerLines: Line[] = [];
  const topBorder = bordered
    ? heights
        .filter((g) => g.y0 < start - 0.5 * h && g.y0 >= start - 6 * h && g.length >= 0.5 * width)
        .sort((a, b) => b.y0 - a.y0)[0]
    : undefined;
  if (topBorder) headerLines = before.filter((l) => l.y > topBorder.y0);
  else {
    const line = before[before.length - 1];
    if (line && line.frags.length >= 2 && firstRow.y - line.y <= 3 * Math.max(pitch, h)) headerLines = [line];
  }
  if (headerLines.reduce((n, l) => n + l.frags.length, 0) < 2) headerLines = [];
  const header = headerLines.length > 0;
  const top = lines.indexOf(headerLines[0] ?? lines.find((l) => l.y >= start) ?? firstRow.line);
  // Its end: its bottom border (the first border across most of it under the last row), or where its lines stop.
  const wide = heights
    .filter((r) => r.y0 > lastRow.y && r.length >= 0.6 * width)
    .sort((a, b) => a.y0 - b.y0)[0];
  let end = lastRow.index + 1;
  if (wide) while (end < stopAt && (lines[end]?.y ?? Infinity) < wide.y0) end++;
  else
    while (end < stopAt) {
      const line = lines[end];
      const previous = lines[end - 1];
      if (!line || !previous) break;
      const first = line.frags[0];
      if (line.y - previous.y > 1.9 * Math.max(pitch, h)) break;
      if (TOTAL.test(joined(line.frags))) break;
      if (first && first.x < lastRow.frag.r + 2) break;
      end++;
    }
  // A header row repeated at the top of a later page is not a row's words.
  const headerTexts = new Set(headerLines.map((l) => joined(l.frags)));
  const tableLines = lines
    .slice(top, end)
    .filter((l) => headerLines.includes(l) || !headerTexts.has(joined(l.frags)));

  const columns = columnsByBorders(down, tableLines, h) ?? columnsByGaps(tableLines, width);
  // From the number's column on.
  const numberAt = columns.findIndex(
    (c) => firstRow.frag.x + 0.5 < c.right && firstRow.frag.x + 0.5 >= c.left - 2,
  );
  if (numberAt < 0) return null;
  const used = columns.slice(numberAt);
  const columnOf = (f: Frag): number => {
    const at = f.x + Math.min(1, (f.r - f.x) / 2);
    const k = used.findIndex((c, i) => at < c.right || i === used.length - 1);
    return k >= 0 && at >= (used[0]?.left ?? 0) - 2 ? k : -1;
  };

  // Each row's lines: from where it starts down to where the next one starts.
  const rowOf = (line: Line): number => {
    let found = -1;
    starts.forEach((at, k) => {
      if (line.y >= at) found = k;
    });
    return found;
  };
  const cells: string[][][] = rows.map(() => used.map(() => [] as string[]));
  const placed: { line: Line; col: number; row: number }[] = [];
  const headerCells: string[][] = used.map(() => []);
  for (const line of tableLines) {
    const row = headerLines.includes(line) ? -1 : rowOf(line);
    if (row < 0 && !headerLines.includes(line)) continue;
    const byColumn = new Map<number, Frag[]>();
    for (const f of line.frags) {
      const col = columnOf(f);
      if (col < 0) continue;
      byColumn.set(col, [...(byColumn.get(col) ?? []), f]);
    }
    for (const [col, frags] of byColumn) {
      const text = joined(frags);
      if (text === '') continue;
      if (row < 0) headerCells[col]?.push(text);
      else {
        cells[row]?.[col]?.push(text);
        placed.push({ line, col, row });
      }
    }
  }
  // Merged cells.
  const text: string[][] = cells.map((row) => row.map((parts) => tidy(parts.join(' '))));
  const n = rows.length;
  // The borders across between each row and the next (the rules sorted by height once: each found by halving).
  const acrossByY = [...across].sort((a, b) => a.y0 - b.y0);
  const firstAtOrAbove = (y: number) => {
    let lo = 0;
    let hi = acrossByY.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((acrossByY[mid]?.y0 ?? Infinity) <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const betweenRows = rows.slice(0, -1).map((upper, k) => {
    const lower = rows[k + 1];
    if (!lower) return [];
    return acrossByY.slice(firstAtOrAbove(upper.y), firstAtOrAbove(lower.y - 0.5 * lower.line.h));
  });
  // Each row's words, column by column: the lines they are on, and how low each column's words reach.
  const placedAt = new Map<string, Line[]>();
  const lowest = rows.map(() => used.map(() => -Infinity));
  for (const p of placed) {
    const key = `${String(p.row)}:${String(p.col)}`;
    placedAt.set(key, [...(placedAt.get(key) ?? []), p.line]);
    const reach = lowest[p.row];
    if (reach) reach[p.col] = Math.max(reach[p.col] ?? -Infinity, p.line.y);
  }
  for (let col = 1; col < used.length; col++) {
    const column = used[col];
    if (!column) continue;
    const width = column.right - column.left;
    const covered = (r: FlowRule) =>
      Math.min(r.x1, column.right) - Math.max(r.x0, column.left) >= 0.5 * width;
    // Bordered boundaries: merged where this column has no border and some other column has one.
    const known: boolean[] = [];
    const joinedDown: boolean[] = [];
    for (let k = 0; k < n - 1; k++) {
      const between = betweenRows[k] ?? [];
      known[k] = between.length > 0;
      joinedDown[k] = known[k] === true && !between.some(covered);
    }
    let start = 0;
    for (let k = 0; k <= n - 1; k++) {
      if (k < n - 1 && joinedDown[k]) continue;
      if (k > start) {
        const words = tidy(
          text
            .slice(start, k + 1)
            .map((row) => row[col] ?? '')
            .filter((t) => t !== '')
            .join(' '),
        );
        for (let r = start; r <= k; r++) {
          const row = text[r];
          if (row) row[col] = words;
        }
      }
      start = k + 1;
    }
    // No borders between rows: words in the middle of rows whose cells there are empty cover them all.
    for (let r = 0; r < n; r++) {
      const row = rows[r];
      const own = placedAt.get(`${String(r)}:${String(col)}`) ?? [];
      if (!row || own.length === 0) continue;
      if (own.some((line) => Math.abs(line.y - row.y) <= 0.5 * row.line.h)) continue;
      const middle =
        (least(
          own.map((line) => line.y),
          row.y,
        ) +
          most(
            own.map((line) => line.y),
            row.y,
          )) /
        2;
      const empty = (k: number) =>
        (text[k]?.[col] ?? '') === '' && (k === 0 || !known[k - 1]) && (k === n - 1 || !known[k]);
      let best: { a: number; b: number; off: number } | null = null;
      for (let a = r; a >= 0 && a >= r - SPAN_REACH && (a === r || empty(a)); a--)
        for (let b = r; b < n && b <= r + SPAN_REACH && (b === r || empty(b)); b++) {
          if (b === a) continue;
          const others = (lowest[b] ?? []).filter((_, c) => c !== col);
          const centre = ((rows[a]?.y ?? 0) + Math.max(rows[b]?.y ?? 0, most(others, -Infinity))) / 2;
          const off = Math.abs(centre - middle);
          if (!best || off < best.off) best = { a, b, off };
        }
      if (best && best.off <= 0.6 * row.line.h) {
        const words = text[r]?.[col] ?? '';
        for (let k = best.a; k <= best.b; k++) {
          const target = text[k];
          if (target) target[col] = words;
        }
      }
    }
  }
  const headers = header ? headerCells.map((parts) => tidy(parts.join(' '))) : [];
  // Columns with nothing in them anywhere (a doubled border) are left out.
  const keep = used.map(
    (_, col) => col === 0 || (headers[col] ?? '') !== '' || text.some((row) => (row[col] ?? '') !== ''),
  );
  const kept = keep.filter(Boolean).length;
  if (kept < 3 && !(header && kept >= 2)) return null;
  const items = rows.slice(0, SABHA_FLOW_LIMITS.maxItems).map((row, r) => ({
    no: row.no,
    cells: (text[r] ?? [])
      .filter((_, col) => col > 0 && keep[col])
      .slice(0, SABHA_FLOW_LIMITS.maxColumns - 1)
      .map(cut),
  }));
  return {
    headers: header
      ? headers
          .filter((_, col) => keep[col])
          .slice(0, SABHA_FLOW_LIMITS.maxColumns)
          .map(cut)
      : [],
    items,
    first: top,
    end,
  };
}

/** Borders across, those on one height (within 1.5 points) taken together (a word processor draws one per cell). */
function bordersAcross(across: readonly FlowRule[]): { y0: number; length: number }[] {
  const out: { y0: number; length: number }[] = [];
  for (const rule of [...across].sort((a, b) => a.y0 - b.y0)) {
    // Sorted by height: only the last group can be near.
    const last = out[out.length - 1];
    const near = last && Math.abs(last.y0 - rule.y0) <= 1.5 ? last : undefined;
    if (near) near.length += rule.x1 - rule.x0;
    else out.push({ y0: rule.y0, length: rule.x1 - rule.x0 });
  }
  return out;
}

/** Columns between upright borders that run down most of the table (on each page it is on). */
function columnsByBorders(down: readonly FlowRule[], lines: readonly Line[], h: number): Column[] | null {
  const spans: { top: number; bottom: number }[] = [];
  for (const line of lines) {
    const span = spans.find((s) => s.top === line.pageTop);
    if (span) span.bottom = Math.max(span.bottom, line.y + 0.5 * h);
    else spans.push({ top: line.pageTop, bottom: line.y + 0.5 * h });
  }
  // Each page's part of the table: from its first line to its last.
  const parts = spans.map((s) => {
    const first =
      least(
        lines.filter((l) => l.pageTop === s.top).map((l) => l.y),
        s.bottom,
      ) -
      1.2 * h;
    return { top: first, bottom: s.bottom };
  });
  const height = parts.reduce((n, p) => n + p.bottom - p.top, 0);
  if (height <= 0) return null;
  const xs: { x: number; length: number }[] = [];
  for (const rule of [...down].sort((a, b) => a.x0 - b.x0)) {
    const length = parts.reduce(
      (n, p) => n + Math.max(0, Math.min(rule.y1, p.bottom) - Math.max(rule.y0, p.top)),
      0,
    );
    if (length <= 0) continue;
    // Sorted by place: only the last group can be near.
    const last = xs[xs.length - 1];
    const near = last && Math.abs(last.x - rule.x0) <= 3 ? last : undefined;
    if (near) near.length += length;
    else xs.push({ x: rule.x0, length });
  }
  const edges = xs
    .filter((e) => e.length >= 0.5 * height)
    .map((e) => e.x)
    .sort((a, b) => a - b);
  if (edges.length < 3) return null;
  return edges.slice(1).map((right, k) => ({ left: edges[k] ?? right, right }));
}

/** Columns from the gaps no text crosses (a table with no borders). */
function columnsByGaps(lines: readonly Line[], width: number): Column[] {
  const spans = lines
    .flatMap((line) => line.frags)
    .filter((f) => f.r - f.x <= 0.6 * width)
    .map((f) => ({ left: f.x, right: f.r, h: f.h }))
    .sort((a, b) => a.left - b.left);
  const merged: { left: number; right: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.left - last.right < 0.6 * span.h) last.right = Math.max(last.right, span.right);
    else merged.push({ left: span.left, right: span.right });
  }
  // Each column reaches halfway into the gaps either side.
  return merged.map((span, k) => {
    const previous = merged[k - 1];
    const next = merged[k + 1];
    return {
      left: previous ? (previous.right + span.left) / 2 : span.left - 1,
      right: next ? (span.right + next.left) / 2 : span.right + 1,
    };
  });
}

function readList(lines: readonly Line[], pitch: number): Found | null {
  const candidates: (Row & { rest: string })[] = [];
  lines.forEach((line, index) => {
    const frag = line.frags[0];
    const m = frag ? LIST_LINE.exec(joined(line.frags)) : null;
    if (!frag || !m?.[1] || !m[2]) return;
    candidates.push({ line, index, no: m[1], value: valueOf(m[1]), x: frag.x, y: line.y, frag, rest: m[2] });
  });
  const rows = candidates.length > FLOW_READ_LIMITS.numbered ? [] : numberedRun(candidates);
  const first = rows[0];
  if (!first || rows.length < 2) return null;
  const items: SabhaFlowItem[] = [];
  let end = first.index;
  rows.forEach((row, k) => {
    const next = rows[k + 1];
    const parts = [row.rest];
    let at = row.index + 1;
    while (at < (next ? next.index : lines.length)) {
      const line = lines[at];
      const previous = lines[at - 1];
      const start = line?.frags[0];
      if (!line || !previous || !start) break;
      if (line.y - previous.y > 1.9 * Math.max(pitch, line.h)) break;
      if (start.x <= row.x + 2 || TOTAL.test(joined(line.frags))) break;
      parts.push(joined(line.frags));
      at++;
    }
    end = at;
    if (items.length < SABHA_FLOW_LIMITS.maxItems)
      items.push({ no: row.no, cells: [cut(tidy(parts.join(' ')))] });
  });
  return { headers: [], items, first: first.index, end };
}
