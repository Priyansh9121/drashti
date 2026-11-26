import type {
  CaptionTranslation,
  CaptionTranslationIdentity,
  CaptionTranslationPort,
  CaptionTranslationRequest,
} from '../../shared/caption-coordinator';
import {
  TRANSLATED_SPEECH,
  TRANSLATION_STOP_AFTER_LATE,
  translationTarget,
  type CaptionTarget,
  type CaptionTranslationStatus,
  type CaptionTranslationUnavailable,
  type SpokenTimes,
} from '../../shared/caption-translation';
import type { TranslationLanguage } from '../../shared/prepared-translations';
import { normalizeSpokenTimes } from '../../shared/spoken-times';
import { HelperError } from '../translation/translation-helper';
import type { SpeechLanguage } from '../../shared/speech';
import type { CaptionSkip } from './caption-coordinator';

/*
 * Translated live captions' engine side (alpha.24, QA24-CAPLANG-2; the owner's 2a-2f, all A): the captions
 * coordinator's translation slot (x89's CaptionTranslationPort). Each settled phrase goes, after the spoken-times
 * seam (a24-captime's normalizeSpokenTimes: "sava aath" -> 8:15, 2e), to its own TranslationEngine: the pack's
 * IndicTrans2 through drashti-translate, greedy (beam 1, a24-caplang2's measurements: beam 5 is no better on short
 * phrases and twice as slow), two threads, below the show, one model kept loaded for the chosen pair while captions
 * run. Prepare translations' own engine is a different one, and still waits while on air; this one never stops for
 * going on air. An abort is answered at once (the engine finishes the phrase in the background: ending the helper
 * would cost a second at the next phrase). A failure is answered with no words and its fault kept in plain words for
 * the dialog. Skips are counted; after TRANSLATION_STOP_AFTER_LATE late ones in a row, translated captions stop on
 * this computer and say so (2f): the audience screens and the stream then show nothing, never the speaker's language
 * by themselves (2c), and the stage keeps the speaker's words. No word heard is ever logged.
 */

/** What live translation needs of the translation engine (main/translation/translation-engine.ts). */
export interface LiveTranslationEngine {
  installed(): boolean;
  available(from: TranslationLanguage, to: TranslationLanguage): boolean;
  unknownModel(from: TranslationLanguage, to: TranslationLanguage): boolean;
  /** Load the pair's model now, so the first phrase does not wait for it. */
  prepare(from: TranslationLanguage, to: TranslationLanguage): Promise<void>;
  translate(source: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string>;
  /** Let the model and the helper go. */
  stop(): void;
}

export interface LiveTranslationOptions {
  engine: LiveTranslationEngine;
  /** The spoken-times seam, applied to the speaker's words just before translating (normalizeSpokenTimes when left out). */
  spokenTimes?: SpokenTimes;
  log: { info(line: string): void; warn(line: string): void };
  /** How translated captions stand changed (a skip, a fault): tell the dialog. */
  changed?: () => void;
  /** Translation began for a pair (lead 2's decision a: Prepare translations' drafts stop and wait meanwhile). */
  onBegin?: () => void;
}

/**
 * Whether File › Caption Language lets a translation be chosen: where it is offered, or where choosing again mends
 * it (a24-review F3: translation's own stop for slowness, or the engine's fault; choosing again tries once more).
 */
export function translationChoosable(status: CaptionTranslationStatus): boolean {
  return status.offered || status.unavailable === 'too-slow' || status.unavailable === 'engine-fault';
}

const isTranslated = (language: SpeechLanguage): language is TranslationLanguage =>
  TRANSLATED_SPEECH.includes(language);

/** The engine's refusals that are about one phrase only (too long, a model marker): the engine carries on. */
const PHRASE_ONLY = new Set(['too-long', 'special-token']);

const TOO_SLOW =
  'This computer is too slow for translated captions, so they stopped: the stage still shows the speaker’s words. Choose Captions in again to try once more.';

export class LiveTranslation implements CaptionTranslationPort {
  readonly identity: Readonly<CaptionTranslationIdentity> = Object.freeze({
    modelIdentity: 'indictrans2-dist-int8',
    routeId: 'live-greedy',
    processorId: 'indictrans-text',
    glossaryRevision: 'none',
  });
  private pair: { from: TranslationLanguage; to: TranslationLanguage } | null = null;
  private skippedCount = 0;
  private lateInARow = 0;
  private slow = false;
  /** The engine stopped or failed (not one phrase): no more asks until chosen again or captions start again. */
  private faulted = false;
  private fault: string | null = null;

  constructor(private readonly o: LiveTranslationOptions) {}

  /** Captions start translating this pair: counted afresh, the model loaded now. */
  begin(from: SpeechLanguage, to: SpeechLanguage): void {
    this.skippedCount = 0;
    this.lateInARow = 0;
    this.slow = false;
    this.faulted = false;
    this.fault = null;
    if (!isTranslated(from) || !isTranslated(to) || from === to) {
      this.pair = null;
      return;
    }
    this.pair = { from, to };
    this.o.onBegin?.();
    this.load();
    this.o.changed?.();
  }

  /** Translating a pair now (begun, not yet ended), stopped or not. */
  running(): boolean {
    return this.pair !== null;
  }

  /**
   * The operator chose "Captions in" again: a stop for slowness or the engine's fault is forgotten and translation
   * tried once more (the model loaded again). The skip count runs on.
   */
  retry(): void {
    const again = this.slow || this.faulted;
    this.lateInARow = 0;
    this.slow = false;
    this.faulted = false;
    this.fault = null;
    if (again && this.pair) this.load();
    this.o.changed?.();
  }

