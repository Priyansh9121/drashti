import { validCaptionText, type CaptionRevision } from '../../shared/caption-coordinator';
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
  /** Unicode scalar offsets in NFC, single-space parent texts; ranges must end at whole words/graphemes. */
  overlap?: {
    previousEnginePhraseId: string;
    previousRange: readonly [number, number];
    currentRange: readonly [number, number];
  };
}
export interface CaptionStabilizerOptions {
  sessionId: string;
  inputEpoch: string;
  sourceLanguage: SpeechLanguage;
  targetLanguage: SpeechLanguage;
  emit(clause: CaptionRevision): void;
  omitted(reason: 'invalid-observation' | 'ambiguous-overlap' | 'changed-frontier'): void;
}
interface Clause {
  id: string;
  revision: number;
  text: string;
  from: number;
  to: number;
}
interface Parent {
  observation: CaptionObservation;
  words: string[];
  since: number[];
  frontier: number;
  active: Clause | null;
  latest: Clause | null;
}
const normalized = (text: string): string => text.normalize('NFC').trim().replace(/\s+/gu, ' ');
const scalarLength = (text: string): number => Array.from(text).length;

/** One bounded parent observation, one active clause and its latest committed range. No transcript/cache. */
export class CaptionStabilizer {
  private parent: Parent | null = null;
  private highestParent = 0;
  private nextClause = 1;
  constructor(private readonly options: CaptionStabilizerOptions) {}

  observe(observation: CaptionObservation): boolean {
    if (
      observation.sessionId !== this.options.sessionId ||
      observation.inputEpoch !== this.options.inputEpoch
    )
      return false;
    const parentNumber = /^s([1-9]\d*)$/u.exec(observation.enginePhraseId)?.[1];
    const sequence = Number(parentNumber);
    if (
      !parentNumber ||
      !Number.isSafeInteger(sequence) ||
      sequence < this.highestParent ||
      !Number.isSafeInteger(observation.sequence) ||
      observation.sequence < 1 ||
      !Number.isFinite(observation.startAt) ||
      !Number.isFinite(observation.endAt) ||
      !Number.isFinite(observation.observedAt) ||
      observation.startAt > observation.endAt ||
      observation.endAt > observation.observedAt + 250 ||
      observation.endAt - observation.startAt > 12_000 ||
      !validCaptionText(observation.text, 4_096)
    )
      return this.omit('invalid-observation');
    const text = normalized(observation.text);
    const words = text.split(' ');
    const obs = { ...observation, text };
    const old = this.parent;
    if (
      sequence === this.highestParent &&
      old &&
      (old.observation.final ||
        observation.sequence <= old.observation.sequence ||
        observation.observedAt < old.observation.observedAt)
    )
      return false;
    if (!old || sequence > this.highestParent) {
      let frontier = 0;
      if (observation.forcedContinuation) {
        const overlap = observation.overlap;
        if (
          !old ||
          overlap?.previousEnginePhraseId !== old.observation.enginePhraseId ||
          !old.observation.final
        )
          return this.omit('ambiguous-overlap');
        const before = Array.from(old.observation.text);
        const after = Array.from(text);
        const [from, to] = overlap.previousRange;
        const [start, end] = overlap.currentRange;
        if (
          ![from, to, start, end].every(Number.isSafeInteger) ||
          from < 0 ||
          from >= to ||
          to !== before.length ||
          start !== 0 ||
          end <= 0 ||
          end > after.length ||
          before.slice(from, to).join('') !== after.slice(start, end).join('') ||
          (from > 0 && before[from - 1] !== ' ') ||
          (end < after.length && after[end] !== ' ')
        )
          return this.omit('ambiguous-overlap');
        frontier = after.slice(0, end).join('').split(' ').length;
      } else if (observation.overlap) return this.omit('ambiguous-overlap');
      this.highestParent = sequence;
      this.parent = {
        observation: obs,
        words,
        since: words.map(() => observation.observedAt),
        frontier,
        active: null,
        latest: null,
      };
    } else {
      const frontierChanged =
        old.words.slice(0, old.frontier).join(' ') !== words.slice(0, old.frontier).join(' ');
      if (frontierChanged) {
        const latest = old.latest;
        const changed = old.words
          .slice(0, old.frontier)
          .flatMap((word, index) => (word !== words[index] ? [index] : []));
        if (
          !latest ||
          words.length < old.frontier ||
          changed.some((index) => index < latest.from || index >= latest.to) ||
          (words.length !== old.words.length && changed.length !== 1)
        )
          return this.omit('changed-frontier');
        latest.revision += 1;
        latest.text = words.slice(latest.from, latest.to).join(' ');
        this.emit(latest, 'corrected', obs, words);
      }
      old.since = words.map((word, index) =>
        word === old.words[index] ? (old.since[index] ?? observation.observedAt) : observation.observedAt,
      );
      old.words = words;
      old.observation = obs;
    }
    const parent = this.parent;
    if (!parent) return false;
    if (observation.final) {
      if (parent.frontier < words.length) this.settle(words.length);
      return true;
    }
    let stableEnd = parent.frontier;
    while (
      stableEnd < words.length &&
      observation.observedAt - (parent.since[stableEnd] ?? observation.observedAt) >= 500
    )
      stableEnd += 1;
    if (stableEnd - parent.frontier >= 5) this.settle(stableEnd);
    if (parent.frontier < words.length) {
      const text = words.slice(parent.frontier).join(' ');
      parent.active ??= {
        id: `s${String(this.nextClause++)}`,
        revision: 0,
        text: '',
        from: parent.frontier,
        to: words.length,
      };
      if (parent.active.text !== text) {
        parent.active.text = text;
        parent.active.to = words.length;
        parent.active.revision += 1;
        this.emit(parent.active, 'provisional', obs, words);
      }
    }
    return true;
  }

  private settle(to: number): void {
    const parent = this.parent;
    if (!parent) return;
    const active = parent.active ?? {
      id: `s${String(this.nextClause++)}`,
      revision: 0,
      text: '',
      from: parent.frontier,
      to,
    };
    active.revision += 1;
    active.text = parent.words.slice(parent.frontier, to).join(' ');
    active.to = to;
    this.emit(active, 'settled', parent.observation, parent.words);
    parent.latest = active;
    parent.active = null;
    parent.frontier = to;
  }
  private emit(
    clause: Clause,
    status: CaptionRevision['status'],
    observation: CaptionObservation,
    words: string[],
  ): void {
    const rangeStart = scalarLength(words.slice(0, clause.from).join(' ')) + (clause.from > 0 ? 1 : 0);
    this.options.emit({
      sessionId: this.options.sessionId,
      phraseId: clause.id,
      revision: clause.revision,
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: this.options.targetLanguage,
      sourceText: clause.text,
      startAt: observation.startAt,
      endAt: observation.endAt,
      timeDomain: 'main',
      status,
      parent: {
        enginePhraseId: observation.enginePhraseId,
        observationSequence: observation.sequence,
        rangeStart,
        rangeEnd: rangeStart + scalarLength(clause.text),
        timingPrecision: 'phrase',
      },
    });
  }
  private omit(reason: Parameters<CaptionStabilizerOptions['omitted']>[0]): false {
    this.options.omitted(reason);
    return false;
  }
}
