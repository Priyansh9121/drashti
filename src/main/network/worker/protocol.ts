import type { EngineMessage } from '../../../shared/engine/protocol';
import type { NetworkChange } from '../../../shared/network';
import type { DeviceAnswer, DeviceAuth, DeviceRequest, PairAnswer } from '../../../shared/network-api';
import type { PreviewSource } from '../previews';
import type { ServerOptions, StartResult } from '../server';

/*
 * What the main process and the network worker (a utility process) say to
 * each other. The main process hands over each engine message once; the
 * worker asks it whatever a device's request needs (it holds the library,
 * the engine and the devices), and the main process answers by id.
 */

export type ToNetworkWorker =
  | { type: 'start'; options: ServerOptions }
  | { type: 'stop'; reason: 'network-off' }
  | { type: 'engine'; message: EngineMessage }
  | { type: 'devices'; devices: DeviceAuth[] }
  | { type: 'hint'; what: NetworkChange }
  | { type: 'answer'; id: number; answer: unknown };

export type WorkerQuestion =
  | { kind: 'request'; request: DeviceRequest }
  | { kind: 'pair'; code: string; address: string }
  | { kind: 'media'; mediaId: string };

/** The answer each question gets. */
export interface WorkerAnswers {
  request: DeviceAnswer;
  pair: PairAnswer;
  media: PreviewSource | null;
}

export type FromNetworkWorker =
  | { type: 'started'; result: StartResult }
  | { type: 'stopped' }
  | { type: 'ask'; id: number; question: WorkerQuestion }
  | { type: 'connected'; deviceIds: string[] }
  | { type: 'seen'; deviceId: string }
  | { type: 'resync' }
  | { type: 'log'; level: 'info' | 'warn'; message: string };
