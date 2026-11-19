import { z } from 'zod';
import { engineCommandSchema, type EngineCommand } from './engine/commands';

/** Public permissions on Main's existing paired computer; not credentials. */
export const CONTROLLER_AREAS = ['show', 'media'] as const;
export type ControllerArea = (typeof CONTROLLER_AREAS)[number];
export const controllerAreasSchema = z.array(z.enum(CONTROLLER_AREAS)).max(2);

/** Only ordinary show navigation and playback. Setup, libraries and stream keys never cross this path. */
export function controllerArea(command: EngineCommand): ControllerArea | null {
  switch (command.type) {
    case 'next':
    case 'previous':
    case 'back':
    case 'nextItem':
    case 'previousItem':
    case 'clearAll':
    case 'putBack':
    case 'toggleBlackout':
    case 'toggleWallpaper':
      return 'show';
    case 'pausePlaying':
    case 'resumePlaying':
    case 'skip':
    case 'pauseMusic':
    case 'resumeMusic':
    case 'musicNext':
    case 'musicPrevious':
      return 'media';
    case 'clearLayer':
      return command.layer === 'background' || command.layer === 'audio' ? 'media' : null;
    default:
      return null;
  }
}

export const engineSeenSchema = z
  .object({
    session: z.string().min(1).max(128),
    rev: z.number().int().nonnegative(),
  })
  .strict();
export type EngineSeen = z.infer<typeof engineSeenSchema>;

export const controllerRequestSchema = engineSeenSchema
  .extend({
    id: z.string().regex(/^[A-Za-z0-9-]{1,80}$/u),
    command: engineCommandSchema.refine((command) => controllerArea(command) !== null),
  })
  .strict();
export type ControllerRequest = z.infer<typeof controllerRequestSchema>;
export const controllerReplySchema = z
  .object({
    id: z.string().max(80),
    status: z.enum(['accepted', 'stale', 'refused']),
    rev: z.number().int().nonnegative(),
    message: z.string().max(300),
    changed: z.boolean().optional(),
  })
  .strict();
export type ControllerReply = z.infer<typeof controllerReplySchema>;
