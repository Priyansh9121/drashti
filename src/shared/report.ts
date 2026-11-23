import { z } from 'zod';
import { ACCESS_REPORT, ACCESS_TOKEN_ALPHABET } from './access-protocol';
import { formatBytes } from './format';
import { isLogPeriod, type LogPeriod } from './log-period';
import { cutText } from './text';

/*
 * Help › Report a Problem… (x49, the owner's Q60-38 and his "Yes, all A" to Q60-42 on 20 Nov 2026): what a report is,
 * on both sides of the bridge. The access list's script makes the admin's email from the report (access-list/core.js);
 * Drashti's Review shows the same text before Send, made here by the same rules (src/shared/report.test.ts keeps the two
 * equal), so the person sees exactly what will be sent.
 */

export type ReportFrom = 'pro' | 'simple' | 'node';
export type ReportFileKind = 'diagnostics' | 'picture' | 'crash';

/** A computer as the email names it: its name, version and system. */
export interface ReportComputer {
  name: string;
  version: string;
  platform: string;
}

/** One feature of a report, with the person's own words. */
export interface ReportFeatureWords {
  chapter: string;
  name: string;
  what: string;
  expected?: string;
}

/** A file of a report as the call names it: its kind, name, type, size and SHA-256 (its bytes go apart, by the hash). */
export interface ReportFileMeta {
  kind: ReportFileKind;
  name: string;
  type: string;
  bytes: number;
  sha256: string;
}

/** The report as the access list is sent it: the call's `report` (its files' data goes after it, by SHA-256). */
export interface ReportCallReport {
  id: string;
  written: number;
  from: ReportFrom;
  node?: ReportComputer;
  features: ReportFeatureWords[];
  notice?: string;
  errors?: string[];
  files: ReportFileMeta[];
  kept?: { name: string; bytes: number }[];
}

/** What the admin's email is made of (access-list/core.js's reportMailText takes the same). */
export interface ReportMailParts {
  reference: string;
  gmail: string;
  computer: string;
  written: string;
  received: string;
  features: ReportFeatureWords[];
  notice?: string;
  errors?: string[];
  files: { name: string; bytes: number }[];
  kept?: { name: string; bytes: number }[];
  owner: boolean;
}

/** Each kind of file's media type, as the list takes it. */
export const REPORT_FILE_TYPES: Record<ReportFileKind, string> = {
  diagnostics: 'text/plain',
  picture: 'image/png',
  crash: 'application/octet-stream',
};

/** Drashti's own most for the picture and the diagnostics file; crash files go in what is left of the 7 MB. */
export const REPORT_PICTURE_BYTES = Math.floor(1.5 * 1024 * 1024);
export const REPORT_DIAGNOSTICS_BYTES = Math.floor(1.75 * 1024 * 1024);
/** What the Review says for the time the list will receive it. */
export const REPORT_RECEIVED_LATER = 'when it arrives';

/** The limits of a report's words and files (the list's: src/shared/access-protocol.ts). */
export const REPORT_LIMITS = ACCESS_REPORT;

/** Crockford's base32 letters, as the access list's tokens and references use them. */
const LETTERS32 = ACCESS_TOKEN_ALPHABET;

/** A report's reference, from its id: "R-" and the id's first 40 bits in Crockford's base32 letters, in two fours. */
export function reportReference(id: string): string {
  // The first ten hex digits (40 bits, exact in a number), as eight letters of five bits each, in two fours.
  let n = 0;
  for (let i = 0; i < 10; i++) n = n * 16 + (parseInt(id.charAt(i) || '0', 16) || 0);
  let first = '';
  let second = '';
  for (let k = 0; k < 8; k++) {
    const letter = LETTERS32.charAt(Math.floor(n / 2 ** (35 - 5 * k)) % 32);
    if (k < 4) first += letter;
    else second += letter;
  }
  return `R-${first}-${second}`;
}

/** Characters that hide or reorder text: never in words the list emails (as the list's own `hidden`). */
function hidden(c: number): boolean {
  return (
    c === 0x200b ||
    c === 0x200e ||
    c === 0x200f ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x2064) ||
    (c >= 0x2066 && c <= 0x206f) ||
    c === 0xfeff
  );
}

