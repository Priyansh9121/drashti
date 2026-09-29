import type { ImportIssue } from '../../../shared/import';
import type { TextElement, TextRun, TextStyle } from '../../../shared/model';
import { mainLang, mergeRuns, withDetectedLangs } from '../../../shared/text-runs';
import { decodeText } from '../decode';
import { parseLyrics } from '../../../shared/lyrics';
import type { ParsedArrangement, ParsedGroup, ParsedPresentation, ParsedSlide } from '../model';

/*
 * Plain-text lyrics (the format is in src/shared/lyrics.ts): [Verse 1]
 * lines start groups, blank lines split slides, and a header again with no
 * words repeats that group, so the presentation gets an arrangement.
 */

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
  const parsed = parseLyrics(decoded.text, MAX_SLIDES);
  if (parsed.droppedSlides > 0) {
    issues.push({
      severity: 'warning',
      code: 'too-many-slides',
      message: `Only the first ${MAX_SLIDES.toLocaleString('en')} slides were imported; ${parsed.droppedSlides} more were left out.`,
      fix: null,
    });
  }
  for (const name of parsed.emptyGroups) {
    issues.push({
      severity: 'info',
      code: 'empty-group',
      message: `The group [${name}] has no text, so it was left out.`,
      fix: null,
    });
  }
  const groups: ParsedGroup[] = parsed.groups.map((g) => ({
    name: g.name,
    color: groupColor(g.name),
    slides: g.slides.map((lines) => slideFromLines(lines, issues)),
  }));
  // The song as written (with its repeats) is how it is sung: that arrangement is the one played.
  const arrangements: ParsedArrangement[] = parsed.repeats
    ? [{ name: 'As written', groups: parsed.order, ref: null }]
    : [];

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
    selectedArrangement: parsed.repeats ? 0 : null,
    media: [],
    issues,
  };
}
