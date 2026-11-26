import type { ChatMessage } from '../../../shared/chat';

export const CHAT_POP_MS = 10_000;
export const CHAT_POP_FADE_MS = 200;
export const CHAT_POP_CHARS = 160;

export interface ChatPop {
  message: ChatMessage;
  more: number;
  at: number;
}

export type PopPhase = 'up' | 'leaving' | 'gone';

export function arrivals(
  before: readonly ChatMessage[] | null,
  messages: readonly ChatMessage[],
  meId: string,
): ChatMessage[] {
  if (before === null) return [];
  const seen = new Set(before.map((m) => m.id));
  return messages.filter((m) => !seen.has(m.id) && m.from.id !== meId);
}

export function popPhase(pop: ChatPop | null, now: number, still: boolean): PopPhase {
  if (!pop || now >= pop.at + CHAT_POP_MS + (still ? 0 : CHAT_POP_FADE_MS)) return 'gone';
  return now < pop.at + CHAT_POP_MS ? 'up' : 'leaving';
}

export function popChangesAt(pop: ChatPop | null, now: number, still: boolean): number | null {
  const phase = popPhase(pop, now, still);
  if (!pop || phase === 'gone') return null;
  return pop.at + CHAT_POP_MS + (phase === 'leaving' ? CHAT_POP_FADE_MS : 0);
}

export function popAfter(
  pop: ChatPop | null,
  came: readonly ChatMessage[],
  now: number,
  still: boolean,
): ChatPop | null {
  const message = came.at(-1);
  if (!message) return pop;
  return {
    message,
    more: came.length - 1 + (pop && popPhase(pop, now, still) !== 'gone' ? pop.more + 1 : 0),
    at: now,
  };
}

/** Bound the words without cutting a grapheme; CSS also clamps wrapped text to two lines. */
export function popText(text: string): string {
  const lines = text.split('\n');
  const two = lines.slice(0, 2).join('\n');
  if (two.length < CHAT_POP_CHARS && lines.length <= 2) return two;
  let kept = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(two)) {
    if (kept.length + segment.length > CHAT_POP_CHARS - 1) break;
    kept += segment;
  }
  return `${kept.trimEnd()}…`;
}

export function popWords(pop: ChatPop): { from: string; text: string; more: string | null } {
  return {
    from: `Chat from ${pop.message.from.name}:`,
    text: popText(pop.message.text),
    more: pop.more ? `and ${String(pop.more)} more` : null,
  };
}
