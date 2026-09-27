import { z } from 'zod';
import { type SlideElement, type TextStyle } from '../model';
import {
  type AudioLayer,
  type BackgroundLayer,
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

const id = z.string().min(1).max(128);
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'expected a #rrggbb or #rrggbbaa colour');
/** z.number() already rejects NaN and Infinity. */
const finite = z.number();
const rect = z.object({ x: finite, y: finite, width: finite.nonnegative(), height: finite.nonnegative() });

const textStyle: z.ZodType<TextStyle> = z.object({
  fontFamily: z.string().max(200).nullable(),
  fontSize: finite.positive().max(2000),
  fontWeight: z.number().int().min(100).max(900),
  color: hexColor,
  align: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  lineHeight: finite.positive().max(5),
  shadow: z.boolean(),
});

const slideElement: z.ZodType<SlideElement> = z.discriminatedUnion('kind', [
  z.object({
    id,
    kind: z.literal('text'),
    frame: rect,
    text: z.string().max(10_000),
    lang: z.enum(['en', 'gu', 'hi', 'translit']).nullable(),
    style: textStyle,
  }),
  z.object({
    id,
    kind: z.literal('shape'),
    frame: rect,
    fill: hexColor,
    cornerRadius: finite.nonnegative(),
    opacity: finite.min(0).max(1),
  }),
]);

const background: z.ZodType<BackgroundLayer> = z.object({ kind: z.literal('color'), color: hexColor });
const audio: z.ZodType<AudioLayer> = z.object({ id, title: z.string().max(300), mediaId: id.nullable() });
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
