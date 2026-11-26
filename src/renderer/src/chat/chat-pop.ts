import type { ChatMessage } from '../../../shared/chat';

/*
 * The chat's popup in the operator window (alpha.24, QA24-CHATPOP-1): not built yet (red first).
 */

export const CHAT_POP_MS = 0;
export const CHAT_POP_FADE_MS = 0;
export const CHAT_POP_CHARS = 0;

export interface ChatPop {
  message: ChatMessage;
  more: number;
  at: number;
}

export type PopPhase = 'up' | 'leaving' | 'gone';

export function arrivals(
  _before: readonly ChatMessage[] | null,
  _messages: readonly ChatMessage[],
  _meId: string,
): ChatMessage[] {
  return [];
}

export function popPhase(_pop: ChatPop | null, _now: number, _still: boolean): PopPhase {
  return 'gone';
}

export function popChangesAt(_pop: ChatPop | null, _now: number, _still: boolean): number | null {
  return null;
}

export function popAfter(
  pop: ChatPop | null,
  _came: readonly ChatMessage[],
  _now: number,
  _still: boolean,
): ChatPop | null {
  return pop;
}

export function popText(text: string): string {
  return text;
}

export function popWords(pop: ChatPop): { from: string; text: string; more: string | null } {
  return { from: pop.message.from.name, text: pop.message.text, more: null };
}
