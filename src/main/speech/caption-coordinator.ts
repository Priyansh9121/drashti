import { randomUUID } from 'node:crypto';
import type {
  CaptionCorrection,
  CaptionReview,
  CaptionRevision,
  CaptionTranslation,
  CaptionTranslationPort,
} from '../../shared/caption-coordinator';
import { CAPTION_LINE_CHARS, captionLines, type CaptionsShown, type CaptionSettings } from '../../shared/captions';
import { SPEECH_LANGUAGES } from '../../shared/speech';

export interface CaptionCoordinatorOptions {
  settings(): CaptionSettings;
  show(captions: CaptionsShown | null): void;
  changed(review: CaptionReview): void;
  translation?: CaptionTranslationPort;
  /** A later integration can select translation; absent a port, no translation is fabricated. */
  output?: 'source' | 'translation';
}

const textOf = (text: string): string => text.normalize('NFC').trim().replace(/\s+/gu, ' ');
const validText = (text: string): boolean => text.length > 0 && text.length <= 4_096;
const identity = (a: Pick<CaptionRevision, 'sessionId' | 'phraseId' | 'revision'>, b: CaptionRevision): boolean =>
  a.sessionId === b.sessionId && a.phraseId === b.phraseId && a.revision === b.revision;

/** Bounded memory only. Source revisions and asynchronous replies have independent validation. */
export class CaptionCoordinator {
  private version = 0;
  private sessionId: string | null = null;
  private current: CaptionRevision | null = null;
  private previous: CaptionRevision | null = null;
  private highestPhrase = 0;
  private visible = false;
  private translated: { clause: CaptionRevision; reply: CaptionTranslation } | null = null;
  private pending: CaptionRevision | null = null;
  private flight: { clause: CaptionRevision; abort: AbortController } | null = null;
  private omitted = 0;
  private shownAt = Number.NEGATIVE_INFINITY;
  private trailing: NodeJS.Timeout | null = null;
  private expiry: NodeJS.Timeout | null = null;

  constructor(private readonly options: CaptionCoordinatorOptions) {}

  start(): string {
    this.stop();
    this.sessionId = randomUUID();
    this.notify();
    return this.sessionId;
  }

  stop(): void {
    this.sessionId = null;
    this.current = null;
    this.previous = null;
    this.highestPhrase = 0;
    this.omitted = 0;
    this.clear();
    this.notify();
  }

  accept(clause: CaptionRevision): boolean {
    if (clause.sessionId !== this.sessionId || this.sessionId === null) return false;
    const sequence = /^s([1-9]\d*)$/u.exec(clause.phraseId)?.[1];
    const number = Number(sequence);
    if (!sequence || !Number.isSafeInteger(number) || number < this.highestPhrase ||
      !Number.isSafeInteger(clause.revision) || clause.revision < 1 ||
      !SPEECH_LANGUAGES.includes(clause.sourceLanguage) || !SPEECH_LANGUAGES.includes(clause.targetLanguage) ||
      !Number.isFinite(clause.startAt) || !Number.isFinite(clause.endAt) || clause.startAt > clause.endAt ||
      clause.endAt > Date.now() + 250 || Date.now() - clause.endAt > 10_000 ||
      !['provisional', 'settled'].includes(clause.status) || !validText(clause.sourceText) || !validText(textOf(clause.sourceText))) return false;
    if (number === this.highestPhrase && (!this.current || this.current.status !== 'provisional' ||
      clause.revision <= this.current.revision || clause.sourceLanguage !== this.current.sourceLanguage ||
      clause.targetLanguage !== this.current.targetLanguage)) return false;
    if (number > this.highestPhrase) this.previous = this.current;
    this.highestPhrase = number;
    this.current = Object.freeze({ ...clause, sourceText: textOf(clause.sourceText) });
    this.update();
    return true;
  }

