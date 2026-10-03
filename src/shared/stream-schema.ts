import { z } from 'zod';
import type { DeviceChoice, StreamProfileInput } from './stream';
import { SOUND_DELAY_MAX_MS, STREAM_LAYOUTS, STREAM_PRESET_IDS } from './stream';

/*
 * Stream settings as they arrive over IPC, checked before anything is kept.
 */

export const deviceChoiceSchema: z.ZodType<DeviceChoice> = z.object({
  id: z.string().min(1).max(500),
  label: z.string().max(300),
});

/** rtmp:// or rtmps://, a host, and a path; no key in a query or after a #. */
export const streamUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((u) => {
    try {
      const url = new URL(u);
      return (
        (url.protocol === 'rtmps:' || url.protocol === 'rtmp:') &&
        url.hostname !== '' &&
        url.search === '' &&
        url.hash === '' &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }, 'An address starting rtmps:// (or rtmp://), with no key in it.');

export const streamProfileInputSchema: z.ZodType<StreamProfileInput> = z.object({
  name: z.string().trim().min(1).max(80),
  url: streamUrlSchema,
  preset: z.enum(STREAM_PRESET_IDS),
  camera: deviceChoiceSchema.nullable(),
  sound: deviceChoiceSchema.nullable(),
  soundDelayMs: z.number().int().min(0).max(SOUND_DELAY_MAX_MS),
  mixOwnSound: z.boolean(),
});

/**
 * A stream key as YouTube gives it: letters, digits and dashes, with no
 * spaces or slashes (so it cannot change the address it is added to).
 */
export const streamKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/u, 'A stream key is letters, digits and dashes.');

export const streamLayoutSchema = z.enum(STREAM_LAYOUTS);

/** Going live and ending are public: a window must say the operator confirmed. */
export const confirmedSchema = z.object({ confirmed: z.literal(true) });