  /** Load the pair's model now; a model that cannot load is the engine's fault. */
  private load(): void {
    const pair = this.pair;
    if (!pair) return;
    this.o.engine.prepare(pair.from, pair.to).catch((error: unknown) => {
      if (this.pair !== pair) return;
      this.faulted = true;
      this.setFault(error);
    });
  }

  /** Captions stopped translating (off, or the speaker's own words chosen): the model is let go. */
  end(): void {
    this.pair = null;
    this.o.engine.stop();
  }

  /** The coordinator's lease: translating a pair, and not stopped as too slow. */
  may(): boolean {
    return this.pair !== null && !this.slow && !this.faulted;
  }

  async translate(
    clause: Readonly<CaptionTranslationRequest>,
    signal: AbortSignal,
  ): Promise<CaptionTranslation> {
    const t0 = performance.now();
    const answer = (text: string, status: CaptionTranslation['status']): CaptionTranslation => ({
      protocolVersion: 1,
      sessionId: clause.sessionId,
      inputEpoch: clause.inputEpoch,
      generation: clause.generation,
      clauseId: clause.clauseId,
      clauseSequence: clause.clauseSequence,
      phraseId: clause.phraseId,
      revision: clause.revision,
      sourceHash: clause.sourceHash,
      requestId: clause.requestId,
      sourceLanguage: clause.sourceLanguage,
      targetLanguage: clause.targetLanguage,
      outputPolicyEpoch: clause.outputPolicyEpoch,
      modelIdentity: clause.modelIdentity,
      routeId: clause.routeId,
      processorId: clause.processorId,
      glossaryRevision: clause.glossaryRevision,
      text,
      status,
      processingMs: status === 'ok' ? performance.now() - t0 : null,
    });
    const from = clause.sourceLanguage;
    const to = clause.targetLanguage;
    if (signal.aborted) return answer('', 'cancelled');
    if (!isTranslated(from) || !isTranslated(to) || from === to) return answer('', 'unavailable');
    // Gujarati, Hindi and English speakers only (`from` is one of them here); never what the stage shows.
    const words = (this.o.spokenTimes ?? normalizeSpokenTimes)(clause.sourceText, from);
    const aborted = new Promise<CaptionTranslation>((resolve) => {
      signal.addEventListener('abort', () => resolve(answer('', 'cancelled')), { once: true });
    });
    const translated = this.o.engine.translate(words, from, to).then(
      (text) => answer(text, 'ok'),
      (error: unknown) => {
        if (signal.aborted) return answer('', 'cancelled');
        // Captions stopped meanwhile (the helper was let go): no fault of the engine's.
        if (this.pair === null) return answer('', 'error');
        if (error instanceof HelperError && !PHRASE_ONLY.has(error.code) && !this.faulted) {
          // The phrase it failed on is skipped too: counted here, as the coordinator's lease is now closed.
          this.faulted = true;
          this.skippedCount += 1;
        }
        this.setFault(error);
        return answer('', 'error');
      },
    );
    return Promise.race([translated, aborted]);
  }

  /** The coordinator skipped a phrase (2c): counted; late ones in a row stop translated captions here (2f). */
  skipped(why: CaptionSkip): void {
    // Not translating, or already stopped or faulted: nothing to count, and the fault's words stay (a24-review F2).
    if (this.pair === null || this.slow || this.faulted) return;
    this.skippedCount += 1;
    if (why === 'late') this.lateInARow += 1;
    if (!this.slow && this.lateInARow >= TRANSLATION_STOP_AFTER_LATE) {
      this.slow = true;
      this.fault = TOO_SLOW;
      this.o.log.warn(
        `Captions: translations came too late ${String(this.lateInARow)} times in a row, so translated captions stop on this computer.`,
      );
    }
    this.o.changed?.();
  }

  /** A translation reached the screens: the late ones in a row start again from none. */
  shown(): void {
    this.lateInARow = 0;
  }

  /**
   * How translated captions stand for these choices on this computer. `captionsTooSlow`: live captions themselves
   * stopped here as too slow (2f).
   */
  status(
    speaker: SpeechLanguage | 'auto',
    target: CaptionTarget | undefined,
    captionsTooSlow: boolean,
  ): CaptionTranslationStatus {
    const to = translationTarget(speaker, target);
    const unavailable = this.unavailable(speaker, captionsTooSlow);
    return {
      target: to,
      offered: unavailable === null,
      unavailable,
      skipped: this.skippedCount,
      fault: this.fault,
    };
  }

  private unavailable(
    speaker: SpeechLanguage | 'auto',
    captionsTooSlow: boolean,
  ): CaptionTranslationUnavailable | null {
    if (speaker === 'auto') return 'speaker-as-heard';
    if (!isTranslated(speaker)) return 'speaker-sanskrit';
    const engine = this.o.engine;
    if (!engine.installed()) return 'no-engine';
    // By this computer alone, whatever "Captions in" says (lead 2's contract): both other languages from this speaker.
    for (const t of TRANSLATED_SPEECH) {
      if (t === speaker || !isTranslated(t) || engine.available(speaker, t)) continue;
      return engine.unknownModel(speaker, t) ? 'unknown-model' : 'no-pack';
    }
    // The engine's own fault is said first, never hidden behind "too slow" (a24-review F2).
    if (this.faulted) return 'engine-fault';
    if (captionsTooSlow || this.slow) return 'too-slow';
    return null;
  }

  private setFault(error: unknown): void {
    this.fault =
      error instanceof Error && error.message !== ''
        ? error.message
        : 'The translation engine could not translate a phrase.';
    this.o.log.warn('Captions: a translation failed (its words are not logged).');
    this.o.changed?.();
  }
}
