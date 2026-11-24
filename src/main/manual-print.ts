import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import type { Block, Inline } from '../shared/markdown';

/*
 * The Drashti Manual on paper (x37, Session 60): Print… and Save as PDF… in the manual. The whole manual is written
 * as one page, each chapter from a new page, its pictures in, and printed from a hidden window of its own, as the
 * setup kit's printout is made (Electron's printToPDF): sandboxed, no preload, a session of its own that refuses
 * every request but the page itself and the pictures the manual shows (files beside the app), no download, no
 * permission, no window it could open. The page holds no script, and its words are only ever text: each is escaped.
 * Nothing in it touches the show.
 *
 * Since alpha.22 a playlist's running order (main/running-order.ts) and a kirtan's words (main/words-print.ts) are
 * printed the same way: each page names its own title and footer, and one page is printed at a time across all three,
 * as the page's allowed files are one set (`takePrinter`). When they wait: shared/print-waits.ts.
 */

/** A chapter, read, for the page. */
export interface PrintChapter {
  title: string;
  blocks: readonly Block[];
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
/** Words as text in a page, never as markup. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/gu, (c) => ESCAPES[c] ?? c);

/** The page's look: plain, black on white, A4, a chapter to a new page, a picture never split. */
const STYLE = `
  html { color-scheme: light; }
  body { margin: 0; color: #111; background: #fff;
    font: 10.5pt/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .cover { padding-top: 60mm; }
  .cover .title { font-size: 28pt; font-weight: 700; margin: 0 0 4mm; }
  .cover .line { font-size: 12pt; color: #333; margin: 0 0 12mm; }
  .cover ol { font-size: 12pt; line-height: 1.8; }
  .chapter { break-before: page; }
  h1 { font-size: 20pt; margin: 0 0 4mm; }
  h2 { font-size: 13pt; margin: 7mm 0 2mm; break-after: avoid; }
  h3 { font-size: 11pt; margin: 5mm 0 2mm; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  p { margin: 0 0 2.2mm; }
  ol, ul { margin: 0 0 2.5mm; padding-left: 7mm; }
  li { margin: 0 0 1mm; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.92em; }
  img { display: block; max-width: 100%; max-height: 110mm; margin: 2mm 0 4mm; border: 0.3mm solid #bbb;
    border-radius: 1.5mm; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 2mm 0 4mm; font-size: 9.5pt; break-inside: auto; }
  th, td { border-bottom: 0.3mm solid #ccc; padding: 1.2mm 2mm; text-align: left; vertical-align: top; }
  tr { break-inside: avoid; }
  hr { border: 0; border-top: 0.3mm solid #ccc; margin: 4mm 0; }
`;

function inlines(items: readonly Inline[], picture: (src: string) => string | null): string {
  return items
    .map((n) => {
      if (n.kind === 'text') return escapeHtml(n.text);
      if (n.kind === 'strong') return `<strong>${inlines(n.children, picture)}</strong>`;
      if (n.kind === 'code') return `<code>${escapeHtml(n.text)}</code>`;
      const url = picture(n.src);
      return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(n.alt)}">` : escapeHtml(n.alt);
    })
    .join('');
}

function blocksHtml(blocks: readonly Block[], picture: (src: string) => string | null): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'heading': {
          const tag = b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3';
          return `<${tag}>${inlines(b.children, picture)}</${tag}>`;
        }
        case 'paragraph':
          return `<p>${inlines(b.children, picture)}</p>`;
        case 'rule':
          return '<hr>';
        case 'table': {
          const head = b.head.some((c) => c.length > 0)
            ? `<thead><tr>${b.head.map((c) => `<th>${inlines(c, picture)}</th>`).join('')}</tr></thead>`
            : '';
          const rows = b.rows
            .map((r) => `<tr>${r.cells.map((c) => `<td>${inlines(c, picture)}</td>`).join('')}</tr>`)
            .join('');
          return `<table>${head}<tbody>${rows}</tbody></table>`;
        }
        case 'list': {
          const items = b.items
            .map((item) => {
              const box = item.task === null ? '' : item.task === 'done' ? '☑ ' : '☐ ';
              return `<li>${box}${blocksHtml(item.blocks, picture)}</li>`;
            })
            .join('');
          return b.ordered
            ? `<ol${b.start === 1 ? '' : ` start="${String(b.start)}"`}>${items}</ol>`
            : `<ul>${items}</ul>`;
        }
      }
    })
    .join('\n');
}

/**
 * The whole manual as one page: a cover with the chapters' list, then each chapter from a new page. `picture` gives a
 * picture's address in the page (its file's), or null to show its description instead.
 */
