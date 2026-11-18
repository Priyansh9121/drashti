import type { Socket } from 'node:dgram';
import { DEFAULT_OSC_SETTINGS, type OscResult, type OscSettings, type OscStatus } from '../../shared/osc';
import type { OscAction } from './mapping';

export interface OscDeps {
  settings: { get(key: string): unknown; set(key: string, value: unknown): void };
  letIn(): boolean;
  canConfigure(): boolean;
  run(action: OscAction): boolean;
  changed(status: OscStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  now?(): number;
  createSocket?(): Socket;
}

export function parseOscSettings(_raw: unknown): OscSettings | null { return null; }

export class OscService {
  constructor(private readonly deps: OscDeps) {}
  status(): OscStatus { return { settings: { ...DEFAULT_OSC_SETTINGS, senders: [...DEFAULT_OSC_SETTINGS.senders] }, state: 'off', message: null, received: 0, actions: 0, dropped: 0, pending: 0 }; }
  resume(): Promise<void> { return Promise.resolve(); }
  configure(_raw: unknown): Promise<OscResult> { return Promise.resolve({ ok: false, message: 'Not implemented' }); }
  accessChanged(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }
}
