import type { CaptionCorrection, CaptionReview } from '../../shared/caption-coordinator';
import { CaptionStabilizer } from './caption-stabilizer';
import { CaptionCoordinator, type CaptionCoordinatorOptions } from './caption-coordinator';

const EXAMPLES = [
  { partial: 'The blue box', settled: 'The green box is beside a round shape.' },
  { partial: 'An orange square', settled: 'Two orange squares stay near the blue circle.' },
] as const;

/** Manual, deterministic recognizer stand-in. No audio source, timer, model, disk or network. */
export class CaptionPrototype {
  private readonly coordinator: CaptionCoordinator;
  private recognizer: CaptionStabilizer | null = null;
  private readonly clock: () => number;
  private update = 0;
  private beganAt = 0;

  constructor(options: CaptionCoordinatorOptions) {
    this.coordinator = new CaptionCoordinator(options);
    this.clock = options.clock ?? (() => performance.now());
  }

  setOn(on: boolean): void {
    if (on === this.view().on) return;
    if (on) this.restart();
    else {
      this.recognizer = null;
      this.coordinator.stop();
    }
  }

  advance(): void {
    const sessionId = this.view().sessionId;
    if (sessionId === null) return;
    const phrase = Math.floor(this.update / 2);
    const final = this.update % 2 === 1;
    const example = EXAMPLES[phrase % EXAMPLES.length]!;
    if (!final) this.beganAt = this.clock();
    const inputEpoch = this.coordinator.inputEpochId();
    if (inputEpoch === null) return;
    this.recognizer?.observe({
      sessionId,
      inputEpoch,
      enginePhraseId: `s${String(phrase + 1)}`,
      sequence: final ? 2 : 1,
      text: final ? example.settled : example.partial,
      final,
      startAt: this.beganAt,
      endAt: this.clock(),
      observedAt: this.clock(),
    });
    this.update += 1;
  }

  restart(): void {
    this.update = 0;
    const sessionId = this.coordinator.start();
    this.recognizer = new CaptionStabilizer({
      sessionId,
      inputEpoch: this.coordinator.inputEpochId()!,
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      emit: (clause) => {
        if (clause.status === 'corrected') this.coordinator.reviseAutomatic(clause);
        else this.coordinator.accept(clause);
      },
      // Fixed scripted events are bounded and valid. An invalid event clears this session rather than showing it.
      omitted: () => this.setOn(false),
    });
  }

  correct(correction: CaptionCorrection): boolean {
    return this.coordinator.correct(correction);
  }
  dismiss(key: Omit<CaptionCorrection, 'text'>): boolean {
    return this.coordinator.dismiss(key);
  }
  refresh(): void {
    this.coordinator.refresh();
  }
  view(): CaptionReview {
    return this.coordinator.view();
  }
}
