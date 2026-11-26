import { createHash, randomUUID } from 'node:crypto';
import type {
  CaptionCorrection,
  CaptionReview,
  CaptionRevision,
  CaptionTranslation,
  CaptionTranslationPort,
  CaptionTranslationRequest,
} from '../../shared/caption-coordinator';
import { validCaptionText } from '../../shared/caption-coordinator';
import { captionClauseLines, captionTranslationLines } from '../../shared/caption-clause-lines';
import { CAPTION_LINE_CHARS, type CaptionsShown, type CaptionSettings } from '../../shared/captions';
import type { SpeechLanguage } from '../../shared/speech';

/**
 * The languages caption AI hears and translates between (x89's contract: Gujarati, Hindi, English). Sanskrit and "as
 * heard" stay with today's Whisper captions; they never reach the coordinator.
 */
const AI_LANGUAGES: readonly SpeechLanguage[] = ['gu', 'hi', 'en'];

export interface CaptionCoordinatorOptions {
  settings(): CaptionSettings;
  show(captions: CaptionsShown | null): void;
  changed(review: CaptionReview): void;
  translation?: CaptionTranslationPort;
  output?: 'source' | 'translation';
  /** Main's monotonic clock; tests inject their controlled clock. */
  clock?: () => number;
  /** Future integration must supply the authoritative lease; absent means no translation work. */
  mayTranslate?: () => boolean;
}

type StoredClause = CaptionRevision & {
  sourceHash: string;
  firstSettledAt: number | null;
  paintDeadlineAt: number | null;
  clearAt: number;
  pinned: boolean;
};
const textOf = (text: string): string => text.normalize('NFC').trim().replace(/\s+/gu, ' ');
const identity = (
  a: Pick<CaptionRevision, 'sessionId' | 'phraseId' | 'revision'>,
  b: CaptionRevision,
): boolean => a.sessionId === b.sessionId && a.phraseId === b.phraseId && a.revision === b.revision;
const hashOf = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Bounded, memory-only Main state. Neither a helper nor a renderer can publish a revision directly. */
export class CaptionCoordinator {
  private version = 0;
  private sessionId: string | null = null;
  private inputEpoch = '';
  private generation = 0;
  private policyEpoch = 0;
  private held = false;
  private current: StoredClause | null = null;
  private previous: StoredClause | null = null;
  private highestPhrase = 0;
  private visible = false;
  private translated: { clause: StoredClause; reply: CaptionTranslation; painted: boolean } | null = null;
  private pending: StoredClause | null = null;
  private flight: {
    clause: StoredClause;
    request: CaptionTranslationRequest;
    abort: AbortController;
    deadline: NodeJS.Timeout | null;
  } | null = null;
  private omitted = 0;
  /** The session's one source and target: a change of either needs a new session. */
  private pair: { source: SpeechLanguage; target: SpeechLanguage } | null = null;
  /** A stable clause whose translation failed: not asked again until its words change. */
  private failed: { sessionId: string; phraseId: string; revision: number } | null = null;
  /** Where the words may be shown (the audience screens or not): a change starts a new output-policy epoch. */
  private policyKey = '';
  private shownAt = Number.NEGATIVE_INFINITY;
  private trailing: NodeJS.Timeout | null = null;
  private expiry: NodeJS.Timeout | null = null;
  private translatedExpiry: NodeJS.Timeout | null = null;
  private readonly clock: () => number;
  private readonly translatorIdentity;

  constructor(private readonly options: CaptionCoordinatorOptions) {
    this.clock = options.clock ?? (() => performance.now());
    this.translatorIdentity = options.translation ? Object.freeze({ ...options.translation.identity }) : null;
  }

  inputEpochId(): string | null {
    return this.sessionId === null ? null : this.inputEpoch;
  }

  start(): string {
    this.stop();
    this.sessionId = randomUUID();
    this.inputEpoch = randomUUID();
    this.generation += 1;
    this.policyEpoch += 1;
    this.policyKey = this.policyOf();
    this.pair = null;
    this.failed = null;
    this.notify();
    return this.sessionId;
  }

