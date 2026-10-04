import { z } from 'zod';
import type { Lang } from './model';
import { scriptOf } from './text-runs';

/*
 * The Shastra module (PLAN.md 3, Session 12): texts an admin loads from
 * sources BAPS or the mandir has authorised (Drashti ships none), found by a
 * reference such as "SD 14" or "Vach G.Pr. 1", by their words, or by
 * browsing, and shown as slides with their reference line.
 *
 * A text has a name and an abbreviation. Its numbered items (a shlok, a vat,
 * a Vachanamrut) sit directly in it, or in sections, nested where needed,
 * each with a label and an abbreviation. An item has its words in one or
 * more languages. The file format is documented in docs/shastra-format.md.
 *
 * Loading a text again updates it: a text is the same text when its
 * abbreviation is (ignoring case, dots and spaces), and an item is the same
 * item when its section and number are, so playlists that name it keep
 * working.
 */

/** What a file declares itself as, so a JSON file is known for a Shastra text. */
export const SHASTRA_FORMAT = 'drashti-shastra';

/** The most items one passage shows (a whole section is fine; a whole text is not). */
export const PASSAGE_MAX_ITEMS = 60;

// ---- the file format -------------------------------------------------------------

/** The languages a file can give an item's words in ("sa" is Sanskrit in either script). */
export const FILE_LANGS = ['gu', 'hi', 'en', 'translit', 'sa', 'sa-gu'] as const;

const words = z.string().max(40_000);
const label = z.string().trim().min(1).max(120);
const abbreviation = z.string().trim().min(1).max(24);

export interface FileItem {
  number: number;
  title?: string | undefined;
  text: Partial<Record<(typeof FILE_LANGS)[number], string>>;
}
export interface FileSection {
  label: string;
  abbreviation?: string | undefined;
  sections?: FileSection[] | undefined;
  items?: FileItem[] | undefined;
}
export interface ShastraFile {
  format: typeof SHASTRA_FORMAT;
  version: 1;
  name: string;
  abbreviation: string;
  description?: string | undefined;
  sections?: FileSection[] | undefined;
  items?: FileItem[] | undefined;
}

const fileItemSchema: z.ZodType<FileItem> = z
  .object({
    number: z.number().int().min(0).max(100_000),
    title: z.string().trim().max(200).optional(),
    text: z.partialRecord(z.enum(FILE_LANGS), words),
  })
  .strict();

const fileSectionSchema: z.ZodType<FileSection> = z.lazy(() =>
  z
    .object({
      label,
      abbreviation: abbreviation.optional(),
      sections: z.array(fileSectionSchema).max(5_000).optional(),
      items: z.array(fileItemSchema).max(20_000).optional(),
    })
    .strict(),
);

export const shastraFileSchema: z.ZodType<ShastraFile> = z
  .object({
    format: z.literal(SHASTRA_FORMAT),
    version: z.literal(1),
    name: label,
    abbreviation,
    description: z.string().trim().max(2_000).optional(),
    sections: z.array(fileSectionSchema).max(5_000).optional(),
    items: z.array(fileItemSchema).max(20_000).optional(),
  })
  .strict();

// ---- a text as loaded ------------------------------------------------------------

export interface LoadedItem {
  number: number;
  title: string;
  /** The words in each language given (Sanskrit filed under the script it is written in). */
  texts: Partial<Record<Lang, string>>;
}
export interface LoadedSection {
  label: string;
  abbreviation: string | null;
  /** The section's place among its parent's (for reloading): its abbreviation's key, else its label's. */
  key: string;
  sections: LoadedSection[];
  items: LoadedItem[];
}
export interface LoadedText {
  name: string;
  abbreviation: string;
  description: string;
  /** The text's own items (when it has no sections). */
  items: LoadedItem[];
  sections: LoadedSection[];
  itemCount: number;
  /** Each language and on how many items it has words. */
  languages: Partial<Record<Lang, number>>;
}

/** What is said about a file that loads, but not all of it as written. */
export interface LoadNote {
  severity: 'warning' | 'info';
  message: string;
}

/**
 * The key a reference matches on: lower case, without accents, dots,
 * apostrophes or spaces ("G.Pr." and "g pr" are both "gpr").
 */
export function refKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

/** Line endings as "\n", each line trimmed, blank lines at the ends dropped. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/^\n+|\n+$/gu, '');
}

/** Sanskrit given under "sa" or "sa-gu" goes to the language of the script it is written in. */
function sanskritLang(text: string, given: 'sa' | 'sa-gu'): Lang {
  const script = scriptOf(text);
  return script === 'gu' ? 'sa-gu' : script === 'hi' ? 'sa' : given;
}

