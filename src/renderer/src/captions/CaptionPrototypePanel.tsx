import type { CaptionReview } from '../../../shared/caption-coordinator';

export function latestCaptionReview(_current: CaptionReview | null, next: CaptionReview): CaptionReview { return next; }
export function CaptionPrototypeControls(_props: { review: CaptionReview; take(review: CaptionReview | null): void }) { return null; }
export function CaptionPrototypePanel() { return null; }