export function manualHtml(p: {
  chapters: readonly PrintChapter[];
  version: string;
  picture: (src: string) => string | null;
}): string {
  const contents = p.chapters.map((c) => `<li>${escapeHtml(c.title)}</li>`).join('');
  const chapters = p.chapters
    .map((c) => `<section class="chapter">\n${blocksHtml(c.blocks, p.picture)}\n</section>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:; style-src 'unsafe-inline'">
<title>Drashti Manual</title>
<style>${STYLE}</style>
</head>
<body>
<div class="cover">
<p class="title">Drashti Manual</p>
<p class="line">How to use every part of Drashti, for version ${escapeHtml(p.version)}.</p>
<ol>${contents}</ol>
</div>
${chapters}
</body>
</html>
`;
}

/** The footer on every page of the PDF: its words ("Drashti Manual"), escaped, and the page (Chromium fills it in). */
export const pdfFooter = (words: string): string =>
  '<div style="width:100%;font-size:8px;color:#555;text-align:center;font-family:sans-serif">' +
  `${escapeHtml(words)} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

const inch = (mm: number) => mm / 25.4;

/** printToPDF's choices: A4, with room for the footer. */
export const pdfOptions = (footer: string) =>
  ({
    pageSize: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: pdfFooter(footer),
    margins: { top: inch(16), bottom: inch(18), left: inch(16), right: inch(16) },
    preferCSSPageSize: false,
  }) as const;

/** The partition of the printing window: in memory only (no "persist:"), its own, never the show's. */
const PRINT_PARTITION = 'drashti-manual-print';

/** The files the page being printed may load now: one page at a time, across every printer (`takePrinter`). */
let mayLoad: ReadonlySet<string> = new Set();
/** A page is being printed now (its window open, `mayLoad` its own). */
let pageOpen = false;
let printSession: Electron.Session | null = null;

/** Who holds the printer now ("The manual", "A running order", a kirtan's words), or null. */
let holder: string | null = null;

/**
 * The printer, taken for one print, from its first question (the save dialog) to its end: across the manual, every
 * running order and every sheet of words, one at a time, as the page's allowed files are one set. `who` names the print ("The manual"); the
 * answer is the way to give it back (once is enough), or who holds it now.
 */
export function takePrinter(who: string): { release: () => void } | { heldBy: string } {
  if (holder !== null) return { heldBy: holder };
  holder = who;
  let given = false;
  return {
    release: () => {
      if (given) return;
      given = true;
      holder = null;
    },
  };
}

/** The words for a print asked for while another holds the printer. */
export const printerBusy = (heldBy: string): string =>
  `${heldBy} is being printed already: wait until that is done, then try again.`;

/** The printing window's session, its rules set once: only `mayLoad`, no permission, no download. */
function printingSession(): Electron.Session {
  if (printSession) return printSession;
  const made = session.fromPartition(PRINT_PARTITION, { cache: false });
  made.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !printRequestAllowed(details.url, mayLoad) });
  });
  made.setPermissionCheckHandler(() => false);
  made.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  made.on('will-download', (event) => {
    event.preventDefault();
  });
  printSession = made;
  return made;
}

/** Whether a request from the printing page may go: only the page's own file, and the pictures named. */
export function printRequestAllowed(url: string, allowed: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.search !== '' || parsed.hash !== '') return false;
    return allowed.has(realpathSync(fileURLToPath(parsed)));
  } catch {
    return false;
  }
}

/** A picture's address for the page: its file's (it must be one the page may load: see `printPage`). */
export const fileAddress = (path: string): string => pathToFileURL(path).href;

export type PrintOutcome = { ok: true; pdf: Buffer | null } | { ok: false; cancelled: boolean; why: string };

/** A page to print from a hidden window: its words, the files it shows, and what it is called. */
export interface PrintPage {
  html: string;
  /** The files the page shows (each its full path): nothing else may load. */
  pictures: readonly string[];
  /** Where the page is written for a moment (a folder of its own is made in it, and taken away after). */
  tempDir: string;
  kind: 'pdf' | 'print';
  /** The hidden window's title ("Drashti Manual"). */
  title: string;
  /** The words in the PDF's footer, before its page number ("Drashti Manual"). */
  footer: string;
}

/**
 * Print a page (`html`: the manual's, a running order's) from a hidden window: as a PDF (its bytes), or through the
 * system's print dialog. Only one page at a time: another, asked for meanwhile, is not printed (`takePrinter` keeps
 * the asking to one at a time first).
 */
export async function printPage(p: PrintPage): Promise<PrintOutcome> {
  if (pageOpen) return { ok: false, cancelled: false, why: 'another page is being printed' };
  const folder = mkdtempSync(join(p.tempDir, 'drashti-print-'));
  pageOpen = true;
  const page = join(folder, 'page.html');
  let win: BrowserWindow | null = null;
  try {
    writeFileSync(page, p.html, 'utf8');
    const allowed = new Set<string>([realpathSync(page)]);
    for (const file of p.pictures) {
      try {
        allowed.add(realpathSync(file));
      } catch {
        // A picture not there: the page shows its description (it is never allowed by another name).
      }
    }
    mayLoad = allowed;
    const printing = printingSession();
    win = new BrowserWindow({
      show: false,
      focusable: false,
      skipTaskbar: true,
      width: 900,
      height: 1200,
      title: p.title,
      webPreferences: {
        session: printing,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    const contents = win.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadFile(page);
    // Only then: nothing in it may take it anywhere else.
    contents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    contents.on('will-redirect', (event) => {
      event.preventDefault();
    });
    contents.on('will-frame-navigate', (event) => {
      event.preventDefault();
    });
    // Every picture drawn, and the fonts in, before it prints.
    await contents.executeJavaScript(
      'Promise.all([...document.images].map((i) => i.decode().catch(() => null))).then(() => document.fonts.ready).then(() => true)',
    );
    if (p.kind === 'pdf') return { ok: true, pdf: await contents.printToPDF(pdfOptions(p.footer)) };
    const printed = await new Promise<{ success: boolean; why: string }>((resolve) => {
      contents.print({ silent: false, printBackground: true }, (success, why) => {
        resolve({ success, why });
      });
    });
    if (printed.success) return { ok: true, pdf: null };
    return { ok: false, cancelled: /cancel/iu.test(printed.why), why: printed.why };
  } finally {
    mayLoad = new Set();
    if (win && !win.isDestroyed()) win.destroy();
    // The next page may open now, whatever happens to this one's folder: one that cannot be taken away (Windows'
    // EBUSY or EPERM while something still holds the file) fails this print alone (a22-review-print M1).
    pageOpen = false;
    rmSync(folder, { recursive: true, force: true });
  }
}
