import type { SpeechLanguage } from '../../../shared/speech';
import { plural } from '../../../shared/text';

/* The Caption Words dialog's words (alpha.22). */

/**
 * The line under the list: how many words this language has, and how many of them the captions engine is given as
 * hints (the first ones, as many as its 200-byte prompt holds), or why none are now.
 */
export function captionWordsHintText(
  name: string,
  count: number,
  hinted: number,
  listening: SpeechLanguage | 'auto',
  language: SpeechLanguage,
  _on = true,
): string {
  if (count === 0) return `No ${name} caption words yet.`;
  const words = plural(count, `${name} word`);
  if (listening === 'auto')
    return `${words}. With the language left as heard, spellings are fixed but the engine is given no hints.`;
  if (listening !== language) return `${words}, used when captions listen for ${name}.`;
  if (count === 1) return `${words}, given to the captions engine as a hint.`;
  if (hinted >= count) return `${words}, all given to the captions engine as hints.`;
  return `${words}. The first ${String(hinted)} fit in the captions engine’s hints, so put the most important first; all of them fix spellings.`;
}
