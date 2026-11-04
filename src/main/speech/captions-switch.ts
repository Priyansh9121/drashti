import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTION_MODEL_IDS, defaultModel, type CaptionModelId } from '../../shared/captions';

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