  stop(): void {
    this.sessionId = null;
    this.pair = null;
    this.failed = null;
    this.current = null;
    this.previous = null;
    this.highestPhrase = 0;
    this.omitted = 0;
    this.generation += 1;
    this.clear();
    this.notify();
  }

  accept(clause: CaptionRevision): boolean {
    if (this.sessionId === null || clause.sessionId !== this.sessionId) return false;
    const sequence = /^s([1-9]\d*)$/u.exec(clause.phraseId)?.[1];
    const number = Number(sequence);
    const now = this.clock();
    // Heard times are Date.now(): mapped onto this clock as the two stand now, every time, so a wall-clock step (a
    // time sync, a Mac waking) mid-session never strands a phrase outside the freshness window (review M1).
    const offset = now - Date.now();
    const startAt = clause.startAt + (clause.timeDomain === 'main' ? 0 : offset);
    const endAt = clause.endAt + (clause.timeDomain === 'main' ? 0 : offset);
    if (
      !sequence ||
      !Number.isSafeInteger(number) ||
      number < this.highestPhrase ||
      !Number.isSafeInteger(clause.revision) ||
      clause.revision < 1 ||
      !AI_LANGUAGES.includes(clause.sourceLanguage) ||
      !AI_LANGUAGES.includes(clause.targetLanguage) ||
      (this.pair !== null &&
        (clause.sourceLanguage !== this.pair.source || clause.targetLanguage !== this.pair.target)) ||
      !Number.isFinite(startAt) ||
      !Number.isFinite(endAt) ||
      startAt < 0 ||
      startAt > endAt ||
      endAt > now + 250 ||
      now - endAt > 10_000 ||
      !['provisional', 'settled'].includes(clause.status) ||
      !validCaptionText(clause.sourceText, 4_096)
    )
      return false;
    const sourceText = textOf(clause.sourceText);
    if (!validCaptionText(sourceText, 4_096)) return false;
    if (number === this.highestPhrase) {
      if (
        this.current?.status !== 'provisional' ||
        clause.revision <= this.current.revision ||
        clause.sourceLanguage !== this.current.sourceLanguage ||
        clause.targetLanguage !== this.current.targetLanguage
      )
        return false;
      if (sourceText === this.current.sourceText && clause.status === this.current.status) return true;
    }
    if (number > this.highestPhrase) this.previous = this.current;
    this.highestPhrase = number;
    const firstSettledAt = clause.status === 'settled' ? now : null;
    const clearAt = now + 6_000;
    this.pair ??= { source: clause.sourceLanguage, target: clause.targetLanguage };
    this.current = Object.freeze({
      ...clause,
      // Its own frozen copy: the caller keeps no handle on what the coordinator holds.
      ...(clause.parent ? { parent: Object.freeze({ ...clause.parent }) } : {}),
      sourceText,
      startAt,
      endAt,
      sourceHash: hashOf(sourceText),
      firstSettledAt,
      paintDeadlineAt:
        firstSettledAt === null ? null : Math.min(endAt + 4_500, firstSettledAt + 2_500, clearAt),
      clearAt,
      pinned: false,
    });
    this.update();
    return true;
  }

  correct(correction: CaptionCorrection): boolean {
    if (!this.editable(correction) || !this.current || !validCaptionText(correction.text, 4_096))
      return false;
    const sourceText = textOf(correction.text);
    if (!validCaptionText(sourceText, 4_096)) return false;
    // A correction shows for its own full time from when it was made (review S1).
    const now = this.clock();
    const clearAt = now + 6_000;
    this.current = Object.freeze({
      ...this.current,
      revision: this.current.revision + 1,
      sourceText,
      sourceHash: hashOf(sourceText),
      status: 'corrected',
      pinned: true,
      clearAt,
      paintDeadlineAt: Math.min(now + 2_500, clearAt),
    });
    this.update();
    return true;
  }

