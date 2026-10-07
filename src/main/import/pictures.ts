import { basename, posix } from 'node:path';
import type { ImportIssue } from '../../shared/import';
import type { PictureSource } from '../../shared/pictures';
import { tidyNotes } from '../../shared/pictures';
import type { Converter } from './deck-converters';
import { nameFromFile } from './formats/text';
import type { ParsedPresentation } from './model';
import { mediaRef } from './model';
import { parseXml, type XmlNode } from './xml';
import { readZipEntries } from './zip';

/*
 * PDF, PowerPoint and Keynote as pictures (Session 15), in the import
 * worker: a PowerPoint or Keynote file is first saved as PDF by PowerPoint
 * or Keynote, where installed (./deck-converters.ts); the main process draws the
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

/** "1 slide has" or "3 slides have": a count with its words, singular or plural. */
const counted = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** What the report says about a document made into pictures. */
export function picturesIssues(details: {
  source: PictureSource;
  converter: Converter | null;
  /** Another app was tried first and could not do it: why, in a few words. */
  firstTried?: { converter: Converter; reason: string } | null;
  pages: number;
  total: number;
  failed: readonly number[];
  withNotes: number;
  animated: number;
  /** Slides hidden in the file, which its PDF leaves out. */
  hidden?: number;
  notesUnmatched: boolean;
}): ImportIssue[] {
  const name = (c: Converter) => (c === 'keynote' ? 'Keynote' : 'PowerPoint');
  const issues: ImportIssue[] = [
    {
      severity: 'info',
      code: 'pictures',
      message: `${details.pages === 1 ? 'The page became a slide' : `Each of the ${String(details.pages)} pages became a slide`} holding its picture: the words on it cannot be edited or searched in Drashti.${details.source === 'pdf' ? '' : ' Animations and builds show as each slide’s finished picture.'}`,
      fix: null,
    },
  ];
  if (details.converter)
    issues.push(
      details.firstTried
        ? {
            severity: 'warning',
            code: 'pictures-converter',
            message: `${name(details.firstTried.converter)} could not save it as PDF (${details.firstTried.reason}), so ${name(details.converter)} did. Check the pictures look right.`,
            fix: null,
          }
        : {
            severity: 'info',
            code: 'pictures-converter',
            message: `${name(details.converter)} saved it as PDF first.`,
            fix: null,
          },
    );
  if (details.animated > 0) {
    const what = details.source === 'key' ? 'builds' : 'animations';
    issues.push({
      severity: 'info',
      code: 'pictures-animations',
      message: `${counted(details.animated, `slide has ${what}: it shows`, `slides have ${what}: each shows`)} its finished picture, all at once.`,
      fix: null,
    });
  }
  if ((details.hidden ?? 0) > 0)
    issues.push({
      severity: 'info',
      code: 'pictures-hidden',
      message: `${counted(details.hidden ?? 0, 'slide is', 'slides are')} hidden in the file and left out, as in its slide show.`,
      fix: null,
    });
  issues.push({
    severity: 'info',
    code: 'pictures-notes',
    message:
      details.withNotes > 0
        ? `${counted(details.withNotes, 'slide has', 'slides have')} speaker notes, kept as the slide’s notes (the stage screen shows them).`
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
      message: `${details.failed.length === 1 ? 'Page' : 'Pages'} ${details.failed.map((n) => String(n + 1)).join(', ')} could not be drawn and ${details.failed.length === 1 ? 'was' : 'were'} left out.`,
      fix: null,
    });
  return issues;
}
