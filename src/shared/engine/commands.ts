import { z } from 'zod';
import { CALENDAR_LANGS } from '../calendar';
import { maskSchema } from '../masks';
import { hexColorSchema, idSchema, slideElementSchema } from '../model-schema';
import {
  type AudioChoice,
  type BackgroundChoice,
  LAYER_NAMES,
  type MaskLayer,
  type MessageItem,
  type PropItem,
} from './state';

/*
 * Commands are what the operator UI (and later remotes and the local API) may
 * ask the show engine to do. Everything arriving over IPC is validated with
 * these schemas; unknown keys are dropped.
 */

const id = idSchema;
const hexColor = hexColorSchema;
const slideElement = slideElementSchema;

const background: z.ZodType<BackgroundChoice> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color: hexColor }),
  z.object({
    kind: z.literal('media'),
    mediaId: id,
    media: z.enum(['image', 'video']),
    fit: z.enum(['fit', 'fill', 'stretch']),
    loop: z.boolean(),
  }),
]);
export const audioChoiceSchema: z.ZodType<AudioChoice> = z.object({
  id,
  title: z.string().max(300),
  mediaId: id.nullable(),
  volume: z.number().min(0).max(1),
  loop: z.boolean(),
});
export const propSchema: z.ZodType<PropItem> = z.object({
  id,
  name: z.string().max(200),
  elements: z.array(slideElement).max(50),
  width: z.number().int().min(16).max(16384).optional(),
  height: z.number().int().min(16).max(16384).optional(),
});
const messagePart = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(500) }),
  z.object({ kind: z.literal('timer'), timerId: id }),
  z.object({ kind: z.literal('samvat'), lang: z.enum(CALENDAR_LANGS) }),
]);
export const messageSchema: z.ZodType<MessageItem> = z.object({
  id,
  text: z.string().min(1).max(500),
  parts: z.array(messagePart).max(40).optional(),
});
const mask: z.ZodType<MaskLayer> = maskSchema;

const playlistCursor = z.object({ playlistId: id, itemId: id });

/** An audio playlist as the main process reads it from the library (its tracks in play order). */
export const musicStartSchema = z.object({
  playlistId: id,
  name: z.string().max(200),
  tracks: z
    .array(z.object({ mediaId: id, title: z.string().max(300) }))
    .min(1)
    .max(1000),
  loop: z.boolean(),
  shuffle: z.boolean(),
});

export const engineCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('goLive'),
    presentationId: id,
    /** Position in the playing order. */
    slideIndex: z.number().int().min(0).max(100_000),
    /** The order: an arrangement, null for every slide in order, left out for the presentation's own choice. */
    arrangementId: id.nullable().optional(),
    /** The playlist item it is played from, so Next carries on into the next item. */
    playlist: playlistCursor.nullable().optional(),
  }),
  /** Start a playlist item: a presentation at its first slide, or a picture, video or sound. */
  z.object({ type: z.literal('playItem'), playlistId: id, itemId: id }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('previous') }),
  /**
   * Back: undoes the last Next exactly (the slide, background and sound as
   * they were) while nothing else has changed since; otherwise Previous.
   */
  z.object({ type: z.literal('back') }),
  /** The first slide of the next (or previous) playlist item that can play. */
  z.object({ type: z.literal('nextItem') }),
  z.object({ type: z.literal('previousItem') }),
  z.object({ type: z.literal('clearLayer'), layer: z.enum(LAYER_NAMES) }),
  z.object({ type: z.literal('clearAll') }),
  /** Put back what Clear all took down, while nothing else has gone up since. */
  z.object({ type: z.literal('putBack') }),
  z.object({ type: z.literal('setBlackout'), on: z.boolean() }),
  z.object({ type: z.literal('toggleBlackout') }),
  /** The logo instead of the picture on the audience screens; hideLogo brings the picture back. */
  z.object({ type: z.literal('showLogo'), prop: propSchema }),
  z.object({ type: z.literal('hideLogo') }),
  z.object({ type: z.literal('setBackground'), background }),
  z.object({ type: z.literal('playAudio'), audio: audioChoiceSchema }),
  z.object({ type: z.literal('showProp'), prop: propSchema }),
  z.object({ type: z.literal('hideProp'), propId: id }),
  z.object({ type: z.literal('showMessage'), message: messageSchema }),
  z.object({ type: z.literal('hideMessage'), messageId: id }),
  z.object({ type: z.literal('setMask'), mask }),
  /** Timers: only these three change what the windows count from. */
  z.object({ type: z.literal('startTimer'), timerId: id }),
  z.object({ type: z.literal('pauseTimer'), timerId: id }),
  z.object({ type: z.literal('resetTimer'), timerId: id }),
  /** A message on stage screens only, for the performers. */
  z.object({ type: z.literal('setStageMessage'), text: z.string().trim().min(1).max(300) }),
  z.object({ type: z.literal('clearStageMessage') }),
  /** Switch the live Look: every screen group changes at once (Simple Mode refuses it). */
  z.object({ type: z.literal('setLook'), lookId: id }),
  /** Put a presentation first in line for Next (the arti at its time); clearCue takes it away. */
  z.object({ type: z.literal('cueNext'), presentationId: id, label: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal('clearCue') }),
  z.object({ type: z.literal('playCue') }),
  z.object({ type: z.literal('startIdle') }),
  z.object({ type: z.literal('stopIdle') }),
  /**
   * Audio playlists (Session 14), on the audio layer: start one at a track
   * (the main process reads its tracks from the library), pause and play on,
   * the next or previous track, and whether it goes round again.
   */
  z.object({
    type: z.literal('playMusic'),
    music: musicStartSchema,
    index: z.number().int().min(0).max(999),
  }),
  z.object({ type: z.literal('pauseMusic') }),
  z.object({ type: z.literal('resumeMusic') }),
  z.object({ type: z.literal('musicNext') }),
  z.object({ type: z.literal('musicPrevious') }),
  z.object({ type: z.literal('setMusicLoop'), loop: z.boolean() }),
  /** Jump the background video or the sound to one of its file's markers (Session 14), in step everywhere. */
  z.object({
    type: z.literal('jumpToMarker'),
    layer: z.enum(['background', 'audio']),
    markerId: z.string().min(1).max(64),
  }),
]);

export type EngineCommand = z.infer<typeof engineCommandSchema>;
export type EngineCommandType = EngineCommand['type'];

export type EngineErrorCode =
  | 'invalid-command'
  | 'forbidden'
  | 'unknown-presentation'
  | 'slide-out-of-range'
  | 'nothing-live'
  | 'unknown-item'
  | 'not-playable'
  | 'unknown-timer'
  | 'nothing-to-put-back'
  | 'unknown-look'
  | 'nothing-cued'
  | 'no-music'
  | 'unknown-marker';

export type CommandResult =
  { ok: true; changed: boolean; rev: number } | { ok: false; error: EngineErrorCode; message: string };

export function parseEngineCommand(
  input: unknown,
): { ok: true; command: EngineCommand } | { ok: false; message: string } {
  const result = engineCommandSchema.safeParse(input);
  if (result.success) return { ok: true, command: result.data };
  return { ok: false, message: z.prettifyError(result.error) };
}
