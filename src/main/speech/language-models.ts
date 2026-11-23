import type { LanguageModelLanguage } from '../../shared/captions';

/* A model of its own per language (alpha.22): not built yet (the red's stand-in). */

export interface LanguageModelEntry {
  id: string;
  language: LanguageModelLanguage;
  name: string;
  bytes: number;
  sha256: string;
  licence: string;
  fallback: boolean;
}

export const LANGUAGE_MODELS: readonly LanguageModelEntry[] = Object.freeze([]);

export class LanguageModelRefused extends Error {}

export function parseLanguageModelList(_raw: unknown): LanguageModelEntry[] {
  throw new Error('not built yet');
}

export function languageModelFile(_userData: string, _id: string): string {
  throw new Error('not built yet');
}

export function checkLanguageModel(_file: string, _entry: LanguageModelEntry): 'ready' | 'missing' | 'changed' {
  throw new Error('not built yet');
}

export function verifyLanguageModel(
  _file: string,
  _entry: LanguageModelEntry,
  _signal?: AbortSignal,
): Promise<'ready' | 'missing' | 'changed'> {
  return Promise.reject(new Error('not built yet'));
}

export function addLanguageModelFile(_o: {
  userData: string;
  source: string;
  language: LanguageModelLanguage;
  known: readonly LanguageModelEntry[];
  freeBytes?: (folder: string) => Promise<number | null>;
  signal?: AbortSignal;
}): Promise<LanguageModelEntry> {
  return Promise.reject(new Error('not built yet'));
}
