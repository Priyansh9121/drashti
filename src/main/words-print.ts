import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lang } from '../shared/model';
import { WORDS_PRINT_REFUSED, type WordsPrinted } from '../shared/words-print';
import type { ContentRows } from './db/content';
import { detailsOf, trackSlidesOf } from './library/tracks';
import { escapeHtml, type PrintOutcome } from './manual-print';
import { fileProblem } from './plain-errors';

/*
 * A singers' sheet (alpha.22, scout2's candidate 3; the owner's "Yes, build them", 24 Nov 2026): Print words… and Save
 * words as PDF… of a presentation in the library's right-click menu (Pro Mode). The page shows every slide that plays,
 * group by group (Verse, Chorus…), each slide's lines in the presentation's language tracks in its own order (as the
 * words editor reads them: library/tracks.ts), and a kirtan's kavi and raag under its name. It is printed from the
 * Manual's hidden window (manual-print.ts): no script, nothing loaded, every word escaped. Words typed in an old
 * (legacy) font are in no track: the sheet says how many slides have them instead of printing letters that would not
 * read. Gujarati and Devanagari are drawn by the system's own fonts there.
 */

/** One slide's words: each language's lines, in the presentation's track order. */
export type SheetVerse = { lang: Lang; lines: string[] }[];

/** What the sheet shows, read from the library. */
export interface WordsSheet {
  name: string;
  /** A kirtan's poet and raag (null for none, or for a presentation that is no kirtan). */
  kavi: string | null;
  raag: string | null;
  /** The languages on the sheet, in the presentation's own order (only those some slide has words in). */
  langs: Lang[];
  /** The groups with words, in order; each slide with words, in order. */
  groups: { name: string; verses: SheetVerse[] }[];
  /** How many slides have words in an old font (not on the sheet). */
  legacy: number;
}

const detail = (text: string | null): string | null => {
  const t = text?.trim() ?? '';
  return t === '' ? null : t;
};

/** The sheet of a presentation's words, or null when no slide that plays has any. */
export function wordsSheet(name: string, rows: ContentRows): WordsSheet | null {
  const { slides, order } = trackSlidesOf(rows);
  const has = (lines: readonly string[] | undefined) => (lines ?? []).length > 0;
  const langs = order.filter((lang) => slides.some((s) => has(s.lines[lang])));
  const groupOf = new Map(rows.slides.map((s) => [s.id, s.group_id]));
  const groups: { id: string; name: string; verses: SheetVerse[] }[] = [];
  for (const slide of slides) {
    const id = groupOf.get(slide.slideId) ?? '';
    let group = groups.at(-1);
    if (group?.id !== id) {
      group = { id, name: slide.groupName, verses: [] };
      groups.push(group);
    }
    const verse = langs.flatMap((lang) => {
      const lines = slide.lines[lang] ?? [];
      return lines.length > 0 ? [{ lang, lines: [...lines] }] : [];
    });
    if (verse.length > 0) group.verses.push(verse);
  }
  const withWords = groups.filter((g) => g.verses.length > 0).map((g) => ({ name: g.name, verses: g.verses }));
  if (withWords.length === 0) return null;
  const details = detailsOf(rows);
  return {
    name,
    kavi: detail(details?.kavi ?? null),
    raag: detail(details?.raag ?? null),
    langs,
    groups: withWords,
    legacy: slides.filter((s) => s.legacy).length,
  };
}

/** A transliteration's `lang`: the Latin letters of the presentation's first Gujarati, Hindi or Sanskrit track. */
function translitTag(langs: readonly Lang[]): string {
  const source = langs.find((l) => l === 'gu' || l === 'hi' || l === 'sa' || l === 'sa-gu');
  return `${source === 'hi' ? 'hi' : source === 'sa' || source === 'sa-gu' ? 'sa' : 'gu'}-Latn`;
}

/** Each language's `lang` in the page (as the screens' own: render/fonts.ts), so its letters take the right font. */
function htmlLang(lang: Lang, langs: readonly Lang[]): string {
  if (lang === 'translit') return translitTag(langs);
  return lang === 'sa-gu' ? 'sa-Gujr' : lang;
}

/** The page's look: plain, black on white, A4; a group's heading never alone at a page's foot, a slide never split. */
const STYLE = `
  html { color-scheme: light; }
  body { margin: 0; color: #111; background: #fff;
    font: 12pt/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 20pt; line-height: 1.3; margin: 0 0 1.5mm; }
  .details { font-size: 11pt; color: #333; margin: 0 0 2mm; }
  .note { font-size: 10pt; color: #555; margin: 0 0 2mm; }
  header { margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 0.3mm solid #bbb; }
  h2 { font-size: 13pt; margin: 6mm 0 2.5mm; break-after: avoid; }
  .verse { margin: 0 0 4.5mm; break-inside: avoid; }
  .verse p { margin: 0 0 1mm; }
  .t-gu, .t-sa-gu { font-family: "Gujarati Sangam MN", "Kohinoor Gujarati", "Nirmala UI", Shruti, sans-serif;
    font-size: 14pt; }
  .t-hi, .t-sa { font-family: "Kohinoor Devanagari", "Devanagari Sangam MN", "Nirmala UI", Mangal, sans-serif;
    font-size: 14pt; }
  .t-translit { font-style: italic; }
  .t-en { font-size: 11pt; color: #333; }
`;

