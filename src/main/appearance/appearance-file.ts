import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { FOLLOW, INTERFACE_MOTIONS, type InterfaceMotion } from '../../shared/appearance/appearances';
import { readStateTwice, setAside } from '../state-file';

/*
 * The appearance this computer shows (Sessions 39–40): kept in the data folder beside the role, never in the
 * library, so restoring a backup never changes a computer's look; read as Drashti starts, before any window is
 * made, so each opens on its appearance's colour. A file that cannot be read is set aside (state-file.ts),
 * and the computer shows Follow the computer until something is chosen again.
 */

export const APPEARANCE_FILE = 'drashti-appearance.json';

export interface AppearanceSettings {
  /** FOLLOW, or an appearance's id. */
  choice: string;
  motion: InterfaceMotion;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = { choice: FOLLOW, motion: 'calm' };

const fileSchema = z.object({
  version: z.literal(1),
  choice: z.string().min(1).max(80),
  motion: z.enum(INTERFACE_MOTIONS as [InterfaceMotion, ...InterfaceMotion[]]),
});

/** What the file says, or the default (Follow the computer, Calm), saying why when it could not be read. */
export function readAppearance(userData: string, say: (line: string) => void): AppearanceSettings {
  const file = join(userData, APPEARANCE_FILE);
  const read = readStateTwice(file, (raw) => {
    const parsed = fileSchema.safeParse(raw);
    return parsed.success ? { choice: parsed.data.choice, motion: parsed.data.motion } : null;
  });
  if (read.status === 'ok') return read.value;
  if (read.status !== 'missing') {
    const aside = setAside(file);
    say(
      `Appearance: ${APPEARANCE_FILE} could not be read (${read.reason}), so this computer follows its own light or dark setting${aside ? `; the file was set aside as ${aside}` : ''}`,
    );
  }
  return { ...DEFAULT_APPEARANCE };
}

/** Keep the choice (written whole, then put in place). */
export function writeAppearance(userData: string, settings: AppearanceSettings): void {
  const file = join(userData, APPEARANCE_FILE);
  writeFileSync(`${file}.writing`, JSON.stringify({ version: 1, ...settings }, null, 2));
  renameSync(`${file}.writing`, file);
}
