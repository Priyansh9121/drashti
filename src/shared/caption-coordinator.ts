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
  status: 'provisional' | 'settled' | 'corrected';
}

export interface CaptionTranslation extends Pick<CaptionRevision, 'sessionId' | 'phraseId' | 'revision'> {
  targetLanguage: SpeechLanguage;
  text: string;
  routeId: string;
  modelId: string;
  processingMs: number;
}

/** Implemented by translation later; one active request, newest pending revision only. */
export interface CaptionTranslationPort {
  translate(clause: Readonly<CaptionRevision>, signal: AbortSignal): Promise<CaptionTranslation>;
}

export interface CaptionCorrection extends Pick<CaptionRevision, 'sessionId' | 'phraseId' | 'revision'> {
  text: string;
}

export interface CaptionReview {
  on: boolean;
  sessionId: string | null;
  current: CaptionRevision | null;
  previous: CaptionRevision | null;
  busy: boolean;
  omitted: number;
}
