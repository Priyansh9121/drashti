import { z } from 'zod';
import { idSchema } from './model-schema';

export const kirtanBundleExportSchema = z
  .object({
    presentationIds: z.array(idSchema).min(1).max(1000),
    includeMedia: z.boolean(),
  })
  .strict();
export type KirtanBundleExportRequest = z.infer<typeof kirtanBundleExportSchema>;
export type KirtanBundleExportResult =
  | { ok: true; file: string; kirtans: number; media: number }
  | { ok: false; message: string; cancelled?: true };
