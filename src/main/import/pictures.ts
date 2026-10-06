import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, posix } from 'node:path';
import type { ImportIssue } from '../../shared/import';
import type { PictureSource } from '../../shared/pictures';
import { tidyNotes } from '../../shared/pictures';
import { nameFromFile } from './formats/text';
import type { ParsedPresentation } from './model';
import { mediaRef } from './model';
import { parseXml, type XmlNode } from './xml';
import { readZipEntries } from './zip';

/*
 * PDF, PowerPoint and Keynote as pictures (Session 15), in the import
 * worker: a PowerPoint or Keynote file is first saved as PDF by Keynote (on
 * a Mac) or PowerPoint (where it is installed); the main process draws the
 * PDF's pages (src/main/pictures/pdf-pictures.ts); and this makes the
 * presentation: one slide per page, the page's picture full frame, its
 * speaker notes as the slide's notes. A .pptx's notes, and which of its
 * slides are hidden or have animations, are read from the file itself.
 */

// ---- a PowerPoint file's own slides --------------------------------------------------------------

export interface PptxSlide {
  /** Hidden in the slide show (PowerPoint leaves it out of a PDF it saves). */
  hidden: boolean;
  /** Its speaker notes ('' for none). */
  notes: string;
  /** It has animations (entrances, exits, emphasis, motion), which a picture cannot show. */
  animated: boolean;
}

const ANIMATIONS = new Set([
  'p:anim',
  'p:animEffect',
  'p:animMotion',
  'p:animScale',
  'p:animRot',
  'p:animClr',
  'p:set',
  'p:bldP',
]);

function descendants(node: XmlNode, test: (n: XmlNode) => boolean, out: XmlNode[] = []): XmlNode[] {
  for (const child of node.children) {
    if (test(child)) out.push(child);
    descendants(child, test, out);
  }
  return out;
}

/** A relationships file's targets by id, resolved against the folder of the part they belong to. */
function relationships(
  xml: Buffer | undefined,
  folder: string,
): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>();
  if (!xml) return out;
  for (const r of descendants(parseXml(xml.toString('utf8')), (n) => n.name === 'Relationship')) {
    const id = r.attrs['Id'];
    const target = r.attrs['Target'];
    if (!id || !target || r.attrs['TargetMode'] === 'External') continue;
    const path = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(folder, target));
    out.set(id, { type: r.attrs['Type'] ?? '', target: path });
  }
  return out;
}

/** The words of a text body: its paragraphs, each on a line. */
function bodyText(body: XmlNode): string {
  return descendants(body, (n) => n.name === 'a:p')
    .map((p) =>
      descendants(p, (n) => n.name === 'a:t' || n.name === 'a:br')
        .map((n) => (n.name === 'a:br' ? '\n' : n.text))
        .join(''),
    )
    .join('\n');
}

/** A notes page's notes: the body placeholder's text (not the slide number, date or picture). */
function notesOf(xml: Buffer | undefined): string {
  if (!xml) return '';
  const root = parseXml(xml.toString('utf8'));
  const bodies = descendants(root, (n) => n.name === 'p:sp').filter((sp) =>
    descendants(sp, (n) => n.name === 'p:ph').some((ph) => ph.attrs['type'] === 'body'),
  );
  return tidyNotes(
    bodies.flatMap((sp) => descendants(sp, (n) => n.name === 'p:txBody').map(bodyText)).join('\n\n'),
  );
}

/**
 * Every slide of a .pptx in the order it plays: hidden or not, its notes,
 * and whether it has animations. Throws when the file is not a PowerPoint
 * file (a damaged one, or an old .ppt renamed).
 */
export async function readPptx(path: string): Promise<PptxSlide[]> {
  const parts = await readZipEntries(
    path,
    (name) =>
      name === 'ppt/presentation.xml' ||
      name === 'ppt/_rels/presentation.xml.rels' ||
      /^ppt\/slides\/(_rels\/)?slide\d+\.xml(\.rels)?$/u.test(name) ||
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(name),
  );
  const presentation = parts.get('ppt/presentation.xml');
  if (!presentation) throw new Error('This is not a PowerPoint (.pptx) file.');
  const rels = relationships(parts.get('ppt/_rels/presentation.xml.rels'), 'ppt');
  const order = descendants(parseXml(presentation.toString('utf8')), (n) => n.name === 'p:sldId')
    .map((n) => rels.get(n.attrs['r:id'] ?? '')?.target)
    .filter((t): t is string => t !== undefined);
  return order.map((slidePath) => {
    const xml = parts.get(slidePath);
    const root = xml ? parseXml(xml.toString('utf8')) : null;
    const name = posix.basename(slidePath);
    const slideRels = relationships(
      parts.get(posix.join(posix.dirname(slidePath), '_rels', `${name}.rels`)),
      posix.dirname(slidePath),
    );
    const notesPath = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'))?.target;
    const timing = root ? descendants(root, (n) => n.name === 'p:timing') : [];
    return {
      hidden: root?.attrs['show'] === '0',
      notes: notesPath ? notesOf(parts.get(notesPath)) : '',
      animated: timing.some((t) => descendants(t, (n) => ANIMATIONS.has(n.name)).length > 0),
    };
  });
}