  /** ASR can revise a committed clause, but never overwrite an operator-pinned correction. */
  reviseAutomatic(clause: CaptionRevision): boolean {
    // The settled clause before a provisional one is still eligible (for translation): revised in place, never
    // painted again over the newer source.
    const before = this.previous;
    if (
      before &&
      this.visible &&
      this.current?.status === 'provisional' &&
      clause.sessionId === this.sessionId &&
      clause.phraseId === before.phraseId &&
      !before.pinned &&
      before.status !== 'provisional' &&
      clause.revision > before.revision &&
      clause.status === 'corrected' &&
      clause.sourceLanguage === before.sourceLanguage &&
      clause.targetLanguage === before.targetLanguage &&
      validCaptionText(clause.sourceText, 4_096)
    ) {
      const sourceText = textOf(clause.sourceText);
      this.previous = Object.freeze({
        ...before,
        revision: clause.revision,
        sourceText,
        sourceHash: hashOf(sourceText),
        status: 'corrected',
      });
      this.update();
      return true;
    }
    if (
      !this.current ||
      !this.visible ||
      this.current.pinned ||
      clause.sessionId !== this.sessionId ||
      clause.phraseId !== this.current.phraseId ||
      clause.revision <= this.current.revision ||
      this.current.status === 'provisional' ||
      clause.status !== 'corrected' ||
      clause.sourceLanguage !== this.current.sourceLanguage ||
      clause.targetLanguage !== this.current.targetLanguage ||
      !validCaptionText(clause.sourceText, 4_096)
    )
      return false;
    const sourceText = textOf(clause.sourceText);
    this.current = Object.freeze({
      ...this.current,
      revision: clause.revision,
      sourceText,
      sourceHash: hashOf(sourceText),
      status: 'corrected',
    });
    this.update();
    return true;
  }

  dismiss(key: Omit<CaptionCorrection, 'text'>): boolean {
    if (!this.editable(key)) return false;
    this.current = null;
    this.clear();
    this.notify();
    return true;
  }

  /**
   * A phrase being heard that was left out whole (alpha.24, QA24-CAPCLEAN-1, review F4: every word of it was a word to
   * leave out) comes off the screens while it is still provisional there, as Dismiss phrase takes a settled one off.
   * Anything settled before it stays for the review. False when that phrase is not the one being heard.
   */
  withdraw(phraseId: string): boolean {
    if (this.current?.phraseId !== phraseId || this.current.status !== 'provisional') return false;
    this.current = null;
    this.clear();
    this.notify();
    return true;
  }

  /** The eventual L8 consumer calls this before revoking work; no show action waits for cancellation. */
  setTranslationHeld(held: boolean): void {
    if (this.held === held) {
      // The authoritative lease opened explicitly: start what waits (no new generation: nothing was revoked).
      if (!held) this.pump();
      return;
    }
    this.held = held;
    this.generation += 1;
    this.abortFlight();
    this.pending = held ? null : this.eligible();
    this.translated = null;
    if (this.options.output === 'translation') this.options.show(null);
    if (!held) this.pump();
    this.notify();
  }

  refresh(): void {
    const policy = this.policyOf();
    if (this.sessionId !== null && policy !== this.policyKey) {
      // Before the new audience choice applies: what was asked under the old one is dropped and asked again
      // (with its original deadline), never shown.
      this.policyKey = policy;
      this.policyEpoch += 1;
      this.abortFlight();
      this.translated = null;
      const eligible = this.eligible();
      this.pending = eligible && !this.failedMatches(eligible) ? eligible : null;
      this.pump();
      this.notify();
    }
    if (this.visible) this.paint();
  }

  private policyOf(): string {
    return this.options.settings().audience ? 'audience' : 'stage-stream';
  }

  private failedMatches(clause: StoredClause): boolean {
    return this.failed !== null && identity(this.failed, clause);
  }

  view(): CaptionReview {
    // A phrase that has left the screens (its time is up) is never shown as on them now: it is the previous one,
    // for review only, as it becomes when the next phrase comes (alpha.23, the review).
    const onScreens = this.visible ? this.current : null;
    const previous = this.visible ? this.previous : (this.current ?? this.previous);
    return {
      canCorrect: onScreens !== null && onScreens.status !== 'provisional',
      version: this.version,
      on: this.sessionId !== null,
      sessionId: this.sessionId,
      current: onScreens ? { ...onScreens } : null,
      previous: previous ? { ...previous } : null,
      busy:
        this.flight !== null &&
        !this.flight.abort.signal.aborted &&
        this.flight.clause.sessionId === this.sessionId,
      omitted: this.omitted,
    };
  }

