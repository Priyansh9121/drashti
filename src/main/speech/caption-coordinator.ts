import type { CaptionCorrection, CaptionReview, CaptionRevision, CaptionTranslationPort } from '../../shared/caption-coordinator';
import type { CaptionsShown, CaptionSettings } from '../../shared/captions';

export interface CaptionCoordinatorOptions {
  settings(): CaptionSettings;
  show(captions: CaptionsShown | null): void;
  changed(review: CaptionReview): void;
  translation?: CaptionTranslationPort;
}

export class CaptionCoordinator {
  constructor(private readonly options: CaptionCoordinatorOptions) {}
  start(): string { return ''; }
  stop(): void {}
  accept(_clause: CaptionRevision): boolean { return false; }
  correct(_correction: CaptionCorrection): boolean { return false; }
  dismiss(_identity: Omit<CaptionCorrection, 'text'>): boolean { return false; }
  refresh(): void {}
  view(): CaptionReview { return { on: false, sessionId: null, current: null, previous: null, busy: false, omitted: 0 }; }
}
