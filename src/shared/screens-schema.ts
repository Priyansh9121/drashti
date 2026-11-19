import { z } from 'zod';
import { idSchema, langSchema } from './model-schema';
import { cleanNameSchema } from './rename-name';
import type { ScreenGeometry } from './screen-geometry';
import { cornersProblem, GEOMETRY_LIMITS } from './screen-geometry';
import type { CoverOptions, ScreenPatch } from './screens';
import { SCALING_MODES } from './screens';

/* Validation for screen-setup requests, which arrive over IPC. Main process only. */

/** A screen's or a screen group's name, cleaned as Rename… cleans a file's (Session 58, X3). */
export const nameSchema = cleanNameSchema(80);
export const canvasSizeSchema = z.number().int().min(16).max(16384);

/** A move as a share of the display: at most half of it either way. */
const shareSchema = z.number().min(-GEOMETRY_LIMITS.move).max(GEOMETRY_LIMITS.move);
const pointSchema = z.object({ x: shareSchema, y: shareSchema });

/** What a screen's geometry's words say when it is refused (x27). */
export const GEOMETRY_REFUSED =
  'A picture zooms from 50 % to 200 % and moves, and each corner moves, at most half the display; an overlap is at most half the screen’s part, gamma 1 to 3 and curve 1 to 4.';

/**
 * A screen's geometry (x27, shared/screen-geometry.ts), as it arrives over IPC, the API or the node link: every number
 * in its bounds, the corners keeping a convex picture the same way round, each overlap at most half its part. That the
 * part lies inside the screen's canvas is the screens service's to check (the canvas can change with it).
 */
export const screenGeometrySchema: z.ZodType<ScreenGeometry> = z
  .object({
    zoom: z.number().min(GEOMETRY_LIMITS.zoom.min).max(GEOMETRY_LIMITS.zoom.max),
    offsetX: shareSchema,
    offsetY: shareSchema,
    corners: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]),
    part: z.object({ x: z.number().int().min(0).max(16384), width: canvasSizeSchema }).nullable(),
    blend: z
      .object({
        left: z.number().int().min(0).max(8192),
        right: z.number().int().min(0).max(8192),
        gamma: z.number().min(GEOMETRY_LIMITS.gamma.min).max(GEOMETRY_LIMITS.gamma.max),
        curve: z.number().min(GEOMETRY_LIMITS.curve.min).max(GEOMETRY_LIMITS.curve.max),
      })
      .nullable(),
  })
  .refine((g) => cornersProblem(g.corners) === null, {
    message: 'The corners must keep the picture a four-sided shape, the same way round.',
  })
  .refine(
    (g) =>
      g.blend === null ||
      g.part === null ||
      (g.blend.left <= g.part.width / 2 && g.blend.right <= g.part.width / 2),
    { message: 'An overlap is at most half the screen’s part.' },
  );

export const screenPatchSchema: z.ZodType<ScreenPatch> = z
  .object({
    name: nameSchema,
    canvasWidth: canvasSizeSchema,
    canvasHeight: canvasSizeSchema,
    scaling: z.enum(SCALING_MODES),
    enabled: z.boolean(),
    feed: z.enum(['fill', 'key']),
    // Its geometry (x27); null: nothing set.
    geometry: screenGeometrySchema.nullable(),
  })
  .partial();

export const displayIdSchema = z.number().int().nonnegative();
export { idSchema };

export const coverOptionsSchema: z.ZodType<CoverOptions> = z.object({
  coverOperator: z.boolean().optional(),
});

/** A group's languages: one to four, each once, in the order shown; null for all of them. */
export const groupLanguagesSchema = z
  .array(langSchema)
  .min(1)
  .max(4)
  .refine((list) => new Set(list).size === list.length, 'a language is listed twice')
  .nullable();
