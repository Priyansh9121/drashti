import { z } from 'zod';
import type { Lang } from './model';
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
  proposal: LyricProposal,
  selected: readonly string[],
): AiResult<string> {
  if (
    !proposal ||
    typeof proposal !== 'object' ||
    text !== proposal.sourceText ||
    !Array.isArray(proposal.changes) ||
    !Array.isArray(selected) ||
    selected.length > 200 ||
    selected.some((id) => typeof id !== 'string') ||
    new Set(selected).size !== selected.length
  )
    return { ok: false, message: 'The words or choices changed. Ask for suggestions again.' };
  const fresh = suggestLyrics({ source: proposal.source, text, action: proposal.action });
  if (!fresh.ok) return fresh;
  const allowed = new Map(fresh.value.changes.map((change) => [change.id, change]));
  const approved: LyricChange[] = [];
  for (const id of selected) {
    const change = allowed.get(id);
    const seen = proposal.changes.find((c) => c?.id === id);
    if (
      !change ||
      !seen ||
      change.at !== seen.at ||
      change.kind !== seen.kind ||
      change.insert !== seen.insert
    )
      return { ok: false, message: 'The suggestion changed. Ask for it again.' };
    approved.push(change);
  }
  let result = text;
  for (const change of approved.sort((a, b) => b.at - a.at))
    result = result.slice(0, change.at) + change.insert + result.slice(change.at);
  return { ok: true, value: result };
}