/**
 * The notes for each page of the PDF made from a file whose slides are
 * `slides` (in the order they play): a saved PDF leaves hidden slides out,
 * unless it has every slide. Null when the pages cannot be matched.
 */
export function notesForPages(slides: readonly PptxSlide[], pages: number): string[] | null {
  const shown = slides.filter((s) => !s.hidden);
  if (shown.length === pages) return shown.map((s) => s.notes);
  if (slides.length === pages) return slides.map((s) => s.notes);
  return null;
}

// ---- saving as PDF -------------------------------------------------------------------------------

export type Converter = 'keynote' | 'powerpoint';

/** What can save a PowerPoint or Keynote file as PDF on this computer. */
export interface Converters {
  keynote: boolean;
  powerpoint: boolean;
}

/** Keynote on a Mac first (it comes with every Mac), then PowerPoint; a .key needs Keynote. */
export function converterFor(
  source: PictureSource,
  platform: NodeJS.Platform,
  has: Converters,
): Converter | null {
  if (source === 'pdf') return null;
  if (platform === 'darwin' && has.keynote) return 'keynote';
  if (source !== 'key' && (platform === 'darwin' || platform === 'win32') && has.powerpoint)
    return 'powerpoint';
  return null;
}

/** What to do when nothing here can save the file as PDF, said plainly. */
export function noConverterMessage(source: PictureSource): string {
  return source === 'key'
    ? 'This computer has no Keynote to turn this Keynote file into pictures. On a Mac, open it in Keynote and choose File > Export To > PDF…, then import the PDF.'
    : 'This computer has no Keynote or PowerPoint to turn this file into pictures. Open it in PowerPoint (File > Save As, PDF) or Keynote (File > Export To > PDF…), then import the PDF.';
}

const exists = (path: string) => {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
};

/** Whether Windows knows PowerPoint (its automation is registered). */
function windowsHasPowerPoint(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('reg', ['query', 'HKCR\\PowerPoint.Application\\CurVer'], { stdio: 'ignore' });
    child.on('error', () => {
      resolve(false);
    });
    child.on('exit', (code) => {
      resolve(code === 0);
    });
  });
}

/** Keynote and PowerPoint where they are usually installed. */
export async function findConverters(platform: NodeJS.Platform = process.platform): Promise<Converters> {
  if (platform === 'darwin')
    return {
      keynote: exists('/Applications/Keynote.app') || exists(join(homedir(), 'Applications', 'Keynote.app')),
      powerpoint: exists('/Applications/Microsoft PowerPoint.app'),
    };
  if (platform === 'win32') return { keynote: false, powerpoint: await windowsHasPowerPoint() };
  return { keynote: false, powerpoint: false };
}

/** Run a program, giving up after `timeoutMs` or when `signal` says to stop. */
function run(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const stop = () => child.kill();
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve({ code, stdout, stderr });
    });
  });
}

/** A big deck can take a while to open and save. */
const CONVERT_TIMEOUT_MS = 5 * 60 * 1000;
/** Keynote's notes come back one per shown slide, between these. */
const NOTES_SEPARATOR = '\u001e';

/** Keynote: open, note each shown slide's presenter notes, export a PDF (shown slides), close. */
const KEYNOTE_SCRIPT = `on run argv
  set inPath to item 1 of argv
  set outPath to item 2 of argv
  tell application "Keynote"
    set theDoc to open (POSIX file inPath)
    set noteList to {}
    repeat with s in (slides of theDoc)
      if skipped of s is false then set end of noteList to (presenter notes of s)
    end repeat
    export theDoc to (POSIX file outPath) as PDF with properties {PDF image quality:Best, skipped slides:false}
    close theDoc saving no
  end tell
  set AppleScript's text item delimiters to (ASCII character 30)
  return noteList as text
end run
`;

/** PowerPoint on a Mac: open and save as PDF, in its own folder (it may not write elsewhere). */
const POWERPOINT_MAC_SCRIPT = `on run argv
  set inPath to item 1 of argv
  set outPath to item 2 of argv
  tell application "Microsoft PowerPoint"
    open (POSIX file inPath)
    set thePres to active presentation
    save thePres in (POSIX file outPath) as save as PDF
    close thePres saving no
  end tell
  return ""
end run
`;

