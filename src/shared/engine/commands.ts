import { z } from 'zod';
import { hexColorSchema, idSchema, rectSchema, slideElementSchema } from '../model-schema';
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
const rect = rectSchema;
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
]);
export const messageSchema: z.ZodType<MessageItem> = z.object({
  id,
  text: z.string().min(1).max(500),
  parts: z.array(messagePart).max(40).optional(),
});
const mask: z.ZodType<MaskLayer> = z.object({ id, name: z.string().max(200), visible: rect });

const playlistCursor = z.object({ playlistId: id, itemId: id });

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
  | 'unknown-look';

export type CommandResult =
  { ok: true; changed: boolean; rev: number } | { ok: false; error: EngineErrorCode; message: string };

export function parseEngineCommand(
  input: unknown,
): { ok: true; command: EngineCommand } | { ok: false; message: string } {
  const result = engineCommandSchema.safeParse(input);
  if (result.success) return { ok: true, command: result.data };
  return { ok: false, message: z.prettifyError(result.error) };
}
