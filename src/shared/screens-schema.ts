import { z } from 'zod';
import { idSchema } from './model-schema';
import type { CoverOptions, ScreenPatch } from './screens';
import { SCALING_MODES } from './screens';

/* Validation for screen-setup requests, which arrive over IPC. Main process only. */

export const nameSchema = z.string().trim().min(1).max(80);
export const canvasSizeSchema = z.number().int().min(16).max(16384);

export const screenPatchSchema: z.ZodType<ScreenPatch> = z
  .object({
    name: nameSchema,
    canvasWidth: canvasSizeSchema,
    canvasHeight: canvasSizeSchema,
    scaling: z.enum(SCALING_MODES),
    enabled: z.boolean(),
  })
  .partial();

export const displayIdSchema = z.number().int().nonnegative();
export { idSchema };

export const coverOptionsSchema: z.ZodType<CoverOptions> = z.object({
  coverOperator: z.boolean().optional(),
});
