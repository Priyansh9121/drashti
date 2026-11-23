import { z } from 'zod';
import type { SpeechLanguage } from './speech';

/** Ephemeral phase D data. Never status/API/recovery/log data. */
export interface CaptionRevision {
  sessionId: string;
  phraseId: string;
  revision: number;
  sourceLanguage: SpeechLanguage;
  targetLanguage: SpeechLanguage;
  sourceText: string;
  startAt: number;
  endAt: number;
  /** Trusted adapter values use Main's monotonic clock. Legacy Heard envelopes are mapped once on ingress. */
  timeDomain?: 'main';
  status: 'provisional' | 'settled' | 'corrected';
  parent?: {
    enginePhraseId: string;
    observationSequence: number;
    rangeStart: number;
    rangeEnd: number;
    timingPrecision: 'phrase';
  };
}

export interface CaptionTranslationIdentity {
  modelIdentity: string;
  routeId: string;
  processorId: string;
  glossaryRevision: string;
}

export interface CaptionTranslationRequest extends CaptionRevision, CaptionTranslationIdentity {
  protocolVersion: 1;
  inputEpoch: string;
  generation: number;
  clauseId: string;
  clauseSequence: number;
  sourceHash: string;
  requestId: string;
  sourceKind: 'speech-clause';
  outputPolicyEpoch: number;
  asrIdentity: string;
  firstSettledAt: number;
  paintDeadlineAt: number;
  clearAt: number;
}

export interface CaptionTranslation extends CaptionTranslationIdentity {
  protocolVersion: 1;
  sessionId: string;
  inputEpoch: string;
  generation: number;
  clauseId: string;
  clauseSequence: number;
  phraseId: string;
  revision: number;
  sourceHash: string;
  requestId: string;
  sourceLanguage: SpeechLanguage;
  targetLanguage: SpeechLanguage;
  outputPolicyEpoch: number;
  text: string;
  status: 'ok' | 'cancelled' | 'expired' | 'held' | 'unavailable' | 'error';
  processingMs: number | null;
}

/** Implemented by translation later. Abort must cancel native work and settle the request. */
export interface CaptionTranslationPort {
  readonly identity: Readonly<CaptionTranslationIdentity>;
  translate(clause: Readonly<CaptionTranslationRequest>, signal: AbortSignal): Promise<CaptionTranslation>;
}

export interface CaptionCorrection extends Pick<CaptionRevision, 'sessionId' | 'phraseId' | 'revision'> {
  text: string;
}

export interface CaptionReview {
  version: number;
  canCorrect: boolean;
  on: boolean;
  sessionId: string | null;
  current: CaptionRevision | null;
  previous: CaptionRevision | null;
  busy: boolean;
  omitted: number;
}

/** Exact UTF-8 bounds and plain Unicode; unpaired surrogates are never repaired silently. */
export function validCaptionText(text: unknown, maxBytes: number): text is string {
  return typeof text === 'string' && text.length <= maxBytes && text.trim().length > 0 && new TextEncoder().encode(text).byteLength <= maxBytes && [...text].every(letter => {
    const code = letter.codePointAt(0)!;
    return (code >= 32 && code !== 127 && !(code >= 0xd800 && code <= 0xdfff)) || ['\n', '\r', '\t'].includes(letter);
  });
}

/** IPC accepts bounded plain text and optimistic identity tokens only. */
export const captionIdentitySchema = z.object({
  sessionId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/u),
  phraseId: z.string().regex(/^s[1-9]\d*$/u).max(32),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export const captionCorrectionSchema = captionIdentitySchema.extend({
  text: z.string().max(4_096).refine(text => validCaptionText(text, 4_096)),
});
