import type { CaptionCorrection, CaptionReview } from '../../shared/caption-coordinator';
import type { CaptionCoordinatorOptions } from './caption-coordinator';

export class CaptionPrototype {
  constructor(_options: CaptionCoordinatorOptions) {}
  setOn(_on: boolean): void {}
  advance(): void {}
  restart(): void {}
  correct(_correction: CaptionCorrection): boolean { return false; }
  dismiss(_identity: Omit<CaptionCorrection, 'text'>): boolean { return false; }
  refresh(): void {}
  view(): CaptionReview { return { on: false, sessionId: null, current: null, previous: null, busy: false, omitted: 0 }; }
}
