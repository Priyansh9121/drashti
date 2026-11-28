import type { FromDevice } from '../../shared/network';
import type { FromNode } from '../../shared/nodes';
import { controllerRequestSchema } from '../../shared/controller-actions';
import { nodeCannotPlaySchema, nodeHealthSchema, nodeVideoCueSchema } from '../../shared/nodes-schema';

const record = (m: unknown): m is Record<string, unknown> =>
  m !== null && typeof m === 'object' && !Array.isArray(m);
const token = (t: unknown): t is string => typeof t === 'string' && t.length > 0 && t.length <= 200;
const clock = (m: Record<string, unknown>) => typeof m['t0'] === 'number' && Number.isFinite(m['t0']);

/** JSON parses to unknown. Validate before touching a discriminant, even before authentication. */
export function deviceMessage(m: unknown): m is FromDevice {
  if (!record(m)) return false;
  switch (m['type']) {
    case 'hello':
      return (
        token(m['token']) &&
        (m['chat'] === undefined || typeof m['chat'] === 'boolean') &&
        (m['lowerThirdMotions'] === undefined ||
          (typeof m['lowerThirdMotions'] === 'string' && m['lowerThirdMotions'].length <= 80))
      );
    case 'clock':
      return clock(m);
    case 'resync':
      return true;
    default:
      return false;
  }
}

export function nodeMessage(m: unknown): m is FromNode {
  if (!record(m)) return false;
  switch (m['type']) {
    case 'hello':
      return (
        token(m['token']) &&
        typeof m['version'] === 'string' &&
        m['version'].length <= 40 &&
        Number.isSafeInteger(m['protocol']) &&
        Number.isSafeInteger(m['engine'])
      );
    case 'clock':
      return clock(m);
    case 'resync':
      return true;
    case 'health':
      return nodeHealthSchema.safeParse(m['health']).success;
    case 'controller-action':
      return controllerRequestSchema.safeParse(m['request']).success;
    case 'cannot-play':
      return nodeCannotPlaySchema.safeParse(m['report']).success;
    case 'video-cue':
      return nodeVideoCueSchema.safeParse(m['report']).success;
    case 'thumb':
      return (
        typeof m['screenId'] === 'string' &&
        m['screenId'].length <= 128 &&
        typeof m['jpeg'] === 'string' &&
        m['jpeg'].length <= 400 * 1024 &&
        /^[A-Za-z0-9+/=]*$/u.test(m['jpeg'])
      );
    default:
      return false;
  }
}
