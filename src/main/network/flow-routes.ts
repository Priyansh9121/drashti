import type { DeviceOp } from '../../shared/network-api';

/*
 * Sabha flow on a phone (alpha.23, QA23-FLOW-1 and QA23-FLOW-2; docs/api.md): a Remote reads the operator's current
 * flow and its Now, and one of its pages as a picture, read only. Made by server.ts's own `route`, so each is checked
 * as every other request is (a Remote's token, its kind, the lock's 503, the limits; Simple Mode in the main process).
 * The page is asked for by its number (from 0) in the path and the flow's id in the query (`?flow=`): the main process
 * refuses a page of a flow that is no longer the current one (flow-answers.ts), so a phone never shows the page of a
 * PDF the operator has replaced.
 */

type MakeRoute<R> = (
  method: 'GET' | 'POST',
  path: string,
  op: DeviceOp,
  args?: (body: Record<string, unknown>, params: Record<string, string>) => unknown,
  param?: RegExp,
) => R;

/** A page's number in the path: 0 to 999 (the flow holds far fewer: SABHA_FLOW_LIMITS.maxPages). */
export const FLOW_PAGE_PARAM = /^\d{1,3}$/u;

export function flowRoutes<R>(route: MakeRoute<R>): R[] {
  return [
    route('GET', '/api/v1/flow', 'flow'),
    route(
      'GET',
      '/api/v1/flow/pages/:page',
      'flow.page',
      (q, p) => ({ page: p['page'], flowId: q['flow'] }),
      FLOW_PAGE_PARAM,
    ),
  ];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Whether these bytes start as a PNG does. */
export function isPng(bytes: unknown): bytes is Uint8Array {
  return (
    bytes instanceof Uint8Array &&
    bytes.length > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((b, i) => bytes[i] === b)
  );
}

/** The page's PNG in the main process's answer to `flow.page` (`{ ok: true, png }`), or null when it holds none. */
export function flowPagePng(reply: unknown): Uint8Array | null {
  if (!reply || typeof reply !== 'object' || !('png' in reply)) return null;
  return isPng(reply.png) ? reply.png : null;
}