  private editable(key: Omit<CaptionCorrection, 'text'>): boolean {
    return (
      this.visible &&
      this.current !== null &&
      this.current.status !== 'provisional' &&
      identity(key, this.current)
    );
  }
  private notify(): void {
    this.version += 1;
    this.options.changed(this.view());
  }
  private eligible(): StoredClause | null {
    const clause = this.current?.status === 'provisional' ? this.previous : this.current;
    return this.visible && clause && clause.status !== 'provisional' && this.clock() < clause.clearAt
      ? clause
      : null;
  }
  private abortFlight(): void {
    if (this.flight?.deadline) clearTimeout(this.flight.deadline);
    if (this.flight) this.flight.deadline = null;
    this.flight?.abort.abort();
  }
  private clear(): void {
    this.visible = false;
    this.translated = null;
    this.pending = null;
    this.abortFlight();
    if (this.trailing) clearTimeout(this.trailing);
    if (this.expiry) clearTimeout(this.expiry);
    if (this.translatedExpiry) clearTimeout(this.translatedExpiry);
    this.trailing = null;
    this.expiry = null;
    this.translatedExpiry = null;
    this.shownAt = Number.NEGATIVE_INFINITY;
    this.options.show(null);
  }

  private update(): void {
    this.visible = true;
    if (
      this.translated &&
      this.current?.phraseId === this.translated.clause.phraseId &&
      !identity(this.current, this.translated.clause)
    ) {
      this.translated = null;
      if (this.options.output === 'translation') this.options.show(null);
    }
    const eligible = this.eligible();
    if (this.flight && (!eligible || !identity(this.flight.clause, eligible))) {
      if (!this.flight.abort.signal.aborted && eligible && this.flight.clause.phraseId !== eligible.phraseId)
        this.omitted += 1;
      this.abortFlight();
    }
    if (this.pending && eligible && this.pending.phraseId !== eligible.phraseId) this.omitted += 1;
    this.pending =
      eligible &&
      !this.translatedMatches(eligible) &&
      !this.failedMatches(eligible) &&
      (!this.flight || !identity(this.flight.clause, eligible))
        ? eligible
        : null;
    if (this.expiry) clearTimeout(this.expiry);
    const clearAt = this.current?.clearAt ?? this.clock();
    this.expiry = setTimeout(
      () => {
        this.clear();
        this.notify();
      },
      Math.max(0, clearAt - this.clock()),
    );
    this.soon();
    this.pump();
    this.notify();
  }
  private translatedMatches(clause: StoredClause): boolean {
    return this.translated !== null && identity(this.translated.clause, clause);
  }
  private soon(): void {
    const wait = this.shownAt + 300 - this.clock();
    if (wait <= 0) this.paint();
    else this.trailing ??= setTimeout(() => this.paint(), wait);
  }
  private paint(): void {
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = null;
    const now = this.clock();
    this.shownAt = now;
    const target = this.options.output === 'translation';
    const bypass = target && this.current?.sourceLanguage === this.current?.targetLanguage;
    const clause = target && !bypass ? this.translated?.clause : this.current;
    const text = target && !bypass ? this.translated?.reply.text : clause?.sourceText;
    if (!this.visible || !clause || !text || now >= clause.clearAt) {
      this.options.show(null);
      return;
    }
    if (target && !bypass && this.translated && !this.translated.painted) {
      if (now >= (clause.paintDeadlineAt ?? 0)) {
        this.translated = null;
        this.omitted += 1;
        this.options.show(null);
        this.notify();
        return;
      }
      this.translated.painted = true;
    }
    const settings = this.options.settings();
    const lines =
      target && !bypass
        ? captionTranslationLines(text, CAPTION_LINE_CHARS[settings.size])
        : captionClauseLines(text, CAPTION_LINE_CHARS[settings.size]);
    if (!lines) {
      this.translated = null;
      this.omitted += 1;
      this.options.show(null);
      this.notify();
      return;
    }
    this.options.show({
      ...settings,
      fit: true,
      language: target ? clause.targetLanguage : clause.sourceLanguage,
      lines,
    });
  }

