import { z } from 'zod';
import { LANGS, type Lang } from './model';
import { detectLang } from './text-runs';
import { capitalize, hasIndic, readsLike, transliterate } from './translit';

export type AiResult<T> = { ok: true; value: T } | { ok: false; message: string };
export const LYRIC_HELPER_MAX_CHARS = 20_000;
export const lyricRequestSchema = z
  .object({
    source: z.literal('pasted-lyrics'),
    text: z.string().max(LYRIC_HELPER_MAX_CHARS),
    action: z.enum(['breaks', 'transliteration']),
  })
  .strict();
export type LyricRequest = z.infer<typeof lyricRequestSchema>;
export interface LyricChange {
  id: string;
  kind: 'break' | 'transliteration';
  at: number;
  insert: string;
  afterLine: number;
  sourceLine: string;
  preview: string;
}
export interface LyricProposal {
  source: 'pasted-lyrics';
  action: LyricRequest['action'];
  sourceText: string;
  language: Lang | null;
  changes: LyricChange[];
}
export const lyricProposalSchema = z
  .object({
    source: z.literal('pasted-lyrics'),
    action: z.enum(['breaks', 'transliteration']),
    sourceText: z.string().max(LYRIC_HELPER_MAX_CHARS),
    language: z.enum(LANGS).nullable(),
    changes: z
      .array(
        z
          .object({
            id: z.string().max(100),
            kind: z.enum(['break', 'transliteration']),
            at: z.number().int().min(0).max(LYRIC_HELPER_MAX_CHARS),
            insert: z.string().max(80_000),
            afterLine: z.number().int().min(1).max(LYRIC_HELPER_MAX_CHARS),
            sourceLine: z.string().max(LYRIC_HELPER_MAX_CHARS),
            preview: z.string().max(80_000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
const lyricSelectionSchema = z.array(z.string().max(100)).max(200);

interface Line {
  text: string;
  eol: string;
  start: number;
  end: number;
}
function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)) {
    if (match[0] === '') continue;
    const value = match[1] ?? '';
    const start = match.index;
    lines.push({ text: value, eol: match[2] ?? '', start, end: start + value.length });
  }
  return lines;
}
const header = (text: string) => /^\s*\[[^\]\r\n]+\]\s*$/u.test(text);
const refusal = (): AiResult<never> => ({
  ok: false,
  message: 'This helper works only with pasted lyrics. It does not change Books or translate words.',
});
/** Run in the low-priority helper worker: structural breaks or the existing Roman-letter rules only. */
export function suggestLyrics(input: unknown): AiResult<LyricProposal> {
  const checked = lyricRequestSchema.safeParse(input);
  if (!checked.success) return refusal();
  const request = checked.data;
  const lines = linesOf(request.text);
  const changes: LyricChange[] = [];
  let inSlide = 0;
  for (const [i, line] of lines.entries()) {
    if (line.text.trim() === '' || header(line.text)) {
      inSlide = 0;
      continue;
    }
    inSlide++;
    if (request.action === 'breaks') {
      const next = lines[i + 1];
      if (inSlide === 2 && next && next.text.trim() !== '' && !header(next.text) && line.eol !== '') {
        changes.push({
          id: 'break-' + String(next.start),
          kind: 'break',
          at: next.start,
          insert: line.eol,
          afterLine: i + 1,
          sourceLine: line.text,
          preview: '',
        });
        inSlide = 0;
      }
    } else if (hasIndic(line.text)) {
      const next = lines[i + 1];
      if (next && !hasIndic(next.text) && readsLike(next.text, line.text)) continue;
      const roman = capitalize(transliterate(line.text));
      if (roman !== line.text && roman.trim() !== '')
        changes.push({
          id: 'transliteration-' + String(line.start),
          kind: 'transliteration',
          at: line.end,
          insert: (line.eol || '\n') + roman,
          afterLine: i + 1,
          sourceLine: line.text,
          preview: roman,
        });
    }
    if (changes.length >= 200) break;
  }
  return {
    ok: true,
    value: {
      source: 'pasted-lyrics',
      action: request.action,
      sourceText: request.text,
      language: detectLang(request.text),
      changes,
    },
  };
}
/** Insert only approved, recomputed changes. Source words can never be replaced or deleted. */
export function applyLyricSuggestions(
  text: string,
  proposalInput: unknown,
  selectedInput: unknown,
): AiResult<string> {
  const checkedProposal = lyricProposalSchema.safeParse(proposalInput);
  const checkedSelection = lyricSelectionSchema.safeParse(selectedInput);
  if (!checkedProposal.success || !checkedSelection.success)
    return { ok: false, message: 'The suggestion changed. Ask for it again.' };
  const proposal = checkedProposal.data;
  const selected = checkedSelection.data;
  if (text !== proposal.sourceText || new Set(selected).size !== selected.length)
    return { ok: false, message: 'The words or choices changed. Ask for suggestions again.' };
  const fresh = suggestLyrics({ source: proposal.source, text, action: proposal.action });
  if (!fresh.ok) return fresh;
  const allowed = new Map(fresh.value.changes.map((change) => [change.id, change]));
  const approved: LyricChange[] = [];
  for (const id of selected) {
    const change = allowed.get(id);
    const seen = proposal.changes.find((c) => c.id === id);
    if (!change) return { ok: false, message: 'The suggestion changed. Ask for it again.' };
    if (!seen) return { ok: false, message: 'The suggestion changed. Ask for it again.' };
    if (
      change.at !== seen.at ||
      change.kind !== seen.kind ||
      change.insert !== seen.insert ||
      change.preview !== seen.preview ||
      change.sourceLine !== seen.sourceLine ||
      change.afterLine !== seen.afterLine
    )
      return { ok: false, message: 'The suggestion changed. Ask for it again.' };
    approved.push(change);
  }
  const inserts = new Map(approved.map((change) => [change.at, change.insert]));
  // Keep every original code point. Insertions are only at recomputed whole-line boundaries.
  const parts: string[] = [];
  let offset = 0;
  for (const character of text) {
    const insertion = inserts.get(offset);
    if (insertion !== undefined) parts.push(insertion);
    parts.push(character);
    offset += character.length;
  }
  const end = inserts.get(offset);
  if (end !== undefined) parts.push(end);
  return { ok: true, value: parts.join('') };
}