/** Words a person typed for a report, made safe to email, as the list makes them: their line breaks kept. */
export function reportCleanLines(value: unknown): string {
  let s = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  s = s.replace(/\r\n?/gu, '\n');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x0a) out += '\n';
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) out += ' ';
    else if (!hidden(c)) out += s.charAt(i);
  }
  return out
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/^\n+|\n+$/gu, '');
}

const SEGMENTER =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Letters as people see them (a conjunct, a letter with its vowel sign, an emoji: one each), as the list counts. */
export function reportLetters(text: string): number {
  return SEGMENTER ? [...SEGMENTER.segment(text)].length : Array.from(text).length;
}

/** The subject: the first features (up to three, then how many more) and the reference, 160 characters at most. */
export function reportSubject(names: readonly string[], reference: string): string {
  const head = 'Drashti problem: ';
  const tail = ` (${reference})`;
  for (let k = Math.min(3, names.length); k >= 1; k--) {
    const text = `${names.slice(0, k).join(', ')}${names.length > k ? ` and ${String(names.length - k)} more` : ''}`;
    if ((head + text + tail).length <= 160) return head + text + tail;
  }
  const more = names.length > 1 ? ` and ${String(names.length - 1)} more` : '';
  return `${head}${cutText(names[0] ?? '', 160 - head.length - tail.length - more.length - 1)}…${more}${tail}`;
}

const SYSTEMS: Record<string, string> = { darwin: 'Mac', win32: 'Windows' };

/** A computer as the email names it: "Sabha Mac (Drashti 1.0.0-alpha.20, Mac)". */
export const reportComputerOf = (c: ReportComputer): string =>
  `${c.name} (Drashti ${c.version}, ${SYSTEMS[c.platform] ?? (c.platform || 'unknown')})`;

/** Where the report was written, as the email says it: the computer and its mode, or the node through its Main. */
export function reportComputerLine(
  sender: ReportComputer,
  from: ReportFrom,
  node: ReportComputer | null,
): string {
  if (from === 'node' && node)
    return `the node ${reportComputerOf(node)}, through Main ${reportComputerOf(sender)}`;
  return `${reportComputerOf(sender)}, in ${from === 'simple' ? 'Simple Mode' : 'Pro Mode'}`;
}

