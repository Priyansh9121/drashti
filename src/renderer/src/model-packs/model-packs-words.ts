import { formatBytes } from '../../../shared/format';
import {
  purposeWords,
  type InstalledPackView,
  type ModelPacksStatus,
  type PackModelView,
} from '../../../shared/model-packs';

/* Help › Caption and Translation Models…'s words (alpha.22, cap-pack). */

/** What the import is doing, or null when none is under way. */
export function importingText(status: ModelPacksStatus): string | null {
  const p = status.importing;
  if (p.phase === 'idle') return null;
  if (p.name === null || p.total === 0) return 'Reading the pack’s list…';
  const percent = Math.min(100, Math.floor((p.done / p.total) * 100));
  return `Copying and checking ${p.name}: ${String(percent)}% of ${formatBytes(p.total)}.`;
}

/** A pack's line under its name: its release, its size, and the day it was imported (this computer's time). */
export function packLine(pack: InstalledPackView, locale?: string): string {
  const day = new Date(pack.importedAt).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const models = pack.models.length === 1 ? '1 model' : `${String(pack.models.length)} models`;
  return `Release ${pack.release}, ${models}, ${formatBytes(pack.bytes)}, imported ${day}`;
}

/** What a model is for, in words. */
export const modelPurposes = (model: PackModelView): string => model.purposes.map(purposeWords).join('; ');

/** Who made a model and where it is from, as the pack credits it (its licence asks for it). */
export const modelCredit = (model: PackModelView): string => `By ${model.attributions.join('; ')}`;

/** A model's line: its size, its format and its licences. */
export const modelLine = (model: PackModelView): string =>
  `${formatBytes(model.bytes)}, ${model.format}, ${model.licences.join(' and ')} licence`;
