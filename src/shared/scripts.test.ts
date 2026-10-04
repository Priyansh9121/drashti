import { describe, expect, it } from 'vitest';
import { toDevanagari, toGujaratiScript } from './scripts';
import { transliterate } from './translit';

/* Sanskrit in either script, and its transliteration (placeholder words only). */

describe('Devanagari and Gujarati script', () => {
  it('writes Devanagari letters in Gujarati script, letter for letter', () => {
    expect(toGujaratiScript('नमूना श्लोकः')).toBe('નમૂના શ્લોકઃ');
    expect(toGujaratiScript('कमल १४')).toBe('કમલ ૧૪');
  });

  it('goes back the other way, keeping the dandas both scripts use', () => {
    const line = 'नमूना श्लोकः ॥ १४ ॥';
    const gujarati = toGujaratiScript(line);
    expect(gujarati).toContain('॥');
    expect(toDevanagari(gujarati)).toBe(line);
  });

  it('keeps what the other script does not have, and anything that is not Indic', () => {
    expect(toGujaratiScript('ऴ Placeholder')).toBe('ऴ Placeholder');
    expect(toDevanagari('Placeholder ૱')).toBe('Placeholder ૱');
  });
});

describe('transliterating Sanskrit', () => {
  it('keeps every "a", where Hindi and Gujarati drop the silent ones', () => {
    expect(transliterate('कमल')).toBe('kamal');
    expect(transliterate('कमल', 'plain', { sanskrit: true })).toBe('kamala');
    expect(transliterate('કમલ', 'iso', { sanskrit: true })).toBe('kamala');
  });
});
