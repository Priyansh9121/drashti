import type { ModelPurpose, PackFile, PackManifest } from '../../shared/model-packs';

/* A model pack's list, checked (alpha.22, cap-pack). Red: not built yet. */

export interface CheckedModel {
  id: string;
  purposes: ModelPurpose[];
  format: string;
  folder: string;
  files: PackFile[];
  licences: string[];
  bytes: number;
}

export interface CheckedPack {
  manifest: PackManifest;
  models: CheckedModel[];
  licenceTexts: PackFile[];
  bytes: number;
}

export type ManifestCheck = { ok: true; pack: CheckedPack } | { ok: false; message: string };

export const readManifestText = (text: string): ManifestCheck => ({ ok: false, message: text.slice(0, 0) });

export const checkManifest = (raw: unknown): ManifestCheck => ({ ok: false, message: String(raw).slice(0, 0) });
