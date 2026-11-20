import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { idSchema } from '../../shared/model-schema';
import type { VideoCue } from '../../shared/video-cue';

export const savedVideoCueSchema = z.object({
  label: z.string().max(300),
  playlist: z.object({ playlistId: idSchema, itemId: idSchema }).nullable(),
  background: z.object({
    kind: z.literal('media'),
    media: z.literal('video'),
    mediaId: idSchema,
    fit: z.enum(['fit', 'fill', 'stretch']),
    loop: z.boolean(),
    startedAt: z.number(),
    sourceItemId: idSchema.nullable().optional(),
    durationMs: z.number().positive().optional(),
    clip: z.object({ startMs: z.number().min(0), endMs: z.number().min(0).nullable() }).optional(),
  }),
});
export type SavedVideoCue = z.infer<typeof savedVideoCueSchema>;

export function savedVideoCue(cue: VideoCue | null | undefined): SavedVideoCue | null {
  if (!cue || cue.automatic) return null;
  const parsed = savedVideoCueSchema.safeParse(cue);
  return parsed.success ? parsed.data : null;
}

export function restoredVideoCue(saved: SavedVideoCue, required: string[], now: number): VideoCue {
  const id = randomUUID();
  return {
    ...saved,
    id,
    required,
    ready: [],
    background: {
      ...saved.background,
      cueId: id,
      startedAt: now,
      seek: { at: now, toMs: saved.background.clip?.startMs ?? 0, paused: true },
    },
  };
}
