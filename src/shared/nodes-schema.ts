import { z } from 'zod';
import { MEDIA_ID_PATTERN } from './media';
import { MEDIA_EXT_PATTERN, NODE_NAME_MAX } from './nodes';
import type { MediaWant, NodeHealth, NodeScreen } from './nodes';
import type { DisplayInfo, DisplayKey } from './screens';
import { SCALING_MODES } from './screens';

/*
 * Checks on what crosses the node link (Session 13), in both directions:
 * Main checks what a node reports, and a node checks what Main tells it to
 * show. Both ends are Drashti, but a message is read as data, never trusted
 * for its shape or size. Main and node processes only.
 */

const finite = z.number();
const rect = z.object({ x: finite, y: finite, width: finite, height: finite });

export const displayKeySchema: z.ZodType<DisplayKey> = z.object({
  id: finite,
  label: z.string().max(200),
  pixelWidth: finite,
  pixelHeight: finite,
  x: finite,
  y: finite,
  internal: z.boolean(),
});

export const displayInfoSchema: z.ZodType<DisplayInfo> = z.object({
  id: finite,
  label: z.string().max(200),
  bounds: rect,
  workArea: rect,
  scaleFactor: finite,
  pixelWidth: finite,
  pixelHeight: finite,
  refreshHz: finite,
  rotation: finite,
  internal: z.boolean(),
  primary: z.boolean(),
  key: displayKeySchema,
});

/** A computer has a handful of displays: more than 16 is not a report to keep. */
export const displayListSchema = z.array(displayInfoSchema).max(16);

const mediaId = z.string().regex(MEDIA_ID_PATTERN);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

export const mediaWantSchema: z.ZodType<MediaWant> = z.object({
  id: mediaId,
  sha256,
  bytes: z.number().int().nonnegative(),
  ext: z.string().regex(MEDIA_EXT_PATTERN),
});

export const mediaWantListSchema = z.array(mediaWantSchema).max(100_000);

export const nodeScreenSchema: z.ZodType<NodeScreen> = z.object({
  screenId: z.string().min(1).max(128),
  name: z.string().max(200),
  groupId: z.string().min(1).max(128),
  groupName: z.string().max(200),
  role: z.enum(['audience', 'stage', 'stream', 'keyfill', 'other']),
  feed: z.enum(['fill', 'key']).nullable(),
  canvasWidth: z.number().int().min(16).max(16384),
  canvasHeight: z.number().int().min(16).max(16384),
  scaling: z.enum(SCALING_MODES),
  enabled: z.boolean(),
  displayKey: displayKeySchema,
});

export const nodeScreenListSchema = z.array(nodeScreenSchema).max(16);

export const nodeHealthSchema: z.ZodType<NodeHealth> = z.object({
  version: z.string().max(40),
  host: z.string().max(200),
  displays: displayListSchema,
  outputs: z
    .array(
      z.object({
        screenId: z.string().min(1).max(128),
        state: z.enum(['showing', 'missing-display', 'disabled']),
        displayId: finite.nullable(),
        droppedFrames: z.number().int().nonnegative(),
        paintedRev: z.number().int(),
      }),
    )
    .max(16),
  media: z.object({
    wanted: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    bytesWanted: z.number().nonnegative(),
    bytesReady: z.number().nonnegative(),
    copying: z
      .object({ id: z.string().max(128), bytes: z.number().nonnegative(), done: z.number().nonnegative() })
      .nullable(),
    missingNow: z.number().int().nonnegative(),
    problem: z.string().max(300).nullable(),
  }),
  clock: z.object({ offsetMs: finite, rttMs: z.number().nonnegative(), at: finite }).nullable(),
  rev: z.number().int(),
});

export const nodeNameSchema = z.string().trim().min(1).max(NODE_NAME_MAX);

/** What a node sends to start pairing. */
export const pairStartSchema = z
  .object({
    x: z.string().max(600),
    name: z.string().max(200),
    version: z.string().max(40),
    protocol: z.number().int(),
  })
  .strict();

export const pairFinishSchema = z.object({ session: z.uuid(), confirm: z.string().max(80) }).strict();

/** A node's name as it gives it (its computer's name), fitted to what Main keeps. */
export function nodeNameFrom(given: string): string {
  const name = given
    .replace(/\.local$/iu, '')
    .replace(/[\p{Cc}]/gu, '')
    .trim()
    .slice(0, NODE_NAME_MAX);
  return name === '' ? 'Node' : name;
}
