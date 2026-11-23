import { z } from 'zod';

/*
 * Caption and translation models (alpha.22, cap-pack; x79's §4 and x80's §2): an offline model pack, brought by an
 * admin on a drive or as a zip and imported with Help › Caption and Translation Models… (Pro Mode). Drashti never
 * fetches one. The pack's list (drashti-model-pack.json, at its top) names every file: its name, bytes, SHA-256,
 * licence and purpose (captions in Gujarati, Hindi or English, or a translation pair), and for a model's files the
 * model it belongs to and that model's format. Every file is checked against the list before it is kept; one file
 * that does not match refuses the whole pack. Kept per computer in Drashti's data folder (model-packs/), outside the
 * library and its backups, with the licences' own texts. Off until a pack is imported: nothing else changes.
 */

/** The pack's list, at the top of its folder or zip (or of the one folder a zip holds). */
export const PACK_MANIFEST = 'drashti-model-pack.json';
export const PACK_FORMAT = 'drashti-model-pack';

/** The languages a pack's models hear or translate between. */
export const PACK_LANGUAGES = ['gu', 'hi', 'en'] as const;
export type PackLanguage = (typeof PACK_LANGUAGES)[number];

export const LANGUAGE_NAMES: Readonly<Record<PackLanguage, string>> = {
  gu: 'Gujarati',
  hi: 'Hindi',
  en: 'English',
};

export type CaptionPurpose = `captions-${PackLanguage}`;
export type TranslationPurpose = `translation-${PackLanguage}-${PackLanguage}`;
/** What a model is for: captions of one language, or translation from one language into another. */
export type ModelPurpose = CaptionPurpose | TranslationPurpose;
/** A file that is a licence's own text (kept, and shown in the dialog). */
export const LICENCE_PURPOSE = 'licence';
export type FilePurpose = ModelPurpose | typeof LICENCE_PURPOSE;

// Red (cap-pack): not built yet.
export const MODEL_PURPOSES: readonly ModelPurpose[] = [];

export const isModelPurpose = (value: unknown): value is ModelPurpose => typeof value === 'symbol';

/** A purpose in words. */
export const purposeWords = (purpose: ModelPurpose): string => (purpose.length < 0 ? purpose : '');

/**
 * The licences a pack's files may carry (SPDX names): free and open ones only (the owner's rule: nothing paid, free
 * and open-licensed only). A file under any other licence, or none, refuses the pack.
 */
export const OPEN_LICENCES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  'CC-BY-4.0',
] as const;
export type OpenLicence = (typeof OPEN_LICENCES)[number];

/** The most files one pack may list, and the largest one file (a model is under a few GB). */
export const MAX_PACK_FILES = 10_000;
export const MAX_PACK_FILE_BYTES = 64 * 1024 ** 3;
/** The pack's list is small: more than this is not a Drashti model pack. */
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
/**
 * A file's name in the pack: folders by "/", each part letters, digits, ".", "_" or "-" and starting with a letter, a
 * digit or "_" (so never "." or "..", a hidden file, a drive or a path from the top of a disk).
 */
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/u;

export const packFileSchema = z.object({
  name: z.string().min(1).max(240).regex(NAME),
  bytes: z.number().int().min(0).max(MAX_PACK_FILE_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  licence: z.string().min(1).max(64),
  purpose: z.array(z.string().min(1).max(40)).min(1).max(MODEL_PURPOSES.length),
  model: z.string().regex(ID).optional(),
  format: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/u)
    .optional(),
  licenceFile: z.string().min(1).max(240).optional(),
});
export type PackFile = z.infer<typeof packFileSchema>;

export const packManifestSchema = z.object({
  format: z.literal(PACK_FORMAT),
  version: z.literal(1),
  id: z.string().regex(ID),
  name: z.string().trim().min(1).max(80),
  release: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/u),
  files: z.array(packFileSchema).min(1).max(MAX_PACK_FILES),
});
export type PackManifest = z.infer<typeof packManifestSchema>;

/** One model of an installed pack, as the dialog shows it. */
export interface PackModelView {
  id: string;
  purposes: ModelPurpose[];
  format: string;
  licences: string[];
  bytes: number;
}

/** One installed pack, as the dialog shows it. */
export interface InstalledPackView {
  id: string;
  name: string;
  release: string;
  /** When it was imported (this computer's clock, ms). */
  importedAt: number;
  bytes: number;
  models: PackModelView[];
  /** Its licences' own texts: each file's name in the pack and the licence it is. */
  licences: { file: string; licence: string }[];
  /** Live captions or translation are using it now (it is removed once they stop). */
  inUse: boolean;
  /** What is wrong with it on this computer (a file gone or changed since it was checked), or null. */
  problem: string | null;
}

export type PackImportProgress =
  | { phase: 'idle' }
  | { phase: 'importing'; name: string | null; done: number; total: number };

/** How the packs stand on this computer: what the dialog shows. */
export interface ModelPacksStatus {
  packs: InstalledPackView[];
  importing: PackImportProgress;
  /** The data folder's list of packs could not be read (it was set aside): say so, and how to put it right. */
  problem: string | null;
}

export type PackImportResult =
  | { ok: true; pack: InstalledPackView; status: ModelPacksStatus }
  | { ok: false; message: string; cancelled?: boolean; status: ModelPacksStatus };

export type PackRemoveResult = { ok: true; status: ModelPacksStatus } | { ok: false; message: string };

export type PackLicenceResult = { ok: true; text: string } | { ok: false; message: string };
