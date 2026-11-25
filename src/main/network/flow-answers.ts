import type { DeviceAnswer } from '../../shared/network-api';
import type { SabhaFlowSnapshot } from '../../shared/sabha-flow';

/* Red: not built yet. */

export interface FlowReads {
  snapshot(): SabhaFlowSnapshot;
  page(flowId: string, page: number): Promise<Uint8Array | null>;
}

export const flowAnswer = (_reads: FlowReads | undefined): DeviceAnswer => ({
  status: 404,
  body: { ok: false, message: 'Not built yet.' },
});

export const flowPageAnswer = (
  _reads: FlowReads | undefined,
  _args: Record<string, unknown>,
): Promise<DeviceAnswer> => Promise.resolve({ status: 404, body: { ok: false, message: 'Not built yet.' } });
