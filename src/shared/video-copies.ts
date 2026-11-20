import { z } from 'zod';
import { idSchema } from './model-schema';
export interface VideoProxy {
  mediaId: string;
  state: 'checking' | 'waiting' | 'preparing' | 'ready' | 'not-needed' | 'failed' | 'stopped';
  required: boolean;
  readyMediaId: string | null;
  progress: number | null;
  width: number | null;
  height: number | null;
  note: string | null;
  message: string | null;
}
export type VideoProxyResult = { ok: true; proxy: VideoProxy } | { ok: false; message: string };
export interface ClipExportRequest {
  mediaId: string;
  startMs: number;
  endMs: number;
  frame: 'original' | 'edited';
  shape: 'source' | 'vertical';
  container: 'mp4' | 'webm';
  addToLibrary: boolean;
  /** An edited export must match the editor's saved revision. */
  revision: number | null;
}
const ms = z.number().int().min(0).max(86_400_000);
export const clipExportRequestSchema: z.ZodType<ClipExportRequest> = z
  .object({
    mediaId: idSchema,
    startMs: ms,
    endMs: ms,
    frame: z.enum(['original', 'edited']),
    shape: z.enum(['source', 'vertical']),
    container: z.enum(['mp4', 'webm']),
    addToLibrary: z.boolean(),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict()
  .refine((r) => r.endMs > r.startMs);
export interface ClipExportJob {
  id: string;
  mediaId: string;
  name: string;
  state: 'waiting' | 'preparing' | 'done' | 'failed' | 'stopped';
  progress: number | null;
  note: string | null;
  message: string | null;
  path: string | null;
  added: boolean;
}
export type ClipExportResult = { ok: true; job: ClipExportJob | null } | { ok: false; message: string };