/**
 * Read a file's text as Drashti keeps it, or say why it cannot be loaded.
 * Problems that leave the rest usable (an empty item, a repeated number) are
 * notes; a file that is not a Shastra text, or has no items, is refused.
 */
export function readShastraFile(
  raw: unknown,
): { ok: true; text: LoadedText; notes: LoadNote[] } | { ok: false; message: string } {
  const parsed = shastraFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` (at ${issue.path.join(' › ')})` : '';
    return {
      ok: false,
      message: `This is not a Shastra text Drashti can read${where}: ${issue?.message ?? ''}`,
    };
  }
  const file = parsed.data;
  const notes: LoadNote[] = [];
  const languages: Partial<Record<Lang, number>> = {};
  let itemCount = 0;

  const readItems = (items: readonly FileItem[], where: string): LoadedItem[] => {
    const seen = new Set<number>();
    const out: LoadedItem[] = [];
    for (const item of items) {
      if (seen.has(item.number)) {
        notes.push({
          severity: 'warning',
          message: `${where} has item ${item.number} more than once: the first is kept.`,
        });
        continue;
      }
      const texts: Partial<Record<Lang, string>> = {};
      for (const [lang, value] of Object.entries(item.text) as [(typeof FILE_LANGS)[number], string][]) {
        const text = tidy(value);
        if (text === '') continue;
        const to: Lang = lang === 'sa' || lang === 'sa-gu' ? sanskritLang(text, lang) : lang;
        if (texts[to] !== undefined) {
          notes.push({
            severity: 'warning',
            message: `${where} ${item.number} gives Sanskrit in the same script twice: the first is kept.`,
          });
          continue;
        }
        texts[to] = text;
      }
      if (Object.keys(texts).length === 0) {
        notes.push({
          severity: 'warning',
          message: `${where} ${item.number} has no words: it was left out.`,
        });
        continue;
      }
      seen.add(item.number);
      for (const lang of Object.keys(texts) as Lang[]) languages[lang] = (languages[lang] ?? 0) + 1;
      itemCount++;
      out.push({ number: item.number, title: item.title ?? '', texts });
    }
    return out;
  };

  const readSections = (sections: readonly FileSection[], where: string): LoadedSection[] => {
    const keys = new Set<string>();
    const out: LoadedSection[] = [];
    for (const s of sections) {
      const key = refKey(s.abbreviation ?? s.label);
      if (keys.has(key)) {
        notes.push({
          severity: 'warning',
          message: `${where} has two sections called “${s.abbreviation ?? s.label}”: the second was left out.`,
        });
        continue;
      }
      keys.add(key);
      const name = `${where} › ${s.label}`;
      if (s.sections && s.items) {
        notes.push({
          severity: 'warning',
          message: `${name} has both sections and items: only its sections were loaded.`,
        });
      }
      out.push({
        label: s.label,
        abbreviation: s.abbreviation ?? null,
        key,
        sections: s.sections ? readSections(s.sections, name) : [],
        items: s.sections ? [] : readItems(s.items ?? [], name),
      });
    }
    return out;
  };

  if (file.sections && file.items)
    notes.push({
      severity: 'warning',
      message: `${file.name} has both sections and items: only its sections were loaded.`,
    });
  const sections = file.sections ? readSections(file.sections, file.name) : [];
  const items = file.sections ? [] : readItems(file.items ?? [], file.name);
  if (itemCount === 0) return { ok: false, message: `${file.name} has no items with words in them.` };
  return {
    ok: true,
    text: {
      name: file.name,
      abbreviation: file.abbreviation,
      description: file.description ?? '',
      items,
      sections,
      itemCount,
      languages,
    },
    notes,
  };
}

// ---- references --------------------------------------------------------------

/** A section as references see it. */
export interface RefSection {
  id: string;
  label: string;
  abbreviation: string | null;
  sections: RefSection[];
  /** Its items' numbers, in order (empty when it holds sections). */
  numbers: number[];
}

/** A loaded text as references see it. */
export interface RefText {
  id: string;
  name: string;
  abbreviation: string;
  sections: RefSection[];
  /** The text's own items' numbers (when it has no sections). */
  numbers: number[];
}

export type RefResult = { ok: true; key: PassageKey; display: string } | { ok: false; message: string };

/** What a reference reads as on the screens: "Satsang Diksha 14", "Vachanamrut Gadhada Pratham 1–3". */
export function referenceLine(
  textName: string,
  sectionLabels: readonly string[],
  from: number,
  to: number,
): string {
  const numbers = from === to ? String(from) : `${from}–${to}`;
  return [textName, ...sectionLabels, numbers].join(' ');
}

