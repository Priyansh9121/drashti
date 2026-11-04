import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { lyricRequestSchema } from '../../shared/ai-lyrics';
export const workerContextSchema = z
  .object({
    assetsRoot: z.string().max(32768).refine(isAbsolute),
    libraryFile: z.string().max(32768).refine(isAbsolute),
    cacheFile: z.string().max(32768).refine(isAbsolute),
  })
  .strict();
const base = { id: z.string().min(1).max(100), context: workerContextSchema };
export const bookCursorSchema = z
  .object({ row: z.number().int().nonnegative(), part: z.number().int().nonnegative() })
  .strict();
export const workerJobSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('books'),
      query: z.string().trim().min(1).max(500),
      after: bookCursorSchema.optional(),
    })
    .strict(),
  z.object({ ...base, kind: z.literal('search'), query: z.string().trim().min(1).max(500) }).strict(),
  z
    .object({
      ...base,
      kind: z.literal('rank'),
      query: z.string().max(20000),
      rows: z.array(z.object({ id: z.string().max(200), text: z.string().max(20000) }).strict()).max(50),
    })
    .strict(),
  z.object({ ...base, kind: z.literal('lyrics'), request: lyricRequestSchema }).strict(),
  z
    .object({
      ...base,
      kind: z.literal('apply-lyrics'),
      text: z.string().max(20000),
      proposal: z.unknown(),
      selected: z.array(z.string().max(100)).max(200),
    })
    .strict(),
]);
export type WorkerJob = z.infer<typeof workerJobSchema>;
export type WorkerContext = z.infer<typeof workerContextSchema>;
export interface AiChild {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}
export const aiHintSchema = z
  .object({
    presentationId: z.string().min(1).max(200),
    slideId: z.string().min(1).max(200).nullable(),
    stamp: z.string().max(300),
    kind: z.enum(['meaning', 'spelling']),
    score: z.number().min(0).max(1),
  })
  .strict();
export const workerReplySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), lowPriority: z.boolean() }).strict(),
  z
    .object({ type: z.literal('progress'), id: z.string().max(100), hints: z.array(aiHintSchema).max(50) })
    .strict(),
  z.object({ type: z.literal('done'), id: z.string().max(100), value: z.unknown() }).strict(),
  z.object({ type: z.literal('error'), id: z.string().max(100) }).strict(),
]);
