import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDuration } from '../shared/format';
import type { ManualPrinted } from '../shared/manual';
import { playlistTotals } from '../shared/playlist-playback';
import { type PlaylistItemInfo, slotCategoryName } from '../shared/playlists';
import { plural } from '../shared/text';
import { escapeHtml, type PrintOutcome, printerBusy, printPage, takePrinter } from './manual-print';
import { fileProblem } from './plain-errors';

/*
 * A playlist's running order (alpha.22, from PLAN §7's "Print": seen, not added; the owner's "Yes, build them", 24 Nov
 * 2026), for the sanchalak, the anchor and the sound desk before a sabha: copied as plain lines for the team's group
 * chat (Copy running order), or printed and saved as a PDF (Print running order…, Save running order as PDF…). Made
 * from the playlist's rows as the main process reads them; it only reads, and nothing in it touches the show.
 */

/** A playlist's name and its rows, in its order. */
export interface RunningOrderSource {
  name: string;
  items: readonly PlaylistItemInfo[];
}

/** A row of the running order: a header as a section's title, or a numbered row. */
export type RunningOrderRow =
  | { kind: 'header'; title: string }
  | {
      kind: 'row';
      number: number;
      /** What it is, in a word or two (as its card says). */
      what: string;
      /** Its name; for a slot, what the slot asks for. */
      label: string;
      /** A video's or a sound's length between its points ("3:05"); null for any other row, or when not known yet. */
      length: string | null;
      /** A video's or a sound's length, not known yet. */
      lengthUnknown: boolean;
      /** A presentation's slides, when known. */
      slides: number | null;
    };