  private pump(): void {
    const port = this.options.translation;
    if (
      this.flight ||
      !this.pending ||
      !port ||
      !this.translatorIdentity ||
      this.held ||
      !this.options.mayTranslate?.()
    )
      return;
    const clause = this.pending;
    this.pending = null;
    const eligible = this.eligible();
    if (
      !eligible ||
      !identity(clause, eligible) ||
      clause.firstSettledAt === null ||
      clause.paintDeadlineAt === null
    )
      return;
    if (clause.sourceLanguage === clause.targetLanguage) return;
    const cutoff = clause.paintDeadlineAt - 350;
    if (this.clock() >= cutoff) {
      this.omitted += 1;
      this.notify();
      return;
    }
    const request: CaptionTranslationRequest = Object.freeze({
      ...clause,
      ...this.translatorIdentity,
      protocolVersion: 1,
      inputEpoch: this.inputEpoch,
      generation: this.generation,
      clauseId: clause.phraseId,
      clauseSequence: Number(clause.phraseId.slice(1)),
      sourceHash: clause.sourceHash,
      requestId: randomUUID(),
      sourceKind: 'speech-clause',
      outputPolicyEpoch: this.policyEpoch,
      asrIdentity: 'placeholder-recognizer/v1',
      firstSettledAt: clause.firstSettledAt,
      paintDeadlineAt: clause.paintDeadlineAt,
      clearAt: clause.clearAt,
    });
    const flight = { clause, request, abort: new AbortController(), deadline: null as NodeJS.Timeout | null };
    this.flight = flight;
    flight.deadline = setTimeout(
      () => {
        if (!flight.abort.signal.aborted) {
          this.omitted += 1;
          this.abortFlight();
          this.notify();
        }
      },
      Math.max(0, cutoff - this.clock()),
    );
    const run = async (): Promise<void> => {
      const reply = await port.translate(request, flight.abort.signal);
      const latest = this.eligible();
      if (
        flight.abort.signal.aborted ||
        !latest ||
        !identity(clause, latest) ||
        this.held ||
        !this.options.mayTranslate?.()
      )
        return;
      if (this.clock() >= cutoff) {
        this.omitted += 1;
        return;
      }
      const keys = [
        'protocolVersion',
        'sessionId',
        'inputEpoch',
        'generation',
        'clauseId',
        'clauseSequence',
        'phraseId',
        'revision',
        'sourceHash',
        'requestId',
        'sourceLanguage',
        'targetLanguage',
        'outputPolicyEpoch',
        'modelIdentity',
        'routeId',
        'processorId',
        'glossaryRevision',
      ] as const;
      if (
        keys.some((key) => reply[key] !== request[key]) ||
        reply.status !== 'ok' ||
        !validCaptionText(reply.text, 8_192) ||
        (reply.processingMs !== null && (!Number.isFinite(reply.processingMs) || reply.processingMs < 0))
      ) {
        this.omitted += 1;
        // Not asked again while its words are unchanged (more provisional source arriving is no reason).
        this.failed = { sessionId: clause.sessionId, phraseId: clause.phraseId, revision: clause.revision };
        return;
      }
      this.translated = { clause, reply: { ...reply, text: textOf(reply.text) }, painted: false };
      if (this.translatedExpiry) clearTimeout(this.translatedExpiry);
      this.translatedExpiry = setTimeout(
        () => {
          this.translated = null;
          if (this.options.output === 'translation') this.options.show(null);
        },
        Math.max(0, clause.clearAt - this.clock()),
      );
      this.soon();
    };
    void run()
      .catch(() => {
        if (!flight.abort.signal.aborted && clause.sessionId === this.sessionId) this.omitted += 1;
      })
      .finally(() => {
        if (flight.deadline) clearTimeout(flight.deadline);
        if (this.flight === flight) this.flight = null;
        this.pump();
        this.notify();
      });
  }
}
