import { slideElementSchema } from '../../shared/model-schema';
import { refreshTranslationReview } from '../../shared/prepared-translation-view';
import type { ElementRow } from './content';

/** Invalidate all source-edit paths, retaining unknown stored properties and exact unchanged JSON. */
export function translationReviewProps(row: ElementRow): string {
  if (row.kind !== 'text') return row.props;
  try {
    const props: unknown = JSON.parse(row.props);
    if (typeof props !== 'object' || props === null || !('translations' in props)) return row.props;
    const parsed = slideElementSchema.safeParse({
      ...props,
      id: row.id,
      kind: row.kind,
      frame: { x: row.x, y: row.y, width: row.width, height: row.height },
      rotation: row.rotation,
    });
    if (!parsed.success || parsed.data.kind !== 'text') return row.props;
    const next = refreshTranslationReview(parsed.data);
    return next === parsed.data ? row.props : JSON.stringify({ ...props, translations: next.translations });
  } catch {
    return row.props;
  }
}
