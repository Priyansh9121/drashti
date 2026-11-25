import type { DeviceAnswer } from '../../shared/network-api';
import { SABHA_FLOW_LIMITS, type SabhaFlowSnapshot, sabhaFlowStateSchema } from '../../shared/sabha-flow';
import { isPng } from './flow-routes';

/*
 * What the main process answers a Remote's Sabha flow requests (alpha.23, QA23-FLOW-1 and QA23-FLOW-2;
 * shared/sabha-flow.ts), after network-service.ts's checks (Drashti let in, the device and its kind, Simple Mode's lock
 * with the window's own flow:get and flow:page): the current flow and its Now, as flow:get answers the operator window,
 * and a page of it as the PNG flow:page gives the window. Read only: a phone never chooses, removes or marks anything.
 * A page is given only for the flow that is the current one, so a page asked for just before the operator replaced the
 * PDF is refused (409), and the phone reads the flow again.
 */

/** The flow's store, as index.ts gives it: the very reads the window's flow:get and flow:page answer from. */
export interface FlowReads {
  /** The current flow and its Now (`{ flow: null, state: null }` when there is none). */
  snapshot(): SabhaFlowSnapshot;
  /** A page (from 0) of the flow with this id, as a PNG; null when there is none. */
  page(flowId: string, page: number): Promise<Uint8Array | null>;
}

const NO_FLOW: SabhaFlowSnapshot = { flow: null, state: null };

const ok = (body: Record<string, unknown>): DeviceAnswer => ({ status: 200, body: { ok: true, ...body } });
const deny = (status: number, message: string): DeviceAnswer => ({ status, body: { ok: false, message } });

/** The words a phone is told, plainly. */
export const FLOW_WORDS = {
  asked: 'Ask for a page of the Sabha flow by its number (from 0) and the flow it is of.',
  changed: 'The Sabha flow changed on the Drashti computer. Read it again.',
  noPage: 'That page is not in the Sabha flow.',
  notDrawn: 'That page of the Sabha flow could not be drawn.',
} as const;

/** GET /api/v1/flow: the current flow and its Now, or none (never a refusal: no flow is an answer too). */
export function flowAnswer(reads: FlowReads | undefined): DeviceAnswer {
  const { flow, state } = reads?.snapshot() ?? NO_FLOW;
  return ok({ flow, state });
}

/** A flow's id, as the contract takes it (shared/sabha-flow.ts). */
const flowIdOk = (id: unknown): id is string =>
  typeof id === 'string' && sabhaFlowStateSchema.safeParse({ flowId: id, now: null }).success;

/** GET /api/v1/flow/pages/{page}?flow={id}: that page of the current flow as its PNG (`png`), or why not. */
export async function flowPageAnswer(
  reads: FlowReads | undefined,
  args: Record<string, unknown>,
): Promise<DeviceAnswer> {
  const raw = args['page'];
  const page = typeof raw === 'string' && /^\d{1,3}$/u.test(raw) ? Number(raw) : -1;
  const flowId = args['flowId'];
  if (page < 0 || !flowIdOk(flowId)) return deny(400, FLOW_WORDS.asked);
  const current = reads?.snapshot().flow ?? null;
  if (!reads || current?.id !== flowId) return deny(409, FLOW_WORDS.changed);
  // Only the pages drawn (at most SABHA_FLOW_LIMITS.maxPages), never past them however many the PDF has.
  if (page >= Math.min(current.drawnPages, SABHA_FLOW_LIMITS.maxPages)) return deny(404, FLOW_WORDS.noPage);
  const png = await reads.page(flowId, page);
  // Replaced while the page was read: the phone reads the flow again.
  if (reads.snapshot().flow?.id !== flowId) return deny(409, FLOW_WORDS.changed);
  return isPng(png) ? ok({ png }) : deny(404, FLOW_WORDS.notDrawn);
}
