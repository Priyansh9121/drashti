import type { CaptionRevision } from '../../shared/caption-coordinator';
import type { Heard, SpeechLanguage } from '../../shared/speech';
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

export function createCaptionFlow(_options: CaptionFlowOptions): CaptionFlow {
  return {
    start() {},
    stop() {},
    refresh() {},
  };
}
