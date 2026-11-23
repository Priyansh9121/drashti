import type { InstalledPackView, ModelPacksStatus, PackModelView } from '../../../shared/model-packs';

/* Help › Caption and Translation Models…'s words (alpha.22, cap-pack). Red: not built yet. */

export const importingText = (status: ModelPacksStatus): string | null => (status.packs ? '' : null);
export const packLine = (pack: InstalledPackView, locale?: string): string => `${pack.id}${locale ?? ''}`.slice(0, 0);
export const modelPurposes = (model: PackModelView): string => model.id.slice(0, 0);
export const modelLine = (model: PackModelView): string => model.id.slice(0, 0);