const sectionNames = (sections: readonly RefSection[]) =>
  sections
    .slice(0, 12)
    .map((s) => s.abbreviation ?? s.label)
    .join(', ') + (sections.length > 12 ? '…' : '');

/**
 * The reference typed, cut into words: dots and apostrophes go (except a dot
 * between numbers, which separates them like a colon or slash), dashes become
 * "-", and letters and numbers written together are parted ("gpr1" → "gpr 1").
 */
function refWords(input: string): string[] {
  const text = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[‐-―−]/gu, '-')
    .replace(/(\d)\s*[.:/]\s*(?=\d)/gu, '$1 ')
    .replace(/[.'’,]/gu, ' ')
    .replace(/\s*-\s*/gu, '-')
    .replace(/(\p{L})(?=\d)|(\d)(?=\p{L})/gu, '$1$2 ');
  return text.split(/\s+/u).filter((w) => w !== '');
}

/**
 * Find what a reference such as "SD 14", "SD 14-16" or "Vach G.Pr. 1" names,
 * using each loaded text's own abbreviations (or names), or say clearly why
 * it names nothing.
 */
export function resolveReference(input: string, texts: readonly RefText[]): RefResult {
  const ws = refWords(input);
  if (ws.length === 0) return { ok: false, message: 'Type a reference, for example “SD 14”.' };
  if (texts.length === 0) return { ok: false, message: 'No Shastra texts are loaded yet.' };

  // The text: the longest run of words that is a text's abbreviation or name.
  let text: RefText | null = null;
  let used = 0;
  for (const t of texts) {
    const keys = [refKey(t.abbreviation), refKey(t.name)];
    for (let n = ws.length; n >= 1; n--) {
      const joined = refKey(ws.slice(0, n).join(''));
      if (keys.includes(joined) && n > used) {
        text = t;
        used = n;
        break;
      }
    }
  }
  if (!text) {
    const known = texts.map((t) => t.abbreviation).join(', ');
    const said = input.trim().split(/\s+/u)[0] ?? '';
    return { ok: false, message: `No loaded text is called “${said}”. The texts are: ${known}.` };
  }

  // The sections, level by level: one or more words that are a section's abbreviation or label.
  const rest = ws.slice(used);
  const path: RefSection[] = [];
  let level = text.sections;
  let numbers = text.numbers;
  let at = 0;
  while (level.length > 0) {
    let found: RefSection | null = null;
    let took = 0;
    for (const s of level) {
      const keys = [s.abbreviation ? refKey(s.abbreviation) : null, refKey(s.label)];
      for (let n = rest.length - at; n >= 1; n--) {
        if (keys.includes(refKey(rest.slice(at, at + n).join(''))) && n > took) {
          found = s;
          took = n;
          break;
        }
      }
    }
    if (!found) {
      const where = path.length === 0 ? text.name : `${text.name} ${path.map((p) => p.label).join(' ')}`;
      const said = rest[at];
      return {
        ok: false,
        message: said
          ? `${where} has no section “${said}”. Its sections are: ${sectionNames(level)}.`
          : `Say which section of ${where}: ${sectionNames(level)}.`,
      };
    }
    path.push(found);
    at += took;
    level = found.sections;
    numbers = found.numbers;
  }

  const name = [text.name, ...path.map((p) => p.label)].join(' ');
  const spec = rest.slice(at);
  const example = `${text.abbreviation}${path.map((p) => ` ${p.abbreviation ?? p.label}`).join('')}`;
  if (spec.length === 0)
    return { ok: false, message: `Say which one of ${name}: for example “${example} ${numbers[0] ?? 1}”.` };
  const m = spec.length === 1 ? /^(\d+)(?:-(\d+))?$/u.exec(spec[0] ?? '') : null;
  if (!m) return { ok: false, message: `“${spec.join(' ')}” is not a number in ${name}.` };
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (to < from) return { ok: false, message: `A range goes up: “${example} ${to}-${from}”.` };
  const first = numbers[0];
  const last = numbers.at(-1);
  const has = new Set(numbers);
  for (const n of from === to ? [from] : [from, to]) {
    if (!has.has(n)) {
      return {
        ok: false,
        message:
          first === undefined
            ? `${name} has no items.`
            : `${name} has no ${n}: it goes from ${first} to ${last ?? first}.`,
      };
    }
  }
  const count = numbers.filter((n) => n >= from && n <= to).length;
  if (count > PASSAGE_MAX_ITEMS)
    return {
      ok: false,
      message: `That is ${count} items; a passage shows up to ${PASSAGE_MAX_ITEMS} at a time.`,
    };
  return {
    ok: true,
    key: {
      text: refKey(text.abbreviation),
      sections: path.map((p) => refKey(p.abbreviation ?? p.label)),
      from,
      to,
    },
    display: referenceLine(
      text.name,
      path.map((p) => p.label),
      from,
      to,
    ),
  };
}

// ---- passages ----------------------------------------------------------------------

/**
 * A passage: items `from` to `to` (by number, inclusive) of one section of a
 * text, or of a text without sections, named by keys (refKey) rather than
 * ids, so a playlist that names it keeps working when the text is loaded
 * again, even after it was removed. A passage plays like a presentation: its
 * id stands where a presentation's would (the engine, the slide grid,
 * playlists, recovery), and Drashti makes its slides from the text.
 */
export interface PassageKey {
  /** The text's abbreviation, as a key. */
  text: string;
  /** Each section's abbreviation (or label), as a key, from the text down. */
  sections: string[];
  from: number;
  to: number;
}

const PASSAGE_PREFIX = 'shastra:';

export const isPassageId = (id: string): boolean => id.startsWith(PASSAGE_PREFIX);

/** "shastra:sd#14-16", "shastra:vach/gpr#1". */
export function passageId(k: PassageKey): string {
  const numbers = k.from === k.to ? String(k.from) : `${k.from}-${k.to}`;
  return `${PASSAGE_PREFIX}${[k.text, ...k.sections].join('/')}#${numbers}`;
}

export function parsePassageId(id: string): PassageKey | null {
  if (!isPassageId(id)) return null;
  const m = /^([^/#]+)((?:\/[^/#]+)*)#(\d+)(?:-(\d+))?$/u.exec(id.slice(PASSAGE_PREFIX.length));
  if (!m?.[1] || m[3] === undefined) return null;
  const from = Number(m[3]);
  const to = m[4] === undefined ? from : Number(m[4]);
  if (to < from) return null;
  return { text: m[1], sections: (m[2] ?? '').split('/').filter((x) => x !== ''), from, to };
}

export const passageKeySchema: z.ZodType<PassageKey> = z
  .object({
    text: z.string().min(1).max(64),
    sections: z.array(z.string().min(1).max(160)).max(8),
    from: z.number().int().min(0).max(100_000),
    to: z.number().int().min(0).max(100_000),
  })
  .strict()
  .refine((k) => k.to >= k.from, 'A range goes up.');

// ---- what the operator window and the remote see --------------------------------------

/** A loaded text, as the Texts dialog lists it. */
export interface ShastraTextInfo {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  /** The theme its passages are drawn with (null: Drashti's default theme). */
  themeId: string | null;
  itemCount: number;
  sectionCount: number;
  /** Each language and on how many items it has words. */
  languages: Partial<Record<Lang, number>>;
  /** Where it was loaded from, and when. */
  sourcePath: string | null;
  loadedAt: string;
}

/** One item in the browser: its number, title, and the passage it is on its own. */
export interface ShastraItemRow {
  id: string;
  number: number;
  title: string;
  passageId: string;
}

/** A section in the browser, with its sections or items. */
export interface ShastraSectionNode {
  id: string;
  label: string;
  abbreviation: string | null;
  sections: ShastraSectionNode[];
  items: ShastraItemRow[];
}

/** A text to browse: its sections, or its own items. */
export interface ShastraTree {
  text: ShastraTextInfo;
  sections: ShastraSectionNode[];
  items: ShastraItemRow[];
}

/** A passage found by its words. */
export interface ShastraHit {
  passageId: string;
  /** "Satsang Diksha 14". */
  reference: string;
  /** The words found, around the match. */
  snippet: string;
  lang: Lang | null;
}

/** A passage as the operator window shows it before it goes up. */
export interface PassageInfo {
  passageId: string;
  key: PassageKey;
  /** "Satsang Diksha 14–16". */
  reference: string;
}

export type PassageResult = { ok: true; passage: PassageInfo } | { ok: false; message: string };

/** Choosing a text's theme or removing it: the texts as they are now, or why not. */
export type ShastraResult = { ok: true; texts: ShastraTextInfo[] } | { ok: false; message: string };

// ---- checks for requests arriving over IPC and the network ------------------------------

export const referenceInputSchema = z.string().trim().min(1).max(120);
export const passageIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((id) => parsePassageId(id) !== null, 'Not a passage.');
export const shastraSearchSchema = z.string().trim().min(1).max(200);