/** The admin's email text, as the access list makes it (access-list/core.js's reportMailText). */
export function reportMailText(parts: ReportMailParts): string {
  const lines = [`Drashti problem ${parts.reference}`, ''];
  lines.push(`From: ${parts.gmail} (the Gmail let in on that computer)`);
  lines.push(`Computer: ${parts.computer}`);
  lines.push(`Written: ${parts.written} (by that computer’s clock); received ${parts.received}`);
  lines.push('');
  parts.features.forEach((f, i) => {
    lines.push(`${String(i + 1)}. ${f.name}${f.chapter ? ` (${f.chapter})` : ''}`);
    lines.push('What went wrong:');
    lines.push(f.what);
    if (f.expected) lines.push('What they expected:', f.expected);
    lines.push('');
  });
  if (parts.notice) lines.push(`The notice Drashti showed: “${parts.notice}”`, '');
  const errors = parts.errors ?? [];
  if (errors.length > 0) lines.push('Recent errors in its log:', ...errors.map((e) => `  ${e}`), '');
  const fileLine = (f: { name: string; bytes: number }) => `${f.name} (${formatBytes(f.bytes)})`;
  const kept = parts.kept ?? [];
  if (parts.files.length > 0) lines.push(`Attached: ${parts.files.map(fileLine).join('; ')}`);
  if (kept.length > 0)
    lines.push(`Kept on their computer (too large to send): ${kept.map(fileLine).join('; ')}`);
  if (parts.files.length > 0 || kept.length > 0) lines.push('');
  if (!parts.owner) lines.push('Reply to this email to answer them.');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** The diagnostics file's and the picture's names, by when they were made (fileStamp), as Save Diagnostics names its. */
export function reportFileName(kind: 'diagnostics' | 'picture', stamp: string): string {
  return kind === 'diagnostics' ? `Drashti diagnostics ${stamp}.txt` : `Drashti window ${stamp}.png`;
}

/** What the person has written, as the window holds it. */
export interface ReportDraftWords {
  features: { name: string; what: string; expected: string }[];
}

/** Why the window cannot go to Review yet (Q60-42's limits), or null when it can. */
export function draftProblem(draft: ReportDraftWords): string | null {
  if (draft.features.length === 0) return 'Choose where the problem is.';
  if (draft.features.length > REPORT_LIMITS.features)
    return `At most ${String(REPORT_LIMITS.features)} features in one report: send another for the rest.`;
  for (const f of draft.features) {
    const what = reportLetters(reportCleanLines(f.what));
    if (what === 0) return `Say what went wrong with ${f.name}.`;
    if (what > REPORT_LIMITS.whatLetters)
      return `${f.name}: at most ${REPORT_LIMITS.whatLetters.toLocaleString('en')} letters for what went wrong.`;
    if (reportLetters(reportCleanLines(f.expected)) > REPORT_LIMITS.expectedLetters)
      return `${f.name}: at most ${REPORT_LIMITS.expectedLetters.toLocaleString('en')} letters for what you expected.`;
  }
  return null;
}

// ---- the window's side (Help › Report a Problem…) ----

/** To whom, as Review says it: Drashti never knows the admin's address (it is in the list's own settings). */
export const REPORT_TO = 'the admin of Drashti’s access list';

/** A time as Review says it, by this computer's clock: "20 Nov 2026, 19:42". */
export function reportWhen(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

/** What the person chose, wrote and ticked: the window's draft, as the main process takes it for Review. */
export interface ReportDraft {
  features: { id: string; chapter: string; name: string; what: string; expected: string }[];
  /** The notice's words (Report this…), or null. */
  notice: string | null;
  diagnostics: boolean;
  crashFiles: boolean;
  picture: boolean;
  /** The diagnostics' log of (alpha.21, logs (c)): Today, Yesterday, the last 7 days or one day. */
  period: LogPeriod;
}

/** A draft as the window sends it, read by the main process (anything else is refused). */
const draftSchema = z.object({
  features: z
    .array(
      z.object({
        id: z.string().max(200),
        chapter: z.string().max(200),
        name: z.string().min(1).max(200),
        what: z.string().max(ACCESS_REPORT.whatLetters * 8),
        expected: z.string().max(ACCESS_REPORT.expectedLetters * 8),
      }),
    )
    .max(ACCESS_REPORT.features * 2),
  notice: z.string().max(4000).nullable(),
  diagnostics: z.boolean(),
  crashFiles: z.boolean(),
  picture: z.boolean(),
  // Left out (a window from before alpha.21's logs): Today, as Save Diagnostics… was.
  period: z.custom<LogPeriod>((v) => isLogPeriod(v)).default('today'),
});

/** The window's draft, or null when it is not one. */
export function readReportDraft(raw: unknown): ReportDraft | null {
  const read = draftSchema.safeParse(raw);
  return read.success ? read.data : null;
}

/** A report's id as the window names it. */
export const isReportId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/u.test(v);

/** As Report a Problem opens: who sends it, from which computer, and what may go with it. */
export type ReportOpened =
  | {
      ok: true;
      gmail: string;
      owner: boolean;
      computer: string;
      /** The crash files kept on this computer (null: none). */
      crash: { count: number; bytes: number } | null;
      /** The days the log keeps, newest first (alpha.21, logs (c)): the periods offered for the diagnostics. */
      logDays: string[];
      /** The window as it was when Report a Problem opened (a small copy), or null. */
      picture: { thumb: string; width: number; height: number } | null;
      /** On a node (x49): the Main it is paired with, through which its reports go; null on Main. */
      via: string | null;
      waiting: number;
      sentToday: number;
      /** So many reports wait already that no more can be made until some go or are forgotten. */
      full: boolean;
    }
  | { ok: false; message: string };

/** Review: exactly what goes, made and kept (not sent); or why it could not be made. */
export type ReportPrepared =
  | {
      ok: true;
      id: string;
      reference: string;
      to: string;
      subject: string;
      text: string;
      files: { kind: ReportFileKind; name: string; bytes: number }[];
      kept: { name: string; bytes: number }[];
      /** The picture that goes, to show large (a data: address), or null. */
      picture: string | null;
    }
  | { ok: false; message: string };

export type ReportWaitWhy = 'unreachable' | 'on-air' | 'tomorrow' | 'list';

/** Where a report stands, as the window shows it. */
export type ReportStateView =
  | { kind: 'sent'; reference: string }
  | { kind: 'sending'; reference: string }
  | { kind: 'waiting'; why: ReportWaitWhy; reference: string }
  | { kind: 'refused'; why: string; reference: string };

/** One of Your reports. */
export interface ReportRow {
  id: string;
  reference: string;
  /** When Send was pressed. */
  when: number;
  features: string[];
  state: ReportStateView;
}

/** Save a Copy…: where its folder went, or why not. */
export type ReportCopied =
  | { ok: true; folder: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

/** What the window says of where a report stands. */
export function reportStateWords(s: ReportStateView): string {
  switch (s.kind) {
    case 'sent':
      return 'Sent: the admin has it.';
    case 'sending':
      return 'Sending… It goes on by itself if you close this window.';
    case 'refused':
      return 'Not sent: the report is too large. Use Save a Copy… and send it another way, or send it again without the crash files.';
    case 'waiting':
      switch (s.why) {
        case 'on-air':
          return 'Kept on this computer: it goes by itself once the stream and the recording have ended.';
        case 'tomorrow':
          return 'Kept on this computer: no more reports go today; it goes by itself tomorrow.';
        case 'list':
          return 'Kept on this computer: it goes by itself once the admin’s access list takes reports.';
        default:
          return 'Kept on this computer: it goes by itself once the access list can be reached.';
      }
  }
}

// ---- a node's report, handed to Main (the owner's Q60-42, 2) ----

/** What a node hands its Main: the report as made on the node, its files' data, and the node's own version. */
export interface NodeReportBody {
  v: 1;
  node: { version: string; platform: string };
  report: ReportCallReport;
  data: Record<string, string>;
}

/** Main's answer to a node's report: taken (it goes from Main by itself), or why not. */
export type NodeReportAnswer = { ok: true; reference: string } | { ok: false; message: string };

/** Each kind's file name, as the list takes it (access-list/core.js's REPORT_KINDS). */
export const REPORT_FILE_NAMES: Record<ReportFileKind, RegExp> = {
  diagnostics: /^Drashti diagnostics [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}-[0-9]{2}\.txt$/u,
  picture: /^Drashti window [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}-[0-9]{2}\.png$/u,
  crash: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.dmp$/u,
};

const computerSchema = z.object({
  name: z.string().max(200),
  version: z.string().max(60),
  platform: z.string().max(20),
});

const fileSchema = z
  .object({
    kind: z.enum(['diagnostics', 'picture', 'crash']),
    name: z.string().max(120),
    type: z.string().max(60),
    bytes: z.number().int().min(0).max(ACCESS_REPORT.filesBytes),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .refine((f) => REPORT_FILE_NAMES[f.kind].test(f.name) && REPORT_FILE_TYPES[f.kind] === f.type);

const callReportSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/u),
  written: z.number().int().min(0),
  from: z.enum(['pro', 'simple', 'node']),
  node: computerSchema.optional(),
  features: z
    .array(
      z.object({
        chapter: z.string().max(200),
        name: z.string().min(1).max(200),
        what: z
          .string()
          .min(1)
          .max(ACCESS_REPORT.whatLetters * 4),
        expected: z
          .string()
          .max(ACCESS_REPORT.expectedLetters * 4)
          .optional(),
      }),
    )
    .min(1)
    .max(ACCESS_REPORT.features),
  notice: z
    .string()
    .max(ACCESS_REPORT.noticeLetters * 4)
    .optional(),
  errors: z
    .array(z.string().max(ACCESS_REPORT.errorLetters * 4))
    .max(ACCESS_REPORT.errorLines)
    .optional(),
  files: z.array(fileSchema).max(2 + ACCESS_REPORT.crashFiles),
  kept: z
    .array(z.object({ name: z.string().regex(REPORT_FILE_NAMES.crash), bytes: z.number().int().min(0) }))
    .max(ACCESS_REPORT.crashFiles)
    .optional(),
});

const nodeBodySchema = z.object({
  v: z.literal(1),
  node: z.object({ version: z.string().max(60), platform: z.string().max(20) }),
  report: callReportSchema,
  data: z.record(z.string(), z.string()),
});

/** A node's report as Main is handed it (x49), or null when it is not one. */
export function readNodeReportBody(bytes: Uint8Array): NodeReportBody | null {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const read = nodeBodySchema.safeParse(raw);
  return read.success ? read.data : null;
}
