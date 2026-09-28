import { z } from 'zod';
import type { ImportOptions } from './import';

/*
 * Checks for import requests arriving over IPC. Whether a path is absolute
 * and exists is checked in the main process, which can see the file system.
 */

const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes('\0'), 'a path cannot contain NUL');

export const importPathsSchema = z.array(pathSchema).min(1).max(1000);

const choiceSchema = z.enum(['replace', 'keep-both', 'skip']);

export const importOptionsSchema: z.ZodType<ImportOptions> = z
  .object({
    onConflict: z.enum(['ask', 'replace', 'keep-both', 'skip']).optional(),
    decisions: z
      .record(pathSchema, choiceSchema)
      .refine((d) => Object.keys(d).length <= 10_000, 'too many decisions')
      .optional(),
  })
  .strict();

export const runIdSchema = z.string().min(1).max(128);