/** The sheet as one page to print (Print words… or Save words as PDF…). */
export function wordsHtml(sheet: WordsSheet): string {
  const details = [
    sheet.kavi === null ? null : `Kavi: ${escapeHtml(sheet.kavi)}`,
    sheet.raag === null ? null : `Raag: ${escapeHtml(sheet.raag)}`,
  ].filter((d) => d !== null);
  const note =
    sheet.legacy === 0
      ? ''
      : `<p class="note">${String(sheet.legacy)} ${sheet.legacy === 1 ? 'slide has' : 'slides have'} words in an old font: they are not on this sheet.</p>\n`;
  const groups = sheet.groups
    .map((g) => {
      const heading = g.name.trim() === '' ? '' : `<h2>${escapeHtml(g.name)}</h2>\n`;
      const verses = g.verses
        .map((verse) => {
          const parts = verse
            .map(
              ({ lang, lines }) =>
                `<p class="t-${lang}" lang="${htmlLang(lang, sheet.langs)}">${lines.map(escapeHtml).join('<br>')}</p>`,
            )
            .join('');
          return `<div class="verse">${parts}</div>`;
        })
        .join('\n');
      return `<section>\n${heading}${verses}\n</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(sheet.name)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(sheet.name)}</h1>
${details.length > 0 ? `<p class="details">${details.join(' · ')}</p>\n` : ''}${note}</header>
${groups}
</body>
</html>
`;
}

/** The footer on every page of the sheet's PDF: its name and the page (Chromium fills in the numbers). */
export function wordsFooter(name: string): string {
  return (
    '<div style="width:100%;font-size:8px;color:#555;text-align:center;font-family:sans-serif">' +
    `${escapeHtml(name)} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`
  );
}

/** The PDF's name the save dialog suggests: the presentation's, with what no file name may hold made "_". */
export function wordsPdfName(name: string): string {
  return `${name.replace(/[\\/:*?"<>|]/gu, '_')} words.pdf`;
}

/** A page to print from the hidden window: the sheet, its title and its PDF's footer (manual-print.ts). */
export interface WordsPrintJob {
  html: string;
  /** Files the page may load: none (the sheet shows no picture). */
  pictures: readonly string[];
  tempDir: string;
  kind: 'pdf' | 'print';
  title: string;
  footer: string;
}

export interface WordsPrinterDeps {
  /** A presentation's name and content, or null when it is no longer in the library. */
  read: (presentationId: string) => { name: string; rows: ContentRows } | null;
  /**
   * Whether the show is live now (anything up, or the stream on air or recording: index.ts, as for the Manual's
   * print): nothing is printed then, and nothing asked (the lead's call of 20 Nov 2026).
   */
  live: () => boolean;
  /** Where the page to print is written for a moment (a folder of its own is made in it, and taken away after). */
  tempDir: () => string;
  /** The system's save dialog: the file chosen, or null when the person cancelled. `suggested` is the full path. */
  askWhere: (suggested: string) => Promise<string | null>;
  /** Where the save dialog suggests first (Documents). */
  suggestedFolder: () => string;
  /** Printing itself (the Manual's hidden window, manual-print.ts; a test's stand-in). */
  print: (job: WordsPrintJob) => Promise<PrintOutcome>;
  write?: (file: string, data: Buffer) => void;
}

const fail = (message: string): WordsPrinted => ({ ok: false, cancelled: false, message });
const GONE = fail('That presentation is no longer in the library.');
const BUSY = fail('Something is being printed already: wait until that is done, then try again.');
const NOT_PRINTED = fail(
  'The words were not printed: check the printer is on and chosen, then press Print words… again.',
);
const NO_PDF = fail('The words were not made into a PDF: press Save words as PDF… again.');
const noWords = (name: string) => fail(`“${name}” has no words to print: none of its slides that play has any.`);

/** Print words… and Save words as PDF…, one at a time, and only while the show is not live. */
export class WordsPrinter {
  private busy = false;

  constructor(private readonly deps: WordsPrinterDeps) {}

  /** Through the system's print dialog. */
  async print(presentationId: string): Promise<WordsPrinted> {
    return this.once(presentationId, async (page) => {
      const made = await this.run(page, 'print');
      if (made.ok) return { ok: true, file: null };
      return made.cancelled ? { ok: false, cancelled: true } : NOT_PRINTED;
    });
  }

  /** Saved as a PDF where the person chooses. */
  async pdf(presentationId: string): Promise<WordsPrinted> {
    return this.once(presentationId, async (page) => {
      const where = await this.deps.askWhere(join(this.deps.suggestedFolder(), wordsPdfName(page.name)));
      if (where === null) return { ok: false, cancelled: true };
      const made = await this.run(page, 'pdf');
      if (!made.ok || made.pdf === null) return NO_PDF;
      try {
        (this.deps.write ?? writeFileSync)(where, made.pdf);
      } catch (error) {
        return fail(fileProblem(error, 'write'));
      }
      return { ok: true, file: where };
    });
  }

  private async once(
    presentationId: string,
    go: (page: { name: string; html: string }) => Promise<WordsPrinted>,
  ): Promise<WordsPrinted> {
    // Nothing printed, and nothing asked, while the show is live.
    if (this.deps.live()) return fail(WORDS_PRINT_REFUSED);
    if (this.busy) return BUSY;
    const found = this.deps.read(presentationId);
    if (!found) return GONE;
    const sheet = wordsSheet(found.name, found.rows);
    if (!sheet) return noWords(found.name);
    this.busy = true;
    try {
      return await go({ name: found.name, html: wordsHtml(sheet) });
    } finally {
      this.busy = false;
    }
  }

  private async run(page: { name: string; html: string }, kind: 'pdf' | 'print'): Promise<PrintOutcome> {
    try {
      return await this.deps.print({
        html: page.html,
        pictures: [],
        tempDir: this.deps.tempDir(),
        kind,
        title: page.name,
        footer: wordsFooter(page.name),
      });
    } catch {
      return { ok: false, cancelled: false, why: 'it could not be printed' };
    }
  }
}
