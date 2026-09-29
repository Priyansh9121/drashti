import type { ImportIssue } from '../../../shared/import';
import type { TextElement, TextRun, TextStyle } from '../../../shared/model';
import { mainLang, mergeRuns, withDetectedLangs } from '../../../shared/text-runs';
import { decodeText } from '../decode';
import type { ParsedArrangement, ParsedGroup, ParsedPresentation, ParsedSlide } from '../model';

/*
 * Plain-text lyrics:
 *
 *   [Verse 1]            a line in square brackets starts a group
 *   first line
 *   second line          lines together make one slide
 *                        a blank line starts the next slide
 *   third line
 *
 *   [Chorus]
 *   ...
 *   [Verse 1]            a header again with no text after it repeats that
 *                        group: the presentation gets an arrangement
 *
 * Text before the first header goes into a group with no name.
 */

const HEADER = /^\[([^\]\n]{1,80})\]$/u;
/** Longest slide text kept (the model's limit for one text element). */
const MAX_SLIDE_CHARS = 20_000;
const MAX_SLIDES = 2_000;

export const LYRICS_STYLE: TextStyle = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: true,
};

/** The usual colours for the usual group names, so groups stand apart in the slide grid. */
export function groupColor(name: string): string | null {
  const n = name.toLowerCase().replace(/[\d\s.:#-]+$/u, '');
  const starts = (...prefixes: string[]) => prefixes.some((p) => n.startsWith(p));
  if (starts('verse', 'stanza', 'pad')) return '#3e63dd';
  if (starts('pre-chorus', 'prechorus')) return '#f76b15';
  if (starts('chorus', 'refrain', 'tek', 'ટેક', 'टेक')) return '#e5484d';
  if (starts('bridge')) return '#8e4ec6';
  if (starts('intro', 'outro', 'ending', 'tag', 'coda')) return '#12a594';
  return null;
}

function slideFromLines(lines: string[], issues: ImportIssue[]): ParsedSlide {
  let text = lines.join('\n');
  if (text.length > MAX_SLIDE_CHARS) {
    text = text.slice(0, MAX_SLIDE_CHARS);
    issues.push({
      severity: 'warning',
      code: 'text-cut',
      message: `A slide had more than ${MAX_SLIDE_CHARS.toLocaleString('en')} characters; the rest was left out.`,
      fix: null,
    });
  }
  // One run per line, each with the language of its script; neighbours in the same language merge.
  const kept = text.split('\n');
  const runs: TextRun[] = mergeRuns(
    withDetectedLangs(kept.map((line, i) => ({ text: i < kept.length - 1 ? `${line}\n` : line }))),
  );
  const element: TextElement = {
    id: 'text',
    kind: 'text',
    frame: { x: 96, y: 96, width: 1728, height: 888 },
    text,
    lang: mainLang(runs),
    style: LYRICS_STYLE,
  };
  if (runs.length > 1) element.runs = runs;
  return { label: '', notes: '', background: null, enabled: true, elements: [element], cues: [] };
}

/** The file name without its folder or extension, as a presentation name. */
export function nameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? fileName;
  const name = base.replace(/\.[^.]+$/u, '').trim();
  return name === '' ? 'Untitled' : name.slice(0, 200);
}

export function parseLyricsText(bytes: Uint8Array, fileName: string): ParsedPresentation {
  const decoded = decodeText(bytes);
  const issues: ImportIssue[] = [...decoded.issues];
  const lines = decoded.text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((l) => l.replace(/\t/gu, ' ').trim());

  /** Groups as written, one per header (plus a leading unnamed one if needed). */
  const written: ParsedGroup[] = [];
  let current: ParsedGroup | null = null;
  let pending: string[] = [];
  let slides = 0;
  let dropped = 0;

  const flush = () => {
    if (pending.length === 0) return;
    if (!current) {
      current = { name: '', color: null, slides: [] };
      written.push(current);
    }
    if (slides < MAX_SLIDES) {
      current.slides.push(slideFromLines(pending, issues));
      slides++;
    } else {
      dropped++;
    }
    pending = [];
  };

  for (const line of lines) {
    const header = HEADER.exec(line);
    if (header) {
      flush();
      const name = (header[1] ?? '').trim();
      current = { name, color: groupColor(name), slides: [] };
      written.push(current);
    } else if (line === '') {
      flush();
    } else {
      pending.push(line);
    }
  }
  flush();
  if (dropped > 0) {
    issues.push({
      severity: 'warning',
      code: 'too-many-slides',
      message: `Only the first ${MAX_SLIDES.toLocaleString('en')} slides were imported; ${dropped} more were left out.`,
      fix: null,
    });
  }

  // A header with no text repeats the earlier group of that name; the rest are left out.
  const groups: ParsedGroup[] = [];
  const order: number[] = [];
  const byName = new Map<string, number>();
  let repeats = false;
  for (const g of written) {
    const key = g.name.toLocaleLowerCase('en');
    if (g.slides.length > 0) {
      groups.push(g);
      order.push(groups.length - 1);
      if (!byName.has(key)) byName.set(key, groups.length - 1);
      continue;
    }
    const earlier = byName.get(key);
    if (earlier !== undefined) {
      order.push(earlier);
      repeats = true;
    } else {
      issues.push({
        severity: 'info',
        code: 'empty-group',
        message: `The group [${g.name}] has no text, so it was left out.`,
        fix: null,
      });
    }
  }
  // The song as written (with its repeats) is how it is sung: that arrangement is the one played.
  const arrangements: ParsedArrangement[] = repeats ? [{ name: 'As written', groups: order, ref: null }] : [];

  if (groups.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-slides',
      message: 'The file has no text to make slides from.',
      fix: null,
    });
  }
  return {
    name: nameFromFile(fileName),
    ref: null,
    width: 1920,
    height: 1080,
    notes: '',
    groups,
    arrangements,
    selectedArrangement: repeats ? 0 : null,
    media: [],
    issues,
  };
}
