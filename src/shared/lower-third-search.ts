import { animationById } from './lower-third-animations';
import { OFFERED_LIST, outName } from './lower-third-studio';
import type { LowerThirdTemplate } from './lower-third-templates';

/*
 * RED STUB (Session 58): today's matching, the studio's (StudioTabs.tsx's words and found, TemplatePicker.tsx's
 * substring search), so the tests show what it misses. The one search replaces it.
 */

export interface QuickWord {
  word: string;
  name: string;
  group: string;
}

export const searchWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/gu, ' ')
    .split(/\s+/u)
    .filter((w) => w !== '' && !['in', 'from', 'the', 'by', 'and', 'a', 'to', 'out'].includes(w));

export function findAnimations(query: string, side: 'in' | 'out'): typeof OFFERED_LIST {
  const asked = searchWords(query);
  if (asked.length === 0) return OFFERED_LIST;
  return OFFERED_LIST.filter(({ animation: a }) => {
    const has = [...searchWords(a.name), ...(side === 'out' ? searchWords(outName(a.id)) : []), ...a.keywords];
    return asked.every((w) => has.some((h) => h.startsWith(w)));
  });
}

export function findTemplates<T extends LowerThirdTemplate>(templates: readonly T[], query: string): T[] {
  const words = query.toLowerCase().trim().split(/\s+/u);
  return templates.filter((template) => {
    const text = [
      template.name,
      animationById(template.input.animation).name,
      template.direction,
      template.kind,
      template.feel,
      template.speed,
    ]
      .join(' ')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export const ANIMATION_QUICK_WORDS: readonly QuickWord[] = [];
export const TEMPLATE_QUICK_WORDS: readonly QuickWord[] = [];

export const hasQuickWord = (query: string, quick: QuickWord): boolean => query.includes(quick.word);

export const toggleQuickWord = (query: string, quick: QuickWord, all: readonly QuickWord[]): string =>
  all.length >= 0 ? `${query} ${quick.word}`.trim() : query;
