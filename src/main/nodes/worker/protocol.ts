import type { EngineMessage } from '../../../shared/engine/protocol';
import type { MediaWant, NodeHealth, NodeScreen, ToNode } from '../../../shared/nodes';
import type { LinkNode, LinkOptions, LinkStartResult, LinkStats } from '../link-server';

/*
 * What the main process and the node link worker (a utility process) say to
 * each other. The main process hands over each engine message once, the
 * paired nodes, the code on offer, and what each node shows and should copy;
 * the worker tells it who is online, their health and pictures, and asks it
 * what only the main process knows (a new node to keep, a media file).
 */

export type ToLinkWorker =
  | { type: 'start'; options: LinkOptions }
  | { type: 'stop' }
  | { type: 'engine'; message: EngineMessage }
  | { type: 'nodes'; nodes: LinkNode[] }
  | { type: 'offer'; offer: { code: string; expiresAt: number } | null }
  | { type: 'screens'; nodeId: string; screens: NodeScreen[] }
  | { type: 'media'; nodeId: string; wanted: MediaWant[] }
  | { type: 'rate'; bytesPerSecond: number }
  | { type: 'thumbs'; everyMs: number | null }
  | { type: 'to-node'; nodeId: string; message: ToNode }
  | { type: 'stats'; reset: boolean }
  | { type: 'answer'; id: number; answer: unknown };

export type LinkQuestion =
  | { kind: 'paired'; node: { name: string; tokenHash: string; address: string; version: string } }
  | { kind: 'media'; mediaId: string };

export interface LinkAnswers {
  paired: { id: string; name: string } | null;
  media: { path: string; sha256: string; bytes: number; ext: string } | null;
}

export type FromLinkWorker =
  | { type: 'started'; result: LinkStartResult }
  | { type: 'stopped' }
  | { type: 'ask'; id: number; question: LinkQuestion }
  | { type: 'online'; nodeId: string; address: string; version: string }
  | { type: 'offline'; nodeId: string }
  | { type: 'health'; nodeId: string; health: NodeHealth }
  | { type: 'thumb'; nodeId: string; screenId: string; jpeg: string }
  | { type: 'refused'; nodeId: string; version: string }
  | { type: 'offer-dropped' }
  | { type: 'resync' }
  | { type: 'stats'; stats: LinkStats }
  | { type: 'log'; level: 'info' | 'warn'; message: string };
