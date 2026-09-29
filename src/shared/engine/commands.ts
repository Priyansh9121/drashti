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
const audio: z.ZodType<AudioChoice> = z.object({
  id,
  title: z.string().max(300),
  mediaId: id.nullable(),
  volume: z.number().min(0).max(1),
  loop: z.boolean(),
});
const prop: z.ZodType<PropItem> = z.object({
  id,
  name: z.string().max(200),
  elements: z.array(slideElement).max(50),
});
const message: z.ZodType<MessageItem> = z.object({ id, text: z.string().min(1).max(500) });
const mask: z.ZodType<MaskLayer> = z.object({ id, name: z.string().max(200), visible: rect });

export const engineCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('goLive'),
    presentationId: id,
    slideIndex: z.number().int().min(0).max(100_000),
  }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('previous') }),
  z.object({ type: z.literal('clearLayer'), layer: z.enum(LAYER_NAMES) }),
  z.object({ type: z.literal('clearAll') }),
  z.object({ type: z.literal('setBlackout'), on: z.boolean() }),
  z.object({ type: z.literal('toggleBlackout') }),
  z.object({ type: z.literal('setBackground'), background }),
  z.object({ type: z.literal('playAudio'), audio }),
  z.object({ type: z.literal('showProp'), prop }),
  z.object({ type: z.literal('hideProp'), propId: id }),
  z.object({ type: z.literal('showMessage'), message }),
  z.object({ type: z.literal('hideMessage'), messageId: id }),
  z.object({ type: z.literal('setMask'), mask }),
]);

export type EngineCommand = z.infer<typeof engineCommandSchema>;
export type EngineCommandType = EngineCommand['type'];

export type EngineErrorCode =
  'invalid-command' | 'forbidden' | 'unknown-presentation' | 'slide-out-of-range' | 'nothing-live';

export type CommandResult =
  { ok: true; changed: boolean; rev: number } | { ok: false; error: EngineErrorCode; message: string };

export function parseEngineCommand(
  input: unknown,
): { ok: true; command: EngineCommand } | { ok: false; message: string } {
  const result = engineCommandSchema.safeParse(input);
  if (result.success) return { ok: true, command: result.data };
  return { ok: false, message: z.prettifyError(result.error) };
}
