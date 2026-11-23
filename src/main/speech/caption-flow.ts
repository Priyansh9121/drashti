import type { CaptionRevision } from '../../shared/caption-coordinator';
import { toGujaratiScript } from '../../shared/scripts';
import type { Heard, SpeechState } from '../../shared/speech';
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

/**
 * The glossary's spelling fixer (cap-glossary's spellingFixer): a phrase with near-miss words put right, whole words
 * only and in the phrase's own language only, each word keeping its times.
 */
export type CaptionSpelling = (h: Heard) => Heard;

export interface CaptionFlowOptions {
  hub: SpeechHub;
  coordinator: ClauseSink;
  spelling?: CaptionSpelling;
  /** The local sound recorder's draft gets each final phrase with the glossary's spelling (never a correction). */
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

  const heard = (given: Heard): void => {
    if (sessionId === null) return;
    // The glossary first, on the words as the recognizer gave them; then, as today's feed, Sanskrit in Gujarati
    // letters (the draft gets the same words).
    const h = options.spelling ? options.spelling(given) : given;
    const words =
      h.language === 'sa'
        ? h.words.map((word) => ({ ...word, text: toGujaratiScript(word.text).normalize('NFC') }))
        : h.words;
    const text = words
      .map((w) => w.text)
      .join(' ')
      .normalize('NFC')
      .trim();
    if (h.final) options.onFinalPhrase?.(h.language === 'sa' || h !== given ? { ...h, words, text } : h);
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

/** What runs the captions on the screens: today's feed (src/main/speech/captions-feed.ts) or caption AI's flow. */
export interface CaptionPath {
  start(): void;
  stop(): void;
  refresh(): void;
}

export interface CaptionPaths extends CaptionPath {
  /** The admin changed which one is chosen: while captions run, the other one takes over at once. */
  reselect(): void;
}

/**
 * Today's feed or caption AI's flow, whichever is chosen when captions start (never both). A change while they run
 * stops the one running, starts listening again (so the recognizer starts with the right model) and starts the other.
 * With caption AI not chosen, every call goes to today's feed as before.
 */
export function chooseCaptionPath(
  today: CaptionPath,
  ai: CaptionPath,
  useAi: () => boolean,
  listenAgain: () => void,
): CaptionPaths {
  let running: CaptionPath | null = null;
  const chosen = (): CaptionPath => (useAi() ? ai : today);
  return {
    start() {
      if (running) return;
      running = chosen();
      running.start();
    },
    stop() {
      const was = running ?? chosen();
      running = null;
      was.stop();
    },
    refresh() {
      (running ?? chosen()).refresh();
    },
    reselect() {
      if (!running) return;
      const next = chosen();
      if (next === running) return;
      running.stop();
      running = null;
      listenAgain();
      running = next;
      next.start();
    },
  };
}
