import { z } from 'zod';

/*
 * Video out (x30, prompt 11): the stream's picture (the Program) sent to other software, off until someone turns
 * it on. Frames leave from the stream's page's own capture on a port of their own, to the video-out process (a
 * utility process, src/main/video-out/), which hands them to the way this computer sends: never through the main
 * process, never touching the hall's screens or what the stream sends.
 */

/** How the picture leaves this computer. 'stand-in' is the tests' receiver, never in a packaged Drashti. */
export type VideoOutWay = 'syphon' | 'spout' | 'ndi' | 'stand-in';

/** The longest name other software lists the picture by. */
export const VIDEO_OUT_NAME_MAX = 40;

/** What other software lists the picture as, unless the admin names it. */
export const VIDEO_OUT_DEFAULT_NAME = 'Drashti';

/** Letters (with their vowel signs) and digits of any script, spaces and a few marks: a name receivers can show. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._()-]*$/u;

export const videoOutNameSchema = z.string().trim().min(1).max(VIDEO_OUT_NAME_MAX).regex(NAME);

export const videoOutSettingsSchema = z.object({
  /** Sending: off until someone turns it on, then kept over a restart. */
  on: z.boolean(),
  /** What other software lists the picture as. */
  name: videoOutNameSchema,
});

export type VideoOutSettings = z.infer<typeof videoOutSettingsSchema>;

export const VIDEO_OUT_DEFAULTS: VideoOutSettings = { on: false, name: VIDEO_OUT_DEFAULT_NAME };

/** The kept setting, or the defaults (off) when there is none or it cannot be read. */
export function videoOutSettingsFrom(raw: unknown): VideoOutSettings {
  const parsed = videoOutSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : VIDEO_OUT_DEFAULTS;
}

export type VideoOutState =
  /** Not sending: turned off (or never turned on). */
  | 'off'
  /** Turned on: waiting for the stream's page and its first frame. */
  | 'starting'
  /** Frames are going out. */
  | 'sending'
  /** Turned on, but it stopped after failing too often: turned off and on again, it tries afresh. */
  | 'stopped'
  /** Turned on, but this computer's Drashti has no way to send (none built for it). */
  | 'unavailable';

export interface VideoOutStatus {
  settings: VideoOutSettings;
  state: VideoOutState;
  /** How it sends on this computer, or null when it cannot. */
  way: VideoOutWay | null;
  /** Frames sent since it was turned on. */
  frames: number;
  /** The picture's size as it goes out, once a frame has. */
  size: { width: number; height: number } | null;
  /** What went wrong, in plain words, or null. */
  message: string | null;
}

export type VideoOutResult = { ok: true; status: VideoOutStatus } | { ok: false; message: string };