  correct(correction: CaptionCorrection): boolean {
    if (!this.editable(correction) || !this.current || !validText(correction.text)) return false;
    const sourceText = textOf(correction.text);
    if (!validText(sourceText)) return false;
    this.current = Object.freeze({ ...this.current, revision: this.current.revision + 1, sourceText, status: 'corrected' });
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

  refresh(): void {
    if (this.visible) this.paint();
  }

  view(): CaptionReview {
    return {
      version: this.version,
      on: this.sessionId !== null,
      sessionId: this.sessionId,
      current: this.current ? { ...this.current } : null,
      previous: this.previous ? { ...this.previous } : null,
      busy: this.flight !== null && this.flight.clause.sessionId === this.sessionId,
      omitted: this.omitted,
    };
  }

  private editable(key: Omit<CaptionCorrection, 'text'>): boolean {
    return this.visible && this.current !== null && this.current.status !== 'provisional' && identity(key, this.current);
  }

  private notify(): void { this.version += 1; this.options.changed(this.view()); }

  private clear(): void {
    this.visible = false;
    this.translated = null;
    this.pending = null;
    this.flight?.abort.abort();
    if (this.trailing) clearTimeout(this.trailing);
    if (this.expiry) clearTimeout(this.expiry);
    this.trailing = null;
    this.expiry = null;
    this.shownAt = Number.NEGATIVE_INFINITY;
    this.options.show(null);
  }

  private update(): void {
    this.visible = true;
    // Any new source revision invalidates an old translation immediately. A correction never displays both texts.
    if (this.translated && this.current?.phraseId === this.translated.clause.phraseId) this.translated = null;
    this.flight?.abort.abort();
    this.pending = this.current?.status !== 'provisional' ? this.current : null;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => { this.clear(); this.notify(); }, 6_000);
    this.soon();
    this.pump();
    this.notify();
  }

  private soon(): void {
    const wait = this.shownAt + 300 - Date.now();
    if (wait <= 0) this.paint();
    else this.trailing ??= setTimeout(() => this.paint(), wait);
  }

  private paint(): void {
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = null;
    this.shownAt = Date.now();
    const translated = this.options.output === 'translation';
    const clause = translated ? this.translated?.clause : this.current;
    const text = translated ? this.translated?.reply.text : clause?.sourceText;
    if (!this.visible || !clause || !text) { this.options.show(null); return; }
    const settings = this.options.settings();
    const max = CAPTION_LINE_CHARS[settings.size];
    // Unlike the legacy roll-up, a single long token must also fit in the two-line prototype band.
    const words = text.split(/\s+/u).flatMap(word => {
      const letters = [...word];
      const pieces: string[] = [];
      for (let at = 0; at < letters.length; at += max) pieces.push(letters.slice(at, at + max).join(''));
      return pieces;
    });
    this.options.show({ ...settings, fit: true, language: translated ? clause.targetLanguage : clause.sourceLanguage, lines: captionLines(words, max) });
  }

  private pump(): void {
    if (this.flight || !this.pending || !this.options.translation) return;
    const clause = this.pending;
    this.pending = null;
    if (!this.visible || !this.current || !identity(clause, this.current)) return;
    if (Date.now() - clause.endAt > 10_000) { this.omitted += 1; this.notify(); return; }
    const flight = { clause, abort: new AbortController() };
    this.flight = flight;
    // An async boundary contains synchronous throws too. Words/errors never enter a log.
    const run = async (): Promise<void> => {
      const reply = await this.options.translation!.translate(clause, flight.abort.signal);
      if (flight.abort.signal.aborted || !this.visible || !this.current || !identity(clause, this.current) ||
        !identity(reply, clause) || reply.targetLanguage !== clause.targetLanguage ||
        typeof reply.text !== 'string' || !validText(reply.text) || !reply.modelId || !reply.routeId ||
        !Number.isFinite(reply.processingMs) || reply.processingMs < 0) return;
      if (Date.now() - clause.endAt > 10_000) { this.omitted += 1; return; }
      this.translated = { clause, reply: { ...reply, text: textOf(reply.text) } };
      this.soon();
    };
    void run().catch(() => {
      if (!flight.abort.signal.aborted && clause.sessionId === this.sessionId) this.omitted += 1;
    }).finally(() => {
      if (this.flight === flight) this.flight = null;
      this.pump();
      this.notify();
    });
  }
}
