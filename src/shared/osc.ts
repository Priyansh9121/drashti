/** OSC is independent of Phones, and stays off until set up on the operator computer. */
export interface OscSettings {
  enabled: boolean;
  port: number;
  senders: string[];
}

export const DEFAULT_OSC_SETTINGS: OscSettings = { enabled: false, port: 9000, senders: ['127.0.0.1'] };

export interface OscStatus {
  settings: OscSettings;
  state: 'off' | 'starting' | 'listening' | 'failed';
  message: string | null;
  received: number;
  actions: number;
  dropped: number;
  pending: number;
}

export type OscResult = { ok: true; status: OscStatus } | { ok: false; message: string };