/**
 * PowerPoint on Windows, through its automation: open read-only without a
 * window, save as PDF (32 is ppSaveAsPDF), note every slide's notes and
 * whether it is hidden, close, and quit PowerPoint only if nothing else is
 * open in it. PowerPoint runs below normal priority meanwhile.
 */
const POWERPOINT_WINDOWS_SCRIPT = `param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$Notes)
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try { Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'BelowNormal' } } catch {}
$pres = $app.Presentations.Open($In, -1, 0, 0)
try {
  $pres.SaveAs($Out, 32)
  $slides = @()
  foreach ($s in $pres.Slides) {
    $text = ''
    try { $text = [string]$s.NotesPage.Shapes.Placeholders(2).TextFrame.TextRange.Text } catch {}
    $slides += [pscustomobject]@{ hidden = ($s.SlideShowTransition.Hidden -ne 0); notes = $text; animated = $false }
  }
  ConvertTo-Json -InputObject @($slides) -Compress | Set-Content -LiteralPath $Notes -Encoding UTF8
} finally {
  $pres.Close()
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
`;

export type Converted =
  | {
      ok: true;
      pdf: string;
      /** Each slide, as the converter told it (null: the file itself is read for them, or none). */
      slides: PptxSlide[] | null;
      /** Keynote's notes are for shown slides only, already in the PDF's order. */
      shownOnly: boolean;
    }
  | { ok: false; message: string };

const firstLine = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
    ?.slice(0, 300) ?? '';

/** Save a PowerPoint or Keynote file as PDF in `work` (a folder of its own) with the converter given. */
export async function convertToPdf(
  converter: Converter,
  input: string,
  work: string,
  signal?: AbortSignal,
  platform: NodeJS.Platform = process.platform,
): Promise<Converted> {
  const pdf = join(work, 'pictures.pdf');
  if (converter === 'keynote') {
    const script = join(work, 'keynote.applescript');
    await writeFile(script, KEYNOTE_SCRIPT);
    const r = await run('osascript', [script, input, pdf], CONVERT_TIMEOUT_MS, signal);
    if (r.code !== 0 || !exists(pdf)) return { ok: false, message: keynoteMessage(r.stderr) };
    const notes = r.stdout.replace(/\n$/u, '').split(NOTES_SEPARATOR);
    return {
      ok: true,
      pdf,
      slides: notes.map((n) => ({ hidden: false, notes: tidyNotes(n), animated: false })),
      shownOnly: true,
    };
  }
  if (platform === 'darwin') {
    // PowerPoint for Mac may only write in its own folders: work there, then bring the PDF back.
    const office = join(homedir(), 'Library', 'Group Containers', 'UBF8T346G9.Office', 'Drashti');
    await mkdir(office, { recursive: true });
    const inside = await mkdtemp(join(office, 'convert-'));
    try {
      const copy = join(inside, `deck${input.toLowerCase().endsWith('.ppt') ? '.ppt' : '.pptx'}`);
      await copyFile(input, copy);
      const out = join(inside, 'pictures.pdf');
      const script = join(work, 'powerpoint.applescript');
      await writeFile(script, POWERPOINT_MAC_SCRIPT);
      const r = await run('osascript', [script, copy, out], CONVERT_TIMEOUT_MS, signal);
      if (r.code !== 0 || !exists(out)) return { ok: false, message: powerPointMessage(r.stderr) };
      await copyFile(out, pdf);
      return { ok: true, pdf, slides: null, shownOnly: false };
    } finally {
      await rm(inside, { recursive: true, force: true });
    }
  }
  const script = join(work, 'powerpoint.ps1');
  const notesFile = join(work, 'notes.json');
  await writeFile(script, POWERPOINT_WINDOWS_SCRIPT);
  // Windows PowerShell by its full path, with no PSModulePath from whatever started Drashti.
  const env = { ...process.env };
  delete env['PSModulePath'];
  const powershell = join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const r = await run(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-In',
      input,
      '-Out',
      pdf,
      '-Notes',
      notesFile,
    ],
    CONVERT_TIMEOUT_MS,
    signal,
    env,
  );
  if (r.code !== 0 || !exists(pdf)) return { ok: false, message: powerPointMessage(r.stderr) };
  let slides: PptxSlide[] | null = null;
  try {
    const raw = JSON.parse((await readFile(notesFile, 'utf8')).replace(/^\uFEFF/u, '')) as unknown;
    if (Array.isArray(raw))
      slides = raw.map((s: { hidden?: unknown; notes?: unknown }) => ({
        hidden: s.hidden === true,
        notes: tidyNotes(typeof s.notes === 'string' ? s.notes : ''),
        animated: false,
      }));
  } catch {
    // No notes to be had: the pictures come without them.
  }
  return { ok: true, pdf, slides, shownOnly: false };
}

