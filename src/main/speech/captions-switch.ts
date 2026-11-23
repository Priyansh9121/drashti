import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAPTION_MODEL_IDS,
  defaultModel,
  LANGUAGE_MODEL_LANGUAGES,
  parseCaptionTiming,
  type CaptionModelId,
  type CaptionTiming,
  type LanguageModelLanguage,
} from '../../shared/captions';

/*
 * Whether live captions are on, and with which model (Session 55, Part 10). It belongs to the computer, not the
 * library (a library restored elsewhere does not bring it): the model is downloaded to this computer and the work is
 * this computer's. Kept in the data folder beside the priority (drashti-captions.json). Off until an admin turns it
 * on (Pro Mode).
 */

export interface CaptionsSwitch {
  on: boolean;
  model: CaptionModelId;
}

const FILE = 'drashti-captions.json';

export function readCaptionsSwitch(userData: string, platform: string, arch: string): CaptionsSwitch {
  const fallback: CaptionsSwitch = { on: false, model: defaultModel(platform, arch) };
  try {
    const raw = JSON.parse(readFileSync(join(userData, FILE), 'utf8')) as { on?: unknown; model?: unknown };
    const model = CAPTION_MODEL_IDS.find((id) => id === raw.model) ?? fallback.model;
    return { on: raw.on === true, model };
  } catch {
    return fallback;
  }
}

export function writeCaptionsSwitch(userData: string, value: CaptionsSwitch): void {
  const file = join(userData, FILE);
  writeFileSync(`${file}.writing`, JSON.stringify({ on: value.on, model: value.model }, null, 2));
  renameSync(`${file}.writing`, file);
}

/**
 * A model of its own per language, and the live timing (alpha.22): this computer's too, as its models and its speed
 * are, so kept beside the switch in their own file (drashti-captions-tuning.json; the switch's file is unchanged).
 * None chosen and the timing captions always had, until an admin changes them.
 */
export interface CaptionsTuning {
  /** The model chosen for each language (its id in main/speech/language-models.ts); none: the general model. */
  languageModels: Partial<Record<LanguageModelLanguage, string>>;
  timing: CaptionTiming;
}

const TUNING_FILE = 'drashti-captions-tuning.json';
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export function readCaptionsTuning(userData: string): CaptionsTuning {
  let raw: { languageModels?: unknown; timing?: unknown } = {};
  try {
    raw = JSON.parse(readFileSync(join(userData, TUNING_FILE), 'utf8')) as typeof raw;
  } catch {
    // None yet, or damaged: the defaults.
  }
  const chosen =
    typeof raw.languageModels === 'object' && raw.languageModels !== null
      ? (raw.languageModels as Record<string, unknown>)
      : {};
  const languageModels: Partial<Record<LanguageModelLanguage, string>> = {};
  for (const language of LANGUAGE_MODEL_LANGUAGES) {
    const id = chosen[language];
    if (typeof id === 'string' && MODEL_ID.test(id)) languageModels[language] = id;
  }
  return { languageModels, timing: parseCaptionTiming(raw.timing) };
}

export function writeCaptionsTuning(userData: string, value: CaptionsTuning): void {
  const file = join(userData, TUNING_FILE);
  const languageModels: Partial<Record<LanguageModelLanguage, string>> = {};
  for (const language of LANGUAGE_MODEL_LANGUAGES) {
    const id = value.languageModels[language];
    if (id !== undefined) languageModels[language] = id;
  }
  writeFileSync(
    `${file}.writing`,
    JSON.stringify({ languageModels, timing: parseCaptionTiming(value.timing) }, null, 2),
  );
  renameSync(`${file}.writing`, file);
}
