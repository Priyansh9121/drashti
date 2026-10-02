import type { Outline, Shadow, TextAlign, TextRun } from '../../../shared/model';
import { mergeRuns } from '../../../shared/text-runs';
import { codePageForCharset, decoderFor } from './codepages';

/*
 * A reader for the RTF inside presentation files (slide text is RTF in
 * both formats Drashti imports). It keeps what a slide needs: the text with
 * its paragraphs and line breaks, and per run the font, size, colour, bold
 * and italic, outlines and shadows (Cocoa's \\strokewidth and \\shad words),
 * plus each paragraph's alignment. Formatting it cannot show yet (underline,
 * text backgrounds...) is listed, never dropped silently. It never throws:
 * broken RTF gives what could be read.
 */

export interface RtfResult {
  /** Styled runs (no languages yet: the importer detects them). */
  runs: TextRun[];
  /** The plain text, runs joined; "\n" between paragraphs and at line breaks. */
  text: string;
  /** The alignment of most of the text, or null when there is no text. */
  align: TextAlign | null;
  /** Line spacing as a multiple of the font size, when the text sets one. */
  lineHeight: number | null;
  /** Font names as the file names them, for the fonts the text uses. */
  fonts: string[];
  /** Formatting in the text that Drashti does not show yet, in words. */
  unsupported: string[];
}

interface State {
  font: number | null;
  /** Points. */
  size: number;
  /** Extra space between letters, in points. */
  spacing: number;
  bold: boolean;
  italic: boolean;
  /** Index into the colour table (usually 0, "automatic"). */
  color: number;
  /** \outl: outlined letters. */
  outl: boolean;
  /** Cocoa's \strokewidth: twentieths of a percent of the font size; negative strokes and fills, positive only strokes. */
  strokeWidth: number;
  /** \strokec: the outline's colour (index into the colour table; 0 for the text's own). */
  strokeColor: number;
  /** \shad and Cocoa's offset (\shadx, \shady, y upwards), blur (\shadr) in twips, opacity (\shado, 0 to 255), colour (\shadc). */
  shadow: boolean;
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
  shadowOpacity: number | null;
  shadowColor: number | null;
  /** Characters to skip after \uN (the fallback). */
  uc: number;
  hidden: boolean;
  align: TextAlign;
  justified: boolean;
  lineSpacing: number | null;
  lineMultiple: boolean;
  dest: 'text' | 'fonttbl' | 'colortbl' | 'skip';
  /** The group began with \* (skip it unless its destination is known). */
  ignorable: boolean;
}

interface FontEntry {
  name: string;
  codePage: number | null;
}

/** Destinations whose content is never slide text. */
const SKIP = new Set([
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'mmathPr',
  'pn',
  'fldinst',
  'filetbl',
  'revtbl',
  'userprops',
  'docvar',
  'nonshppict',
  'shp',
  'annotation',
  'atnid',
  'atnauthor',
  'bkmkstart',
  'bkmkend',
  'expandedcolortbl',
  'panose',
  'falt',
  'fname',
]);
/** Destinations (possibly after \*) whose text is shown. */
const TEXT_DESTINATIONS = new Set(['listtext', 'pntext', 'fldrslt', 'field', 'shptxt']);

const SYMBOLS: Record<string, string> = {
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
  zwj: '‍',
  zwnj: '‌',
  ltrmark: '‎',
  rtlmark: '‏',
  tab: '\t',
  line: '\n',
};

/** What each unsupported control word means, for the report. */
const UNSUPPORTED: Record<string, string> = {
  ul: 'underline',
  uld: 'underline',
  uldb: 'underline',
  ulw: 'underline',
  strike: 'strikethrough',
  striked: 'strikethrough',
  embo: 'embossed text',
  impr: 'engraved text',
  caps: 'all capitals',
  scaps: 'small capitals',
  super: 'superscript or subscript',
  sub: 'superscript or subscript',
  up: 'superscript or subscript',
  dn: 'superscript or subscript',
  cb: 'text background colour',
  highlight: 'text background colour',
  chcbpat: 'text background colour',
  charscalex: 'stretched text',
};
/** Unsupported words that are "off" at this value (e.g. \ul0, \cb0, \charscalex100). */
const OFF_VALUE: Record<string, number> = { charscalex: 100 };