function keynoteMessage(stderr: string): string {
  if (/-1743|not allowed|Not authori[sz]ed/iu.test(stderr))
    return 'Drashti is not allowed to use Keynote. In System Settings, Privacy & Security, Automation, allow Drashti to control Keynote, then import the file again.';
  const detail = firstLine(stderr);
  return `Keynote could not save it as PDF${detail ? ` (${detail})` : ''}. Open it in Keynote and choose File > Export To > PDF…, then import the PDF.`;
}

function powerPointMessage(stderr: string): string {
  if (/-1743|not allowed|Not authori[sz]ed/iu.test(stderr))
    return 'Drashti is not allowed to use PowerPoint. In System Settings, Privacy & Security, Automation, allow Drashti to control Microsoft PowerPoint, then import the file again.';
  const detail = firstLine(stderr);
  return `PowerPoint could not save it as PDF${detail ? ` (${detail})` : ''}. Open it in PowerPoint and choose File > Save As, PDF, then import the PDF.`;
}

// ---- the slides ----------------------------------------------------------------------------------

/** A slide's own notes from the file, when it has some ('' is none). */
const ownNotes = (notes: readonly string[] | null, i: number): string | null => {
  const own = notes?.[i] ?? '';
  return own === '' ? null : own;
};

/**
 * The presentation a document's drawn pages make: one slide per page, its
 * picture full frame on a canvas of the pictures' size, its notes from
 * `slideNotes` (the file's own) or else the page's comments.
 */
export function picturesPresentation(
  fileName: string,
  drawn: { width: number; height: number; pages: readonly { index: number; file: string; notes: string }[] },
  slideNotes: readonly string[] | null,
): ParsedPresentation {
  return {
    name: nameFromFile(basename(fileName)),
    ref: null,
    width: drawn.width,
    height: drawn.height,
    notes: '',
    groups: [
      {
        name: '',
        color: null,
        slides: drawn.pages.map((page, i) => ({
          label: '',
          notes: tidyNotes(ownNotes(slideNotes, i) ?? page.notes),
          background: null,
          enabled: true,
          elements: [
            {
              id: 'picture',
              kind: 'image',
              frame: { x: 0, y: 0, width: drawn.width, height: drawn.height },
              mediaId: mediaRef(i),
              fit: 'fit',
            },
          ],
          cues: [],
        })),
      },
    ],
    arrangements: [],
    selectedArrangement: null,
    media: drawn.pages.map((page) => ({ originalPath: page.file, kind: 'image' })),
    issues: [],
  };
}

/** What the report says about a document made into pictures. */
export function picturesIssues(details: {
  source: PictureSource;
  converter: Converter | null;
  pages: number;
  total: number;
  failed: readonly number[];
  withNotes: number;
  animated: number;
  notesUnmatched: boolean;
}): ImportIssue[] {
  const issues: ImportIssue[] = [
    {
      severity: 'info',
      code: 'pictures',
      message: `Each of the ${String(details.pages)} page(s) became a slide holding its picture: the words on it cannot be edited or searched in Drashti.${details.source === 'pdf' ? '' : ' Animations and builds show as each slide’s finished picture.'}`,
      fix: null,
    },
  ];
  if (details.converter)
    issues.push({
      severity: 'info',
      code: 'pictures-converter',
      message: `${details.converter === 'keynote' ? 'Keynote' : 'PowerPoint'} saved it as PDF first.`,
      fix: null,
    });
  if (details.animated > 0)
    issues.push({
      severity: 'info',
      code: 'pictures-animations',
      message: `${String(details.animated)} slide(s) had animations: each shows its finished picture, all at once.`,
      fix: null,
    });
  issues.push({
    severity: 'info',
    code: 'pictures-notes',
    message:
      details.withNotes > 0
        ? `${String(details.withNotes)} slide(s) have speaker notes, kept as the slide's notes (the stage screen shows them).`
        : 'The file has no speaker notes.',
    fix: null,
  });
  if (details.notesUnmatched)
    issues.push({
      severity: 'warning',
      code: 'pictures-notes-unmatched',
      message:
        'The speaker notes could not be matched to the pages with certainty (the PDF has a different number of pages than the file has slides), so they were left out.',
      fix: null,
    });
  if (details.total > details.pages + details.failed.length)
    issues.push({
      severity: 'warning',
      code: 'pictures-too-many',
      message: `Only the first ${String(details.pages + details.failed.length)} of ${String(details.total)} pages were made into slides.`,
      fix: null,
    });
  if (details.failed.length > 0)
    issues.push({
      severity: 'warning',
      code: 'pictures-failed-pages',
      message: `Page(s) ${details.failed.map((n) => String(n + 1)).join(', ')} could not be drawn and were left out.`,
      fix: null,
    });
  return issues;
}
