import type { CaptionRevision } from '../../shared/caption-coordinator';
import type { SpeechLanguage } from '../../shared/speech';

export interface CaptionObservation {
  sessionId: string;
  inputEpoch: string;
  enginePhraseId: string;
  sequence: number;
  text: string;
  final: boolean;
  startAt: number;
  endAt: number;
  observedAt: number;
  forcedContinuation?: boolean;
  overlap?: { previousEnginePhraseId: string; previousRange: readonly [number, number]; currentRange: readonly [number, number] };
}
export interface CaptionStabilizerOptions {
  sessionId: string;
  inputEpoch: string;
  sourceLanguage: SpeechLanguage;
  targetLanguage: SpeechLanguage;
  emit(clause: CaptionRevision): void;
  omitted(reason: 'invalid-observation' | 'ambiguous-overlap' | 'changed-frontier'): void;
}
/** Trusted Main adapter; no second hub final is emitted for a later clause correction. */
export class CaptionStabilizer {
  constructor(_options: CaptionStabilizerOptions) {}
  observe(_observation: CaptionObservation): boolean { return false; }
}
