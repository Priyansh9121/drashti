import { z } from 'zod';
import type { Outline, Shadow, SlideElement, TextRun, TextStyle, Transition } from './model';
import { MAX_AUTO_ADVANCE_MS, MAX_TRANSITION_MS } from './model';

/*
 * Runtime schemas for the content model. Used to validate anything that
 * crosses a trust boundary: IPC input, and element JSON read from the
 * database (which importers fill from ProPresenter files).
 */

/** An id: a UUID, or a passage (shared/shastra.ts), which can be longer. */
export const idSchema = z.string().min(1).max(512);
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'expected a #rrggbb or #rrggbbaa colour');
export const langSchema = z.enum(['en', 'gu', 'hi', 'translit', 'sa', 'sa-gu']);

/** z.number() already rejects NaN and Infinity. */
const num = z.number();

export const rectSchema = z.object({ x: num, y: num, width: num.nonnegative(), height: num.nonnegative() });

export const shadowSchema: z.ZodType<Shadow> = z.object({
  color: hexColorSchema,
  blur: num.min(0).max(1000),
  x: num.min(-5000).max(5000),
  y: num.min(-5000).max(5000),
});
const textShadowSchema = z.union([z.boolean(), shadowSchema]);

export const outlineSchema: z.ZodType<Outline> = z.object({
  color: hexColorSchema,
  width: num.min(0).max(500),
});

/** Degrees clockwise. */
const rotationSchema = num.min(-36_000).max(36_000).optional();

export const transitionSchema: z.ZodType<Transition> = z.object({
  kind: z.enum(['cut', 'dissolve']),
  durationMs: num.int().min(0).max(MAX_TRANSITION_MS),
});

/** How long a slide stays up before the next one comes on by itself. */
export const autoAdvanceSchema = num.int().min(100).max(MAX_AUTO_ADVANCE_MS);

export const textStyleSchema: z.ZodType<TextStyle> = z.object({
  fontFamily: z.string().max(200).nullable(),
  fontSize: num.positive().max(2000),
  fontWeight: z.number().int().min(100).max(900),
  color: hexColorSchema,
  align: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  lineHeight: num.positive().max(5),
  shadow: textShadowSchema,
  outline: outlineSchema.nullable().optional(),
  shrinkToFit: z.boolean().optional(),
});

export const textRunSchema: z.ZodType<TextRun> = z.object({
  text: z.string().max(10_000),
  font: z.string().max(200).nullable().optional(),
  size: num.positive().max(2000).optional(),
  color: hexColorSchema.optional(),
  weight: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  letterSpacing: num.min(-500).max(500).optional(),
  shadow: textShadowSchema.optional(),
  outline: outlineSchema.nullable().optional(),
  lang: langSchema.nullable().optional(),
  legacy: z.boolean().optional(),
});

export const slideElementSchema: z.ZodType<SlideElement> = z.discriminatedUnion('kind', [
  z.object({
    id: idSchema,
    kind: z.literal('text'),
    frame: rectSchema,
    rotation: rotationSchema,
    text: z.string().max(20_000),
    lang: langSchema.nullable(),
    style: textStyleSchema,
    runs: z.array(textRunSchema).max(2000).optional(),
    opacity: num.min(0).max(1).optional(),
    everyScreen: z.boolean().optional(),
  }),
  z.object({
    id: idSchema,
    kind: z.literal('shape'),
    frame: rectSchema,
    rotation: rotationSchema,
    shape: z.enum(['rectangle', 'ellipse', 'line']).optional(),
    fill: hexColorSchema.nullable(),
    cornerRadius: num.nonnegative(),
    opacity: num.min(0).max(1),
    outline: outlineSchema.nullable().optional(),
  }),
  ...(['image', 'video'] as const).map((kind) =>
    z.object({
      id: idSchema,
      kind: z.literal(kind),
      frame: rectSchema,
      rotation: rotationSchema,
      mediaId: idSchema,
      fit: z.enum(['fit', 'fill', 'stretch']),
      loop: z.boolean().optional(),
      opacity: num.min(0).max(1).optional(),
      volume: num.min(0).max(1).optional(),
    }),
  ),
]);