/** Words on one line: a name never breaks a row in two. */
const oneLine = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** What a row is, in a word or two (the open playlist's cards say the same). */
function whatOf(item: Exclude<PlaylistItemInfo, { kind: 'header' }>): string {
  switch (item.kind) {
    case 'presentation':
      return item.deck ? 'Deck' : 'Presentation';
    case 'media':
      return item.media === 'image' ? 'Picture' : item.media === 'video' ? 'Video' : 'Sound';
    case 'shastra':
      return 'Passage from a book';
    case 'placeholder':
      return item.hint === null ? 'Slot to fill' : 'Not found at import';
    case 'input':
      return 'Video input';
  }
}

/** The running order's rows: headers as section titles, every other row numbered from 1 in the playlist's order. */
export function runningOrderRows(items: readonly PlaylistItemInfo[]): RunningOrderRow[] {
  let number = 0;
  return items.map((item): RunningOrderRow => {
    if (item.kind === 'header') return { kind: 'header', title: oneLine(item.label) };
    number++;
    const timed = item.kind === 'media' && item.media !== 'image';
    const length = timed ? (item.playingMs ?? item.durationMs ?? null) : null;
    const label =
      item.kind === 'placeholder' && item.hint === null && item.category
        ? `${oneLine(item.label)} (${slotCategoryName(item.category)})`
        : oneLine(item.label);
    return {
      kind: 'row',
      number,
      what: whatOf(item),
      label,
      length: length === null ? null : formatDuration(length),
      lengthUnknown: timed && length === null,
      slides: item.kind === 'presentation' ? (item.slideCount ?? null) : null,
    };
  });
}

/** The videos' and sounds' time in all, between their points, and how many lengths are not known yet; null for none. */
export function runningOrderTotal(items: readonly PlaylistItemInfo[]): string | null {
  const totals = playlistTotals(items);
  const timed = items.some((i) => i.kind === 'media' && i.media !== 'image');
  if (!timed) return null;
  const unknown = totals.unknown ? ` (${plural(totals.unknown, 'length')} not known yet)` : '';
  return `${formatDuration(totals.durationMs)}${unknown}`;
}

/**
 * Copy running order's plain lines: the playlist's name, each header as "— Dhun —", every other row numbered with
 * its length where it has one ("2. Placeholder video, 3:05"), a slot as what it asks for, then the videos' and sounds'
 * time in all.
 */
export function runningOrderLines(source: RunningOrderSource): string {
  const lines = [oneLine(source.name)];
  const rows = runningOrderRows(source.items);
  if (rows.length === 0) lines.push('This playlist is empty.');
  for (const row of rows) {
    if (row.kind === 'header') {
      lines.push(`— ${row.title} —`);
      continue;
    }
    const name =
      row.what === 'Slot to fill' || row.what === 'Not found at import'
        ? `${row.what}: ${row.label}`
        : row.label;
    const length = row.lengthUnknown ? 'length not known yet' : row.length;
    lines.push(`${String(row.number)}. ${name}${length ? `, ${length}` : ''}`);
  }
  const total = runningOrderTotal(source.items);
  if (total !== null) lines.push(`Videos and sounds in all: ${total}`);
  return lines.join('\n');
}

/**
 * The page's look: plain, black on white, A4, a section's title kept with its first rows, a row never split. Its
 * columns: the number, the name, what it is, its length.
 */
const STYLE = `
  html { color-scheme: light; }
  body { margin: 0; color: #111; background: #fff;
    font: 11pt/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 20pt; margin: 0 0 1mm; }
  .line { font-size: 10.5pt; color: #333; margin: 0 0 6mm; }
  h2 { font-size: 13pt; margin: 6mm 0 1.5mm; break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 2mm; }
  td { border-bottom: 0.3mm solid #ccc; padding: 1.4mm 2mm; text-align: left; vertical-align: top; }
  td:first-child { width: 9mm; color: #555; text-align: right; font-variant-numeric: tabular-nums; }
  td:nth-child(3) { width: 42mm; color: #333; }
  td:nth-child(4) { width: 26mm; text-align: right; font-variant-numeric: tabular-nums; }
  tr { break-inside: avoid; }
  .total { margin: 5mm 0 0; font-weight: 600; }
`;

/** A row's last column: its length, or its slides. */
function sizeOf(row: Extract<RunningOrderRow, { kind: 'row' }>): string {
  if (row.length !== null) return row.length;
  if (row.lengthUnknown) return 'not known yet';
  return row.slides === null ? '' : plural(row.slides, 'slide');
}

const rowHtml = (row: Extract<RunningOrderRow, { kind: 'row' }>): string =>
  `<tr><td>${String(row.number)}</td><td>${escapeHtml(row.label)}</td>` +
  `<td>${escapeHtml(row.what)}</td><td>${escapeHtml(sizeOf(row))}</td></tr>`;

/**
 * The running order as one page to print: the playlist's name and the date (`printed`, in words), each header as a
 * section's title over its rows, every other row numbered with what it is and its length (or slides), then the
 * videos' and sounds' time in all. Every word is escaped; the page holds no script and loads nothing.
 */
export function runningOrderHtml(p: RunningOrderSource & { printed: string }): string {
  const rows = runningOrderRows(p.items);
  const parts: string[] = [];
  // The rows since the last header (or the start), as one table.
  let table: string[] = [];
  const endTable = () => {
    if (table.length) parts.push(`<table><tbody>${table.join('')}</tbody></table>`);
    table = [];
  };
  for (const row of rows) {
    if (row.kind === 'header') {
      endTable();
      parts.push(`<h2>${escapeHtml(row.title)}</h2>`);
    } else table.push(rowHtml(row));
  }
  endTable();
  if (rows.length === 0) parts.push('<p>This playlist is empty.</p>');
  const total = runningOrderTotal(p.items);
  if (total !== null) parts.push(`<p class="total">Videos and sounds in all: ${escapeHtml(total)}</p>`);
  const name = escapeHtml(oneLine(p.name));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${name} running order</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${name}</h1>
<p class="line">Running order · ${escapeHtml(p.printed)}</p>
${parts.join('\n')}
</body>
</html>
`;
}

/** The main process's answer to Print or Save as PDF while the show is live. */
export const RUNNING_ORDER_PRINT_REFUSED =
  'Print or save the running order when nothing is up, on air or recording: clear what is up, and end the stream and the recording first.';

/** The running order's name for the printer (another print asked for meanwhile is told it is busy with this). */
const RUNNING_ORDER = 'A running order';

/** The PDF's name the save dialog suggests: the playlist's, with what a file name cannot hold made "_". */
export const runningOrderPdfName = (name: string): string =>
  `${oneLine(name).replace(/[\\/:*?"<>|]/gu, '_')} running order.pdf`;

export interface RunningOrderPrinterDeps {
  /** The playlist's name and rows now (index.ts: one of the operator's playlists), or null when there is none. */
  source: (playlistId: string) => RunningOrderSource | null;
  /** Today's date, in words, as this computer writes it. */
  printed: () => string;
  /** Where the page to print is written for a moment (a folder of its own is made in it, and taken away after). */
  tempDir: () => string;
  /** The system's save dialog: the file chosen, or null when the person cancelled. `suggested` is the full path. */
  askWhere: (suggested: string) => Promise<string | null>;
  /** Where the save dialog suggests first (Documents). */
  suggestedFolder: () => string;
  /** Printing itself (manual-print.ts; a test's stand-in). */
  print?: typeof printPage;
  write?: (file: string, data: Buffer) => void;
  /** Whether the show is live now (anything up, or the stream on air or recording), as the manual's printing asks. */
  live: () => boolean;
}

const GONE: ManualPrinted = { ok: false, cancelled: false, message: 'That playlist no longer exists.' };

/**
 * Print running order… and Save running order as PDF…: from a hidden window as the manual is, one page at a time
 * across both (manual-print.ts's `takePrinter`), and only while the show is not live.
 */
export class RunningOrderPrinter {
  constructor(private readonly deps: RunningOrderPrinterDeps) {}

  /** Through the system's print dialog. */
  async print(playlistId: string): Promise<ManualPrinted> {
    return this.once(playlistId, async (source) => {
      const made = await this.run(source, 'print');
      if (made.ok) return { ok: true, file: null };
      if (made.cancelled) return { ok: false, cancelled: true };
      return {
        ok: false,
        cancelled: false,
        message:
          'The running order was not printed: check the printer is on and chosen, then choose Print running order… again.',
      };
    });
  }

  /** Saved as a PDF where the person chooses. */
  async pdf(playlistId: string): Promise<ManualPrinted> {
    return this.once(playlistId, async (source) => {
      const where = await this.deps.askWhere(
        join(this.deps.suggestedFolder(), runningOrderPdfName(source.name)),
      );
      if (where === null) return { ok: false, cancelled: true };
      const made = await this.run(source, 'pdf');
      if (!made.ok || made.pdf === null)
        return {
          ok: false,
          cancelled: false,
          message: 'The running order was not made into a PDF: choose Save running order as PDF… again.',
        };
      try {
        (this.deps.write ?? writeFileSync)(where, made.pdf);
      } catch (error) {
        return { ok: false, cancelled: false, message: fileProblem(error, 'write') };
      }
      return { ok: true, file: where };
    });
  }

  private async once(
    playlistId: string,
    run: (source: RunningOrderSource) => Promise<ManualPrinted>,
  ): Promise<ManualPrinted> {
    // Nothing printed, and nothing asked, while the show is live.
    if (this.deps.live()) return { ok: false, cancelled: false, message: RUNNING_ORDER_PRINT_REFUSED };
    const source = this.deps.source(playlistId);
    if (source === null) return GONE;
    const printer = takePrinter(RUNNING_ORDER);
    if ('heldBy' in printer) return { ok: false, cancelled: false, message: printerBusy(printer.heldBy) };
    try {
      return await run(source);
    } finally {
      printer.release();
    }
  }

  /** The page made and printed. */
  private async run(source: RunningOrderSource, kind: 'pdf' | 'print'): Promise<PrintOutcome> {
    const name = oneLine(source.name);
    try {
      return await (this.deps.print ?? printPage)({
        html: runningOrderHtml({ ...source, printed: this.deps.printed() }),
        pictures: [],
        tempDir: this.deps.tempDir(),
        kind,
        title: `${name} running order`,
        footer: `${name} · running order`,
      });
    } catch {
      return { ok: false, cancelled: false, why: 'it could not be printed' };
    }
  }
}
