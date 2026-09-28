import { z } from 'zod';
import type { SlideElement, TextRun, TextStyle } from './model';

/*
 * Runtime schemas for the content model. Used to validate anything that
 * crosses a trust boundary: IPC input, and element JSON read from the
 * database (which importers fill from ProPresenter files).
 */

export const idSchema = z.string().min(1).max(128);
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'expected a #rrggbb or #rrggbbaa colour');
export const langSchema = z.enum(['en', 'gu', 'hi', 'translit']);

/** z.number() already rejects NaN and Infinity. */
const num = z.number();

export const rectSchema = z.object({ x: num, y: num, width: num.nonnegative(), height: num.nonnegative() });

export const textStyleSchema: z.ZodType<TextStyle> = z.object({
  fontFamily: z.string().max(200).nullable(),
  fontSize: num.positive().max(2000),
  fontWeight: z.number().int().min(100).max(900),
  color: hexColorSchema,
  align: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  lineHeight: num.positive().max(5),
  shadow: z.boolean(),
});

export const textRunSchema: z.ZodType<TextRun> = z.object({
  text: z.string().max(10_000),
  font: z.string().max(200).nullable().optional(),
  size: num.positive().max(2000).optional(),
  color: hexColorSchema.optional(),
  weight: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  letterSpacing: num.min(-500).max(500).optional(),
  lang: langSchema.nullable().optional(),
  legacy: z.boolean().optional(),
});

export const slideElementSchema: z.ZodType<SlideElement> = z.discriminatedUnion('kind', [
  z.object({
    id: idSchema,
    kind: z.literal('text'),
    frame: rectSchema,
    text: z.string().max(20_000),
    lang: langSchema.nullable(),
    style: textStyleSchema,
    runs: z.array(textRunSchema).max(2000).optional(),
  }),
  z.object({
    id: idSchema,
    kind: z.literal('shape'),
    frame: rectSchema,
    fill: hexColorSchema,
    cornerRadius: num.nonnegative(),
    opacity: num.min(0).max(1),
  }),
  ...(['image', 'video'] as const).map((kind) =>
    z.object({
      id: idSchema,
      kind: z.literal(kind),
      frame: rectSchema,
      mediaId: idSchema,
      fit: z.enum(['fit', 'fill', 'stretch']),
      loop: z.boolean().optional(),
      opacity: num.min(0).max(1).optional(),
    }),
  ),
]);