const STYLE_WEIGHTS: [RegExp, number][] = [
  [/^(extra|ultra)light$/u, 200],
  [/^thin$|^hairline$/u, 100],
  [/^light$/u, 300],
  [/^(regular|roman|book|normal|plain)$/u, 400],
  [/^medium$/u, 500],
  [/^(semi|demi)bold$/u, 600],
  [/^bold$/u, 700],
  [/^(extra|ultra)bold$/u, 800],
  [/^(black|heavy)$/u, 900],
];

/**
 * A PostScript font name ("Helvetica-Bold", "HelveticaNeue-LightItalic",
 * "Arial-BoldMT") as a family, weight and italic. Names without a known
 * style after the last hyphen (legacy fonts such as "Terafont-Varun")
 * stay exactly as they are.
 */
export function fontFace(name: string): { family: string; weight?: number; italic?: boolean } {
  const dash = name.lastIndexOf('-');
  if (dash <= 0 || name.includes(' ')) return { family: name };
  let style = name
    .slice(dash + 1)
    .replace(/(MT|PS)$/u, '')
    .toLowerCase();
  let italic = false;
  const slant = /(italic|oblique)$/u.exec(style);
  if (slant) {
    italic = true;
    style = style.slice(0, -slant[0].length);
  }
  const weight = style === '' ? 400 : STYLE_WEIGHTS.find(([re]) => re.test(style))?.[1];
  if (weight === undefined) return { family: name };
  const family = name
    .slice(0, dash)
    .replace(/(MT|PS)$/u, '')
    .replace(/([a-z])([A-Z])/gu, '$1 $2');
  return { family, weight, ...(italic ? { italic } : {}) };
}

function defaultState(): State {
  return {
    font: null,
    size: 12,
    spacing: 0,
    bold: false,
    italic: false,
    color: 0,
    outl: false,
    strokeWidth: 0,
    strokeColor: 0,
    shadow: false,
    shadowX: 0,
    shadowY: 0,
    shadowBlur: 0,
    shadowOpacity: null,
    shadowColor: null,
    uc: 1,
    hidden: false,
    align: 'left',
    justified: false,
    lineSpacing: null,
    lineMultiple: false,
    dest: 'text',
    ignorable: false,
  };
}

/** Outlines and shadows off (\plain). */
const NO_DECORATION = {
  outl: false,
  strokeWidth: 0,
  strokeColor: 0,
  shadow: false,
  shadowX: 0,
  shadowY: 0,
  shadowBlur: 0,
  shadowOpacity: null,
  shadowColor: null,
} satisfies Partial<State>;

const sameDecoration = (a: State, b: State) =>
  (Object.keys(NO_DECORATION) as (keyof typeof NO_DECORATION)[]).every((k) => a[k] === b[k]);

/** A colour from the table with an alpha (0 to 1), as #rrggbb or #rrggbbaa. */
function withAlpha(color: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  return a >= 1 ? color : `${color}${hex2(Math.round(a * 255))}`;
}

/**
 * A run's outline: Cocoa's \strokewidth is in twentieths of a percent of the
 * font size (so -40 is 2%), or \outl alone (about 3%). Null when it has none.
 */
function outlineOf(s: State, colors: readonly (string | null)[], textColor: string): Outline | null {
  if (s.strokeWidth === 0 && !s.outl) return null;
  const percent = s.strokeWidth !== 0 ? Math.abs(s.strokeWidth) / 20 : 3;
  const width = Math.round((percent / 100) * s.size * 100) / 100;
  return { color: (s.strokeColor > 0 ? colors[s.strokeColor] : null) ?? textColor, width };
}

/** A run's shadow, in points: Cocoa's offset is upwards, so it is turned over. Null when it has none. */
function shadowOf(s: State, colors: readonly (string | null)[]): Shadow | null {
  if (!s.shadow) return null;
  const twips = (n: number) => Math.round((n / 20) * 100) / 100;
  // Without a colour, Cocoa's own: black at a third.
  const base = s.shadowColor !== null ? (colors[s.shadowColor] ?? '#000000') : '#000000';
  const alpha = s.shadowOpacity !== null ? s.shadowOpacity / 255 : s.shadowColor !== null ? 1 : 1 / 3;
  return {
    color: withAlpha(base, alpha),
    blur: twips(s.shadowBlur),
    x: twips(s.shadowX),
    y: twips(-s.shadowY) || 0,
  };
}

