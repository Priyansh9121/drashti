import type { Lang } from '../../../shared/model';
import type { PipPlace } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import type { PreviewBehind, PreviewLead, PreviewSource } from './pip-preview';

/*
 * Picture in Picture's preview (QA24-PIPPREVIEW-1): red first, nothing drawn yet.
 */

export function PipPreviewView(_props: {
  place: PipPlace;
  source: PreviewSource;
  behind: PreviewBehind;
  canvas: Size;
  scaling: ScalingMode;
  languages: readonly Lang[] | null;
  lead: PreviewLead;
  testId: string;
  className?: string;
}) {
  return null;
}
