import type { CaptionRevision } from '../../shared/caption-coordinator';
import { toGujaratiScript } from '../../shared/scripts';
import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import type { SpeechHub } from './speech-hub';

/*
 * Caption AI's path (alpha.22, cap-integration): what the speech hub hears goes to the captions coordinator (Codex
 * x90) as clauses with a session and a revision, provisional while heard and settled when final, each first put
 * right by the captions glossary (cap-glossary). Off until chosen: today's captions feed runs exactly as before.
 */

/** What this path needs of the coordinator (src/main/speech/caption-coordinator.ts). */
export interface ClauseSink {
  /** A new session: its id. Every clause before it is refused from now on. */
  start(): string;
  /** No session: off the screens at once. */
  stop(): void;
  accept(clause: CaptionRevision): boolean;
  /** The settings changed: draw again. */
  refresh(): void;
}

/** The glossary's spelling fixer (cap-glossary): whole words only, the same language only. */
export interface CaptionSpelling {
  fix(text: string, language: SpeechLanguage): string;
}

export interface CaptionFlowOptions {
  hub: SpeechHub;
  coordinator: ClauseSink;
  spelling?: CaptionSpelling;
  /** The local sound recorder's draft gets final phrases as today's feed gives them. */
  onFinalPhrase?: (phrase: Heard) => void;
}

export interface CaptionFlow {
  start(): void;
  stop(): void;
  refresh(): void;
}

export function createCaptionFlow(options: CaptionFlowOptions): CaptionFlow {
  let unlisten: (() => void) | null = null;
  let unwatch: (() => void) | null = null;
  let sessionId: string | null = null;
  // Only the phrase being heard: its id, last revision, words (after the glossary) and whether it is final.
  let last: { id: string; revision: number; text: string; final: boolean } | null = null;

  const end = (): void => {
    sessionId = null;
    last = null;
    options.coordinator.stop();
  };

  // Every start of listening is a session of its own: ids run from s1 again, so nothing of the last one may show.
  const watch = (s: SpeechState): void => {
    if (s.phase === 'listening') {
      if (sessionId === null) {
        sessionId = options.coordinator.start();
        last = null;
      }
    } else if (sessionId !== null) end();
  };

  const heard = (h: Heard): void => {
    if (sessionId === null) return;
    // As today's feed: Sanskrit in Gujarati letters, and the draft gets the same converted words.
    const words =
      h.language === 'sa'
        ? h.words.map((word) => ({ ...word, text: toGujaratiScript(word.text).normalize('NFC') }))
        : h.words;
    const said = words.map((w) => w.text).join(' ');
    if (h.final) options.onFinalPhrase?.(h.language === 'sa' ? { ...h, words, text: said } : h);
    const text = (options.spelling ? options.spelling.fix(said, h.language) : said).normalize('NFC').trim();
    if (text === '') return;
    const same = last !== null && last.id === h.id;
    if (same && last !== null && (last.final || (last.text === text && !h.final))) return;
    const revision = same && last !== null ? last.revision + 1 : 1;
    last = { id: h.id, revision, text, final: h.final };
    options.coordinator.accept({
      sessionId,
      phraseId: h.id,
      revision,
      sourceLanguage: h.language,
      targetLanguage: h.language,
      sourceText: text,
      startAt: h.startAt,
      endAt: h.endAt,
      status: h.final ? 'settled' : 'provisional',
    });
  };

  return {
    start() {
      if (unlisten) return;
      unwatch = options.hub.onState(watch);
      unlisten = options.hub.listen('captions', heard);
      watch(options.hub.state());
    },
    stop() {
      unlisten?.();
      unwatch?.();
      unlisten = null;
      unwatch = null;
      end();
    },
    refresh() {
      options.coordinator.refresh();
    },
  };
}
