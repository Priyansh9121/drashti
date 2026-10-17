import type { ImportIssue } from '../../../shared/import';
import type { TextElement, TextRun, TextStyle } from '../../../shared/model';
import { mainLang, mergeRuns, withDetectedLangs } from '../../../shared/text-runs';
import { decodeText } from '../decode';
import type { LegacyFontUse } from '../legacy-fonts';
import { parseLyrics } from '../../../shared/lyrics';
import type { ParsedArrangement, ParsedGroup, ParsedPresentation, ParsedSlide } from '../model';

/*
 * Plain-text lyrics (the format is in src/shared/lyrics.ts): [Verse 1]
 * lines start groups, blank lines split slides, and a header again with no
 * words repeats that group, so the presentation gets an arrangement. A Word
 * file's lyrics (Session 26f, ./docx.ts) go through the same code, their
 * paragraphs as the lines, with the runs each line was typed in.
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
  // New text (Sessions 31–36, I18N-2): room for Gujarati and Hindi marks.
  lineHeight: NEW_TEXT_LINE_HEIGHT,
  shadow: true,
};

// The usual colours for the usual group names: shared/group-colors.ts (Session 26g: Chorus teal).
import { groupColor } from '../../../shared/group-colors';
import { NEW_TEXT_LINE_HEIGHT } from '../../../shared/model';
import { cutText } from '../../../shared/text';
export { groupColor };

/**
 * A Word file's lines as typed (Session 26f): each line's runs, by its text, in the order written (null for
 * a line with nothing to keep but its words), and the use of legacy fonts for the report.
 */
export interface TypedLines {
  runsOf(line: string): TextRun[] | null;
  legacy: LegacyFontUse;
}

function slideFromLines(lines: string[], issues: ImportIssue[], typed?: TypedLines): ParsedSlide {
  // Every line is taken in turn, kept or not, so the lines after it find their own runs.
  const typedRuns = typed ? lines.map((line) => typed.runsOf(line)) : null;
  let text = lines.join('\n');
  const cut = text.length > MAX_SLIDE_CHARS;
  if (cut) {
    text = cutText(text, MAX_SLIDE_CHARS);
    issues.push({
      severity: 'warning',
      code: 'text-cut',
      message: `A slide had more than ${MAX_SLIDE_CHARS.toLocaleString('en')} characters; the rest was left out.`,
      fix: null,
    });
  }
  // One run per line (a Word file's: its runs as typed, a legacy font's marked), each with the language of
  // its script; neighbours in the same language merge.
  const kept = text.split('\n');
  const asTyped = typed && typedRuns && !cut;
  const lineRuns = kept.flatMap((line, i): TextRun[] => {
    const own = (asTyped ? typedRuns[i] : null) ?? [{ text: line }];
    if (i === kept.length - 1) return own;
    const last = own.length - 1;
    return own.map((r, j) => (j === last ? { ...r, text: `${r.text}\n` } : r));
  });
  const runs: TextRun[] = mergeRuns(withDetectedLangs(asTyped ? typed.legacy.apply(lineRuns) : lineRuns));
  const element: TextElement = {
    id: 'text',
    kind: 'text',
    frame: { x: 96, y: 96, width: 1728, height: 888 },
    text,
    lang: mainLang(runs),
    style: LYRICS_STYLE,
  };
  if (runs.length > 1 || runs.some((r) => r.font !== undefined || r.legacy)) element.runs = runs;
  return { label: '', notes: '', background: null, enabled: true, elements: [element], cues: [] };
}

/** The file name without its folder or extension, as a presentation name. */
export function nameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? fileName;
  const name = base.replace(/\.[^.]+$/u, '').trim();
  return name === '' ? 'Untitled' : cutText(name, 200);
}

export function parseLyricsText(bytes: Uint8Array, fileName: string): ParsedPresentation {
  const decoded = decodeText(bytes);
  return lyricsPresentation(decoded.text, fileName, [...decoded.issues]);
}

/**
 * Lyrics as text made into a presentation, by the format's rules (src/shared/lyrics.ts); `issues` so far
 * (the file's own) are kept. `typed`: a Word file's lines as typed.
 */
export function lyricsPresentation(
  text: string,
  fileName: string,
  issues: ImportIssue[],
  typed?: TypedLines,
): ParsedPresentation {
  const parsed = parseLyrics(text, MAX_SLIDES);
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
    slides: g.slides.map((lines) => slideFromLines(lines, issues, typed)),
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
