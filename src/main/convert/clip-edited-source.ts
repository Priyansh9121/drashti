import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoEditRecipe, VideoEditSnapshot } from '../../shared/video-edit';
import type { ClipExportRequest } from '../../shared/video-copies';
import type { DetailsRow } from '../media/media-details';
import type { MediaInfo } from './plan';
import type { ExportSourceResult } from './clip-export-service';

/** Structural subset of x61's committed editPlan API. Main supplies that actual planner after S2 lands. */
export type EditedClipPlanner = (input: {
  file: string;
  recipe: VideoEditRecipe;
  info: MediaInfo;
  identity: string;
  range: { startMs: number; endMs: number };
  frame?: '9:16';
  fit?: 'cover';
}) => { durationMs: number; target: 'mp4' | 'webm'; args(output: string): string[] };

interface Deps {
  mediaDir: string;
  /** Reverse proxy identity first, then the immutable edit rendition, to the full-quality original. */
  sourceId(id: string): string;
  row(id: string): DetailsRow | null;
  read(id: string): VideoEditSnapshot | null;
  plan: EditedClipPlanner;
}

/** Captures the saved recipe and original bytes once. A later Save cannot change an accepted export. */
export function editedClipSource(request: ClipExportRequest, deps: Deps): ExportSourceResult {
  const { startMs, endMs, shape, container } = request;
  const id = deps.sourceId(request.mediaId);
  const edit = deps.read(id);
  const row = deps.row(id);
  if (edit?.state !== 'ready' || request.revision !== edit.revision)
    return {
      ok: false,
      message:
        'The saved edits changed or are still preparing. Reopen Edit Video… and wait until ready before exporting.',
    };
  if (
    row?.kind !== 'video' ||
    row.deleted ||
    row.missing ||
    !row.sha256 ||
    !row.durationMs ||
    !row.path ||
    !existsSync(join(deps.mediaDir, row.path))
  )
    return {
      ok: false,
      message: 'The original video is unavailable. Restore its file before exporting the saved edits.',
    };
  const recipe = structuredClone(edit.recipe);
  if (
    startMs < (recipe.trim.startMs ?? 0) ||
    endMs > (recipe.trim.endMs ?? row.durationMs) ||
    endMs <= startMs
  )
    return { ok: false, message: 'Choose an export start and end inside the saved trim, then Export again.' };
  const identity = `${row.sha256}:edit:${String(edit.revision)}:${createHash('sha256').update(JSON.stringify(recipe)).digest('hex')}`;
  const source = join(deps.mediaDir, row.path);
  return {
    ok: true,
    source: {
      mediaId: id,
      sha256: row.sha256,
      name: row.name,
      path: source,
      identity,
      durationMs: row.durationMs,
      startMs: startMs,
      endMs: endMs,
      outputLengthMs: (endMs - startMs) / recipe.speed,
      args: (info, output) => {
        const plan = deps.plan({
          file: source,
          recipe,
          info,
          identity,
          range: { startMs: startMs, endMs: endMs },
          ...(shape === 'vertical' ? { frame: '9:16', fit: 'cover' } : {}),
        });
        if (plan.target === 'webm' && container === 'mp4')
          throw new Error('Choose WebM to keep this video’s transparency.');
        const args = plan.args(output);
        if (shape === 'vertical') {
          const graph = args.indexOf('-filter_complex') + 1;
          const map = args.indexOf('-map') + 1;
          const label = args[map];
          if (graph === 0 || map === 0 || !label || !/^\[[A-Za-z0-9_]+\]$/u.test(label))
            throw new Error(
              'The edited export could not prepare its picture. Open Edit Video… and try again.',
            );
          const existingGraph = args[graph];
          if (!existingGraph)
            throw new Error('The edited picture could not be read. Open the editor and try Export again.');
          args[graph] =
            `${existingGraph};${label}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[clip_export_picture]`;
          args[map] = '[clip_export_picture]';
        }
        if (container === 'webm' && plan.target !== 'webm') {
          for (const flag of ['-preset', '-movflags']) {
            const at = args.indexOf(flag);
            if (at >= 0) args.splice(at, 2);
          }
          const codec = args.indexOf('-c:v');
          const crf = args.indexOf('-crf');
          const muxer = args.lastIndexOf('-f');
          if (codec < 0 || crf < 0 || muxer < 0)
            throw new Error(
              'The edited export format could not be prepared. Open the editor and try Export again.',
            );
          args[codec + 1] = 'libvpx-vp9';
          args[crf + 1] = '24';
          const audio = args.indexOf('-c:a');
          if (audio >= 0) args[audio + 1] = 'libopus';
          args[muxer + 1] = 'webm';
          args.splice(muxer, 0, '-b:v', '0', '-auto-alt-ref', '0', '-deadline', 'good', '-cpu-used', '4');
        }
        return args;
      },
    },
  };
}
