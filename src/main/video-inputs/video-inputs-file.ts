import { renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import {
  VIDEO_INPUT_DEVICE_MAX,
  VIDEO_INPUT_NAME_MAX,
  VIDEO_INPUTS_MAX,
  type VideoInput,
} from '../../shared/video-inputs';
import { readStateTwice, setAside } from '../state-file';

/*
 * This computer's video inputs (Session 50): each camera or capture input the operator named in Media ("Input
 * 1"), kept in the data folder beside the appearance and the role, never in the library: a device's name belongs
 * to this computer, and a backup restored on another computer must never name devices it does not have. A file
 * that cannot be read is set aside (state-file.ts), and the list starts empty until inputs are named again.
 */

export const VIDEO_INPUTS_FILE = 'drashti-video-inputs.json';

const inputSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(VIDEO_INPUT_NAME_MAX),
  device: z.string().min(1).max(VIDEO_INPUT_DEVICE_MAX),
  fit: z.enum(['fit', 'fill']),
});

const fileSchema = z.object({
  version: z.literal(1),
  inputs: z.array(inputSchema).max(VIDEO_INPUTS_MAX),
});

/** The inputs the file keeps, in order; none when there is no file, or it could not be read (said why). */
export function readVideoInputs(
  userData: string,
  say: (line: string) => void,
  options: { retryMs?: number; now?: Date } = {},
): VideoInput[] {
  const file = join(userData, VIDEO_INPUTS_FILE);
  const read = readStateTwice(
    file,
    (raw) => {
      const parsed = fileSchema.safeParse(raw);
      return parsed.success
        ? parsed.data.inputs.map(({ id, name, device, fit }) => ({ id, name, device, fit }))
        : null;
    },
    options.retryMs,
  );
  if (read.status === 'ok') return read.value;
  if (read.status !== 'missing') {
    const aside = setAside(file, options.now);
    say(
      `Video inputs: ${VIDEO_INPUTS_FILE} could not be read (${read.reason}), so this computer has none named until they are added again${aside ? `; the file was set aside as ${basename(aside)}` : ''}`,
    );
  }
  return [];
}

/** Keep the list (written whole, then put in place). */
export function writeVideoInputs(userData: string, inputs: readonly VideoInput[]): void {
  const file = join(userData, VIDEO_INPUTS_FILE);
  const kept = inputs.map(({ id, name, device, fit }) => ({ id, name, device, fit }));
  writeFileSync(`${file}.writing`, JSON.stringify({ version: 1, inputs: kept }, null, 2));
  renameSync(`${file}.writing`, file);
}
