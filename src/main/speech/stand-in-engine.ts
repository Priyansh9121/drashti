import type { Heard, HeardWord } from '../../shared/speech';
import type { SpeechEngine } from './hub';

/*
 * A stand-in for the captions engine, for tests only (Session 55, Part 10): the test switch DRASHTI_TEST_SPEECH,
 * ignored by a packaged Drashti, names placeholder phrases ("alpha beta|gamma delta"), and this "hears" them in turn,
 * one every `everyMs`, each first half-heard and then whole. No sound, no model, no program: the hub, the captions
 * and the screens run as they do with the real engine.
 */
export function createStandInEngine(phrases: readonly string[], everyMs = 1_500): SpeechEngine {
  return {
    start(language, to) {
      to.state({ phase: 'listening', language });
      let n = 0;
      const timer = setInterval(() => {
        const text = phrases[n % Math.max(1, phrases.length)] ?? '';
        n += 1;
        const words = text
          .split(/\s+/u)
          .filter((w) => w !== '')
          .map((w) => w.normalize('NFC'));
        if (words.length === 0) return;
        const endAt = Date.now() - 500;
        const startAt = endAt - words.length * 300;
        const heard: HeardWord[] = words.map((w, i) => ({
          text: w,
          startAt: startAt + i * 300,
          endAt: startAt + i * 300 + 250,
          confidence: 0.9,
        }));
        const half = Math.ceil(words.length / 2);
        const base: Omit<Heard, 'final' | 'words' | 'text' | 'endAt' | 'heardAt'> = {
          id: `s${String(n)}`,
          language: language === 'auto' ? 'en' : language,
          languageConfidence: language === 'auto' ? 0.9 : null,
          startAt,
        };
        const partWords = heard.slice(0, half);
        to.heard({
          ...base,
          final: false,
          words: partWords,
          text: partWords.map((w) => w.text).join(' '),
          endAt: partWords.at(-1)?.endAt ?? startAt,
          heardAt: Date.now(),
        });
        to.heard({
          ...base,
          final: true,
          words: heard,
          text: words.join(' '),
          endAt: heard.at(-1)?.endAt ?? startAt,
          heardAt: Date.now(),
        });
      }, everyMs);
      return () => {
        clearInterval(timer);
      };
    },
  };
}
