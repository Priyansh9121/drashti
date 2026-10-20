import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { FOLLOW, INTERFACE_MOTIONS, type InterfaceMotion } from '../../shared/appearance/appearances';
import { OWN_MAX, OWN_NAME_MAX, type OwnAppearance } from '../../shared/appearance/derive';
import { readStateTwice, setAside } from '../state-file';

/*
 * The appearance this computer shows (Sessions 39–40): kept in the data folder beside the role, never in the
 * library, so restoring a backup never changes a computer's look; read as Drashti starts, before any window is
 * made, so each opens on its appearance's colour. A file that cannot be read is set aside (state-file.ts),
 * and the computer shows Follow the computer until something is chosen again.
 *
 * Session 42: a second colour of one's own is kept beside the list (`seconds`, by the appearance's id), never in
 * its entries: a Drashti from before then refuses any field it does not know there (ownSchema is strict) and would
 * set the whole file aside. It reads this file whole, its own appearances worked out from their accents alone.
 */

export const APPEARANCE_FILE = 'drashti-appearance.json';

export interface AppearanceSettings {
  /** FOLLOW, or an appearance's id. */
  choice: string;
  motion: InterfaceMotion;
  /** The ones a person made on this computer (Session 40), each kept as its base and accent. */
  own: OwnAppearance[];
}

export const DEFAULT_APPEARANCE: AppearanceSettings = { choice: FOLLOW, motion: 'calm', own: [] };

export const ownSchema = z
  .object({
    id: z.string().regex(/^own-[a-z0-9]{6,32}$/u),
    name: z.string().trim().min(1).max(OWN_NAME_MAX),
    base: z.enum(['dark', 'light']),
    accent: z.string().regex(/^#[0-9a-f]{6}$/u),
  })
  .strict();

const fileSchema = z.object({
  version: z.literal(1),
  choice: z.string().min(1).max(80),
  motion: z.enum(INTERFACE_MOTIONS as [InterfaceMotion, ...InterfaceMotion[]]),
  // Session 40: absent in a file written before it.
  own: z.array(ownSchema).max(OWN_MAX).default([]),
  // Session 42: one's own second colours, by id; absent in a file written before it.
  seconds: z.record(z.string(), z.string().regex(/^#[0-9a-f]{6}$/u)).default({}),
});

/** What the file says, or the default (Follow the computer, Calm), saying why when it could not be read. */
export function readAppearance(userData: string, say: (line: string) => void): AppearanceSettings {
  const file = join(userData, APPEARANCE_FILE);
  const read = readStateTwice(file, (raw) => {
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) return null;
    const { choice, motion, own, seconds } = parsed.data;
    return {
      choice,
      motion,
      own: own.map((o) => {
        const second = seconds[o.id];
        return second === undefined ? o : { ...o, second };
      }),
    };
  });
  if (read.status === 'ok') return read.value;
  if (read.status !== 'missing') {
    const aside = setAside(file);
    say(
      `Appearance: ${APPEARANCE_FILE} could not be read (${read.reason}), so this computer follows its own light or dark setting${aside ? `; the file was set aside as ${aside}` : ''}`,
    );
  }
  return { ...DEFAULT_APPEARANCE, own: [] };
}

/** Keep the choice (written whole, then put in place). */
export function writeAppearance(userData: string, settings: AppearanceSettings): void {
  const file = join(userData, APPEARANCE_FILE);
  const own = settings.own.map(({ id, name, base, accent }) => ({ id, name, base, accent }));
  const seconds = Object.fromEntries(
    settings.own.flatMap((o) => (o.second === undefined ? [] : [[o.id, o.second] as const])),
  );
  writeFileSync(
    `${file}.writing`,
    JSON.stringify({ version: 1, choice: settings.choice, motion: settings.motion, own, seconds }, null, 2),
  );
  renameSync(`${file}.writing`, file);
}
