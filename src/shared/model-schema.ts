import { z } from 'zod';
import type {
  Darken,
  ElementMotion,
  Glow,
  NativePath,
  Outline,
  Shadow,
  SlideDesign,
  SlideElement,
  TextRun,
  TextStyle,
  Transition,
} from './model';
import {
  DARKEN_KINDS,
  LIST_MARKS,
  MAX_LIST_LEVEL,
  MAX_AUTO_ADVANCE_MS,
  MAX_TRANSITION_MS,
  TIMER_AT_ZERO,
  TIMER_FORMATS,
  TRANSITION_KINDS,
  SHAPE_KINDS,
} from './model';

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

const pathCoordinate = num.min(0).max(1);
const pathPoint = { x: pathCoordinate, y: pathCoordinate };
export const nativePathSchema: z.ZodType<NativePath> = z.object({
  commands: z
    .array(
      z.discriminatedUnion('op', [
        z.object({ op: z.literal('M'), ...pathPoint }),
        z.object({ op: z.literal('L'), ...pathPoint }),
        z.object({
          op: z.literal('C'),
          x1: pathCoordinate,
          y1: pathCoordinate,
          x2: pathCoordinate,
          y2: pathCoordinate,
          ...pathPoint,
        }),
        z.object({ op: z.literal('Q'), x1: pathCoordinate, y1: pathCoordinate, ...pathPoint }),
        z.object({ op: z.literal('Z') }),
      ]),
    )
    .min(2)
    .max(4096)
    .refine((commands) => commands[0]?.op === 'M', 'A drawing starts with Move.'),
  fillRule: z.enum(['nonzero', 'evenodd']),
  lineCap: z.enum(['butt', 'round', 'square']),
  lineJoin: z.enum(['miter', 'round', 'bevel']),
});

/** A glow round letters (Session 55, Part 17a). */
export const glowSchema: z.ZodType<Glow> = z.object({
  color: hexColorSchema,
  size: num.min(0).max(500),
});

/** Degrees clockwise. */
const rotationSchema = num.min(-36_000).max(36_000).optional();
const motionTiming = {
  delayMs: num.int().min(0).max(3_600_000),
  durationMs: num.int().min(50).max(60_000),
};
export const elementMotionSchema: z.ZodType<ElementMotion> = z.object({
  in: z.object({ kind: z.enum(['fade', 'rise', 'zoom']), ...motionTiming }).optional(),
  emphasis: z.object({ kind: z.enum(['pulse', 'turn']), ...motionTiming }).optional(),
  out: z.object({ kind: z.enum(['fade', 'sink', 'shrink']), ...motionTiming }).optional(),
});
export const slideDesignSchema: z.ZodType<SlideDesign> = z.object({
  backdrop: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('gradient'),
        from: hexColorSchema,
        to: hexColorSchema,
        angle: num.min(0).max(360),
      }),
      z.object({ kind: z.literal('picture'), mediaId: idSchema, fit: z.enum(['fit', 'fill', 'stretch']) }),
    ])
    .optional(),
  layout: z.enum(['words', 'heading-words', 'two-columns']).optional(),
  skipMaster: z.boolean().optional(),
});

export function slideDesignFromJson(text: string | null | undefined): SlideDesign | undefined {
  if (!text) return undefined;
  try {
    const parsed = slideDesignSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
const sourceShapeIdSchema = z.string().regex(/^\d{1,10}$/u);
const elementPlacement = {
  sourceShapeId: sourceShapeIdSchema.optional(),
  sourceGroupIds: z.array(sourceShapeIdSchema).max(128).optional(),
  groupId: idSchema.optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  motion: elementMotionSchema.optional(),
};
const cropSchema = z
  .object({
    x: num.min(0).max(1),
    y: num.min(0).max(1),
    width: num.min(0.01).max(1),
    height: num.min(0.01).max(1),
  })
  .refine((r) => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001, 'crop is outside the picture');

/** Darkening behind the words (Sessions 31–36, SLD-3): a band or the whole picture, this dark. */
export const darkenSchema: z.ZodType<Darken> = z.object({
  kind: z.enum(DARKEN_KINDS),
  strength: z.number().min(0.05).max(0.95),
});

/** A slide's darkening as stored (JSON), or null for none, or for one that does not read. */
export function darkenFromJson(json: string | null | undefined): Darken | null {
  if (!json) return null;
  try {
    const parsed = darkenSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const transitionSchema: z.ZodType<Transition> = z.object({
  kind: z.enum(TRANSITION_KINDS),
  durationMs: num.int().min(0).max(MAX_TRANSITION_MS),
  spanMs: num
    .int()
    .min(0)
    .max(MAX_AUTO_ADVANCE_MS + MAX_TRANSITION_MS)
    .optional(),
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
  // Session 55 (Part 17a): a glow round the letters.
  glow: glowSchema.nullable().optional(),
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
  // Session 55 (Part 17a): underlined, struck through, a glow, and the line's list and level.
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  glow: glowSchema.nullable().optional(),
  list: z.enum(LIST_MARKS).optional(),
  level: num.int().min(0).max(MAX_LIST_LEVEL).optional(),
  lang: langSchema.nullable().optional(),
  legacy: z.boolean().optional(),
});

export const slideElementSchema: z.ZodType<SlideElement> = z.discriminatedUnion('kind', [
  z.object({
    ...elementPlacement,
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
  z
    .object({
      ...elementPlacement,
      id: idSchema,
      kind: z.literal('shape'),
      frame: rectSchema,
      rotation: rotationSchema,
      shape: z.enum(SHAPE_KINDS).optional(),
      path: nativePathSchema.optional(),
      fill: hexColorSchema.nullable(),
      cornerRadius: num.nonnegative(),
      opacity: num.min(0).max(1),
      outline: outlineSchema.nullable().optional(),
    })
    .refine(
      (shape) => (shape.shape === 'path' ? shape.path !== undefined : shape.path === undefined),
      'A Drawing needs its path; other shapes do not carry one.',
    ),
  ...(['image', 'video'] as const).map((kind) =>
    z.object({
      ...elementPlacement,
      id: idSchema,
      kind: z.literal(kind),
      frame: rectSchema,
      rotation: rotationSchema,
      mediaId: idSchema,
      fit: z.enum(['fit', 'fill', 'stretch']),
      loop: z.boolean().optional(),
      opacity: num.min(0).max(1).optional(),
      volume: num.min(0).max(1).optional(),
      // A video's play bar on the screens (Session 54), off unless ticked.
      playBar: z.boolean().optional(),
      crop: cropSchema.optional(),
    }),
  ),
  // A timer on a slide (Session 50): which timer, its look as words, its last minute and its zero.
  z.object({
    ...elementPlacement,
    id: idSchema,
    kind: z.literal('timer'),
    frame: rectSchema,
    rotation: rotationSchema,
    timerId: idSchema,
    style: textStyleSchema,
    lastMinute: z.object({ color: hexColorSchema }).nullable().optional(),
    atZero: z.enum(TIMER_AT_ZERO).optional(),
    opacity: num.min(0).max(1).optional(),
    // Session 55 (Part 15): its format, warning, colour at zero, flash and message at zero.
    format: z.enum(TIMER_FORMATS).optional(),
    warn: z
      .object({
        fromMs: num
          .int()
          .min(1000)
          .max(24 * 3600 * 1000),
        color: hexColorSchema,
      })
      .nullable()
      .optional(),
    overColor: hexColorSchema.optional(),
    flash: z.boolean().optional(),
    zeroText: z.string().max(200).optional(),
  }),
]);
