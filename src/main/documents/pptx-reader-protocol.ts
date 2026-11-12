import { z } from 'zod';
import { sourceTimingDeck } from '../../shared/deck-source-timing';
import { EDITABLE_SOURCE_LIMITS, type PreparedSourcePage } from '../../shared/editable-source';
import { hexColorSchema, slideElementSchema } from '../../shared/model-schema';

/** Both sides check a page's shape, while Main also checks the job and the files it names. */
export const pptxPageSchema = z
  .object({
    sourceIndex: z.number().int().min(0),
    width: z.number().min(16).max(16_384),
    height: z.number().min(16).max(16_384),
    background: hexColorSchema.nullable(),
    elements: z.array(slideElementSchema).max(EDITABLE_SOURCE_LIMITS.pageElements),
    issues: z.array(z.string().max(300)).max(100),
    assets: z
      .array(
        z
          .object({
            token: z.string().min(1).max(512),
            relative: z.string().min(1).max(32_768),
            kind: z.enum(['image', 'video', 'audio']),
          })
          .strict(),
      )
      .max(EDITABLE_SOURCE_LIMITS.pageElements),
    // A timed page's clicks and transition (W6's review N4), only their known parts; anything else is
    // dropped here, never failing the reply, and only an asked page's are taken (below).
    deck: z
      .unknown()
      .transform((value) => sourceTimingDeck(value))
      .optional(),
    sourceVideoShapeIds: z
      .array(z.string().regex(/^\d{1,10}$/u))
      .max(EDITABLE_SOURCE_LIMITS.pageElements)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
  })
  .strict();

export interface PptxReadStart {
  type: 'read';
  jobId: string;
  file: string;
  outDir: string;
  sourcePages: number[];
  /** The pages whose clicks and transition to read too (SourceRead's `timingPages`). */
  timingPages?: number[];
}
export type ToPptxReader = PptxReadStart | { type: 'cancel'; jobId: string };
export type PptxPage = Omit<PreparedSourcePage, 'assets'> & {
  assets: { token: string; relative: string; kind: 'image' | 'video' | 'audio' }[];
};
export type FromPptxReader =
  | { type: 'prepared'; jobId: string; pages: PptxPage[]; total: number; failed: number[] }
  | { type: 'failed'; jobId: string };

export interface PptxReaderChild {
  post(message: ToPptxReader): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}
