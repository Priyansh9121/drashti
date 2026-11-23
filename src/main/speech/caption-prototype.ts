import type { CaptionCorrection, CaptionReview } from '../../shared/caption-coordinator';
import { CaptionCoordinator, type CaptionCoordinatorOptions } from './caption-coordinator';

const EXAMPLES = [
  { partial: 'The blue box', settled: 'The green box is beside a round shape.' },
  { partial: 'An orange square', settled: 'Two orange squares stay near the blue circle.' },
] as const;

/** Manual, deterministic recognizer stand-in. No audio source, timer, model, disk or network. */
export class CaptionPrototype {
  private readonly coordinator: CaptionCoordinator;
  private update = 0;
  private beganAt = 0;

  constructor(options: CaptionCoordinatorOptions) {
    this.coordinator = new CaptionCoordinator(options);
  }

  setOn(on: boolean): void {
    if (on === this.view().on) return;
    if (on) this.restart();
    else this.coordinator.stop();
  }

  advance(): void {
    const sessionId = this.view().sessionId;
    if (sessionId === null) return;
    const phrase = Math.floor(this.update / 2);
    const final = this.update % 2 === 1;
    const example = EXAMPLES[phrase % EXAMPLES.length]!;
    if (!final) this.beganAt = Date.now();
    this.coordinator.accept({
      sessionId,
      phraseId: `s${String(phrase + 1)}`,
      revision: final ? 2 : 1,
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      sourceText: final ? example.settled : example.partial,
      startAt: this.beganAt,
      endAt: Date.now(),
      status: final ? 'settled' : 'provisional',
    });
    this.update += 1;
  }

  restart(): void {
    this.update = 0;
    this.coordinator.start();
  }

  correct(correction: CaptionCorrection): boolean { return this.coordinator.correct(correction); }
  dismiss(key: Omit<CaptionCorrection, 'text'>): boolean { return this.coordinator.dismiss(key); }
  refresh(): void { this.coordinator.refresh(); }
  view(): CaptionReview { return this.coordinator.view(); }
}
