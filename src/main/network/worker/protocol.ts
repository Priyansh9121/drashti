import type { EngineMessage } from '../../../shared/engine/protocol';
import type { NetworkChange } from '../../../shared/network';
import type { DeviceAnswer, DeviceAuth, DeviceRequest, PairAnswer } from '../../../shared/network-api';
import type { ArrivedFile, ArrivedOutcome, UploadPolicy } from '../../../shared/phone-files';
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
  | { type: 'answer'; id: number; answer: unknown }
  /** Files phones add (Session 54): the switch, the limits and on air; and what came of a file handed over. */
  | { type: 'uploads'; policy: UploadPolicy }
  | { type: 'upload-outcome'; id: string; outcome: ArrivedOutcome }
  /** What the phone reads while its file waits to be imported (a deck, while the stream is on air). */
  | { type: 'upload-note'; id: string; message: string }
  /** Whether Drashti is let in (Session 54): every request is refused while it is not. */
  | { type: 'access'; letIn: boolean };

export type WorkerQuestion =
  | { kind: 'request'; request: DeviceRequest }
  | { kind: 'pair'; code: string; address: string }
  | { kind: 'media'; mediaId: string }
  /** A sound's file for a phone to play (Session 54, D3): only while a playlist shared with phones has it. */
  | { kind: 'sound'; mediaId: string };

/** The answer each question gets. */
export interface WorkerAnswers {
  request: DeviceAnswer;
  pair: PairAnswer;
  media: PreviewSource | null;
  sound: string | null;
}

export type FromNetworkWorker =
  | { type: 'started'; result: StartResult }
  | { type: 'stopped' }
  | { type: 'ask'; id: number; question: WorkerQuestion }
  | { type: 'connected'; deviceIds: string[] }
  | { type: 'seen'; deviceId: string }
  | { type: 'resync' }
  | { type: 'log'; level: 'info' | 'warn'; message: string }
  /** A file a phone added has all arrived and is what it should be (Session 54): the main process imports it. */
  | { type: 'arrived'; file: ArrivedFile };