const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isDigit = (c: string) => c >= '0' && c <= '9';
const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function readRtf(input: Uint8Array | string): RtfResult {
  // RTF is 7-bit text with escapes; read any raw 8-bit bytes as single bytes.
  const src = typeof input === 'string' ? input : Buffer.from(input).toString('latin1');
  const n = src.length;

  const fonts = new Map<number, FontEntry>();
  const colors: (string | null)[] = [];
  let defaultFont: number | null = null;
  let defaultCodePage = 1252;
  const unsupported = new Set<string>();
  const usedFonts = new Set<string>();

  // Output
  const runs: { text: string; state: State }[] = [];
  const paragraphs: { align: TextAlign; chars: number; justified: boolean }[] = [];
  let paragraphChars = 0;
  let lineHeight: number | null = null;
  /** Paragraph formatting where text was last written (closing braces reset the state after it). */
  let para = {
    align: 'left' as TextAlign,
    justified: false,
    lineSpacing: null as number | null,
    lineMultiple: false,
  };

  // Parser state
  const stack: State[] = [];
  let st = defaultState();
  let groupStart = false;
  let skipChars = 0;
  let bytes: number[] = [];
  // Font and colour table entries being read
  let fontIndex: number | null = null;
  let fontName = '';
  let fontCharset: number | null = null;
  let fontCodePage: number | null = null;
  let red: number | null = null;
  let green: number | null = null;
  let blue: number | null = null;

  const codePageNow = (): number => {
    const entry = st.font === null ? undefined : fonts.get(st.font);
    return entry?.codePage ?? defaultCodePage;
  };

  const finishFont = () => {
    if (fontIndex !== null && fontName.trim() !== '') {
      fonts.set(fontIndex, {
        name: fontName.trim(),
        codePage: fontCodePage ?? (fontCharset === null ? null : codePageForCharset(fontCharset)),
      });
    }
    fontIndex = null;
    fontName = '';
    fontCharset = null;
    fontCodePage = null;
  };

  const emit = (text: string) => {
    if (text === '') return;
    if (st.dest === 'fonttbl') {
      for (const ch of text) {
        if (ch === ';') finishFont();
        else fontName += ch;
      }
      return;
    }
    if (st.dest === 'colortbl') {
      for (const ch of text) {
        if (ch !== ';') continue;
        colors.push(
          red === null && green === null && blue === null
            ? null
            : `#${hex2(red ?? 0)}${hex2(green ?? 0)}${hex2(blue ?? 0)}`,
        );
        red = green = blue = null;
      }
      return;
    }
    if (st.dest !== 'text' || st.hidden) return;
    const last = runs.at(-1);
    const s = st;
    const same =
      last?.state.font === s.font &&
      last.state.size === s.size &&
      last.state.spacing === s.spacing &&
      last.state.bold === s.bold &&
      last.state.italic === s.italic &&
      last.state.color === s.color &&
      sameDecoration(last.state, s);
    if (same) last.text += text;
    else runs.push({ text, state: { ...s } });
    for (const ch of text) if (ch !== '\n') paragraphChars++;
    para = {
      align: s.align,
      justified: s.justified,
      lineSpacing: s.lineSpacing,
      lineMultiple: s.lineMultiple,
    };
  };

  const flushBytes = () => {
    if (bytes.length === 0) return;
    const decoded = decoderFor(st.dest === 'text' ? codePageNow() : defaultCodePage).decode(
      new Uint8Array(bytes),
    );
    bytes = [];
    emit(decoded);
  };

  const noteLineHeight = (p: { lineSpacing: number | null; lineMultiple: boolean }) => {
    if (lineHeight === null && p.lineSpacing !== null && p.lineMultiple && p.lineSpacing > 0) {
      lineHeight = p.lineSpacing / 240;
    }
  };

  const endParagraph = () => {
    if (st.dest !== 'text' || st.hidden) return;
    paragraphs.push({ align: st.align, chars: paragraphChars, justified: st.justified });
    if (paragraphChars > 0) noteLineHeight(st);
    paragraphChars = 0;
    emit('\n');
  };

  const word = (name: string, param: number | null) => {
    // Destinations start a group: skip the ones that are never slide text.
    if (groupStart) {
      groupStart = false;
      if (name === 'fonttbl') {
        st.dest = 'fonttbl';
        return;
      }
      if (name === 'colortbl') {
        st.dest = 'colortbl';
        return;
      }
      if (SKIP.has(name) || (st.ignorable && !TEXT_DESTINATIONS.has(name) && st.dest === 'text')) {
        st.dest = 'skip';
        return;
      }
    }
    if (st.dest === 'skip') return;
    if (st.dest === 'fonttbl') {
      if (name === 'f') {
        finishFont();
        fontIndex = param ?? 0;
      } else if (name === 'fcharset') fontCharset = param;
      else if (name === 'cpg') fontCodePage = param;
      return;
    }
    if (st.dest === 'colortbl') {
      if (name === 'red') red = param ?? 0;
      else if (name === 'green') green = param ?? 0;
      else if (name === 'blue') blue = param ?? 0;
      return;
    }
    const on = param === null || param !== 0;
    switch (name) {
      case 'ansicpg':
        if (param !== null) defaultCodePage = param;
        return;
      case 'deff':
        defaultFont = param;
        st.font ??= param;
        return;
      case 'plain':
        st.font = defaultFont;
        st.size = 12;
        st.spacing = 0;
        st.bold = false;
        st.italic = false;
        st.color = 0;
        st.hidden = false;
        Object.assign(st, NO_DECORATION);
        return;
      case 'outl':
        st.outl = on;
        return;
      case 'strokewidth':
        st.strokeWidth = param ?? 0;
        return;
      case 'strokec':
        st.strokeColor = param ?? 0;
        return;
      case 'shad':
        st.shadow = on;
        return;
      case 'shadx':
        st.shadowX = param ?? 0;
        return;
      case 'shady':
        st.shadowY = param ?? 0;
        return;
      case 'shadr':
        st.shadowBlur = Math.max(0, param ?? 0);
        return;
      case 'shado':
        st.shadowOpacity = param;
        return;
      case 'shadc':
        st.shadowColor = param;
        return;
      case 'pard':
        st.align = 'left';
        st.justified = false;
        st.lineSpacing = null;
        st.lineMultiple = false;
        return;
      case 'f':
        st.font = param;
        return;
      case 'fs':
        if (param !== null && param > 0) st.size = param / 2;
        return;
      case 'fsmilli':
        if (param !== null && param > 0) st.size = param / 1000;
        return;
      case 'expndtw':
        st.spacing = (param ?? 0) / 20;
        return;
      case 'expnd':
        st.spacing = (param ?? 0) / 4;
        return;
      case 'b':
        st.bold = on;
        return;
      case 'i':
        st.italic = on;
        return;
      case 'v':
        st.hidden = on;
        return;
      case 'cf':
        st.color = param ?? 0;
        return;
      case 'uc':
        st.uc = Math.max(0, param ?? 1);
        return;
      case 'u':
        if (param !== null) {
          emit(String.fromCharCode(param < 0 ? param + 65536 : param));
          skipChars = st.uc;
        }
        return;
      case 'ql':
        st.align = 'left';
        st.justified = false;
        return;
      case 'qc':
        st.align = 'center';
        st.justified = false;
        return;
      case 'qr':
        st.align = 'right';
        st.justified = false;
        return;
      case 'qj':
      case 'qd':
        st.align = 'left';
        st.justified = true;
        return;
      case 'sl':
        st.lineSpacing = param;
        return;
      case 'slmult':
        st.lineMultiple = param === 1;
        return;
      case 'par':
      case 'sect':
      case 'page':
        endParagraph();
        return;
    }
    const symbol = SYMBOLS[name];
    if (symbol !== undefined) {
      emit(symbol);
      return;
    }
    const feature = UNSUPPORTED[name];
    if (feature && !st.hidden && param !== (OFF_VALUE[name] ?? 0)) unsupported.add(feature);
  };

  let i = 0;
  while (i < n) {
    const c = src.charAt(i);
    if (c === '{') {
      flushBytes();
      stack.push(st);
      st = { ...st, ignorable: false };
      groupStart = true;
      skipChars = 0;
      i++;
      continue;
    }
    if (c === '}') {
      flushBytes();
      if (st.dest === 'fonttbl') finishFont();
      st = stack.pop() ?? st;
      groupStart = false;
      skipChars = 0;
      i++;
      continue;
    }
    if (c === '\\') {
      const next = src.charAt(i + 1);
      if (isLetter(next)) {
        let j = i + 1;
        while (j < n && isLetter(src.charAt(j))) j++;
        const name = src.slice(i + 1, j);
        let k = j;
        if (src.charAt(k) === '-' && isDigit(src.charAt(k + 1))) k++;
        while (k < n && isDigit(src.charAt(k))) k++;
        const param = k > j ? Number(src.slice(j, k)) : null;
        if (src.charAt(k) === ' ') k++;
        i = k;
        if (name === 'bin') {
          flushBytes();
          i += Math.max(0, param ?? 0);
          continue;
        }
        flushBytes();
        word(name, param);
        continue;
      }
      if (next === "'") {
        const value = parseInt(src.slice(i + 2, i + 4), 16);
        i += 4;
        groupStart = false;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        if (!Number.isNaN(value) && st.dest !== 'skip') bytes.push(value);
        continue;
      }
      // Control symbols
      i += 2;
      if (next === '*') {
        st.ignorable = true;
        continue;
      }
      groupStart = false;
      flushBytes();
      if (skipChars > 0) {
        skipChars--;
        continue;
      }
      if (next === '\\' || next === '{' || next === '}') emit(next);
      else if (next === '~') emit(' ');
      else if (next === '_') emit('‑');
      else if (next === '\n' || next === '\r') endParagraph();
      // \- (optional hyphen), \| and \: are dropped.
      continue;
    }
    if (c === '\r' || c === '\n') {
      i++;
      continue;
    }
    groupStart = false;
    // Plain text up to the next special character.
    let j = i;
    while (j < n) {
      const d = src.charAt(j);
      if (d === '\\' || d === '{' || d === '}' || d === '\r' || d === '\n') break;
      j++;
    }
    let text = src.slice(i, j);
    i = j;
    if (skipChars > 0) {
      const skipped = Math.min(skipChars, text.length);
      text = text.slice(skipped);
      skipChars -= skipped;
    }
    flushBytes();
    // Raw 8-bit bytes in the text are in the current code page too.
    const decoded = /[\x80-\xff]/u.test(text)
      ? decoderFor(codePageNow()).decode(Uint8Array.from(text, (ch) => ch.charCodeAt(0)))
      : text;
    emit(decoded);
  }
  flushBytes();
  if (paragraphChars > 0) {
    paragraphs.push({ align: para.align, chars: paragraphChars, justified: para.justified });
    noteLineHeight(para);
  }

  // Runs, without the breaks after the last paragraph.
  const out: TextRun[] = [];
  for (const run of runs) {
    const s = run.state;
    const entry = s.font === null ? undefined : fonts.get(s.font);
    const face = entry ? fontFace(entry.name) : null;
    if (entry && run.text.trim() !== '') usedFonts.add(entry.name);
    const r: TextRun = { text: run.text, size: s.size, weight: s.bold ? 700 : (face?.weight ?? 400) };
    if (face) r.font = face.family;
    if (s.italic || face?.italic) r.italic = true;
    if (s.spacing !== 0) r.letterSpacing = s.spacing;
    // An empty colour-table entry means "automatic"; some writers start the table with a real colour.
    const color = colors[s.color];
    if (color) r.color = color;
    const outline = outlineOf(s, colors, color ?? '#000000');
    if (outline) r.outline = outline;
    // Hollow letters (a stroke without the fill) show filled, with the outline.
    if (outline && s.strokeWidth > 0 && run.text.trim() !== '') unsupported.add('hollow letters');
    const shadow = shadowOf(s, colors);
    if (shadow) r.shadow = shadow;
    out.push(r);
  }
  while (out.length > 0) {
    const last = out.at(-1);
    if (!last) break;
    const trimmed = last.text.replace(/\n+$/u, '');
    if (trimmed === '') out.pop();
    else {
      last.text = trimmed;
      break;
    }
  }
  const merged = mergeRuns(out);

  // The alignment most of the text has.
  const byAlign = new Map<TextAlign, number>();
  let justified = false;
  for (const p of paragraphs) {
    if (p.chars === 0) continue;
    byAlign.set(p.align, (byAlign.get(p.align) ?? 0) + p.chars);
    if (p.justified) justified = true;
  }
  let align: TextAlign | null = null;
  let most = 0;
  for (const [a, count] of byAlign) {
    if (count > most) [align, most] = [a, count];
  }
  if (justified) unsupported.add('justified alignment');

  return {
    runs: merged,
    text: merged.map((r) => r.text).join(''),
    align,
    lineHeight,
    fonts: [...usedFonts],
    unsupported: [...unsupported].sort(),
  };
}
