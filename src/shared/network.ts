import type { EngineMessage } from './engine/protocol';

/*
 * The local network (PLAN.md 5.2, Session 10): phones, tablets and browsers
 * on the mandir's Wi-Fi, once paired, run the show (Remote), watch it as a
 * stage screen does (Stage) or send announcements (Announcements). The
 * network is off until the operator turns it on in Pro Mode, and anyone on
 * the network is a stranger until their device is paired: every request
 * that reads or does anything carries the device's token.
 *
 * The state feed (a full state, then revisioned patches, and the engine's
 * clock) is the same one output nodes will follow (Session 13).
 */

export type DeviceKind = 'remote' | 'stage' | 'announcements';

export const DEVICE_KINDS = ['remote', 'stage', 'announcements'] as const satisfies readonly DeviceKind[];

export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  remote: 'Remote',
  stage: 'Stage',
  announcements: 'Announcements',
};

/** What each kind of device is for, as the operator reads it when pairing one. */
export const DEVICE_KIND_HELP: Record<DeviceKind, string> = {
  remote: 'Runs the show: Next and Back, slides, clears, black-out, logo, timers and messages.',
  stage: 'Watches only: shows what a stage screen shows.',
  announcements: 'Sends announcements for the operator to approve; nothing else.',
};

/** The port Drashti listens on unless the operator chooses another. */
export const DEFAULT_NETWORK_PORT = 8740;
export const MIN_NETWORK_PORT = 1024;
export const MAX_NETWORK_PORT = 65535;

/** A pairing code works once, for this long. */
export const PAIRING_CODE_TTL_MS = 2 * 60 * 1000;
export const PAIRING_CODE_DIGITS = 6;

/** A device's name, as the operator gives it. */
export const DEVICE_NAME_MAX = 60;

/** A device as the operator window lists it (never its token). */
export interface DeviceInfo {
  id: string;
  name: string;
  kind: DeviceKind;
  /** ISO time it was paired. */
  pairedAt: string;
  /** ISO time it last asked for anything, or null. */
  lastSeenAt: string | null;
  /** It has the state feed open now. */
  connected: boolean;
  /** The announcements poster link (one at a time), not a paired phone. */
  poster: boolean;
}

/** A code being offered to pair a device, as the operator window shows it. */
export interface PairingOffer {
  code: string;
  kind: DeviceKind;
  name: string;
  /** The address the QR code opens: the code is in its #fragment, which browsers never send. */
  url: string;
  expiresAt: number;
}

export interface NetworkStatus {
  /** The operator turned it on (it stays on over a restart). */
  on: boolean;
  state: 'off' | 'starting' | 'listening' | 'failed';
  port: number;
  /** Why it is not listening, in words (the port is taken...). */
  message: string | null;
  /** Addresses a phone on the same network can open, numbers first. */
  addresses: string[];
  /** This computer's name on the local network (name.local), when it has one. */
  localName: string | null;
  /** Devices with the state feed open now. */
  connected: number;
  devices: DeviceInfo[];
  pairing: PairingOffer | null;
  /** The poster link just made, shown once (only its hash is kept). */
  poster: { url: string; madeAt: string } | null;
}

export type NetworkResult = { ok: true; status: NetworkStatus } | { ok: false; message: string };

// ---- the WebSocket feed ---------------------------------------------------------------

/** The feed's path; HTTP requests are under /api/v1 too. */
export const FEED_PATH = '/api/v1/feed';

/** What a device sends on the feed. The first message must be `hello`, within a few seconds. */
export type FromDevice =
  | { type: 'hello'; token: string }
  /** Clock sync: the device's time when it asked. */
  | { type: 'clock'; t0: number }
  /** The device's copy fell behind (a revision went missing): send the whole state again. */
  | { type: 'resync' };

/** Hints that lists a device shows have changed and should be read again. */
export type NetworkChange = 'playlists' | 'presentations' | 'messages' | 'timers' | 'props';

/** What the feed sends a device. */
export type ToDevice =
  | { type: 'welcome'; device: { name: string; kind: DeviceKind } }
  | { type: 'engine'; message: EngineMessage }
  /** The answer to a clock message: the device's t0, and the engine's clock when it was answered. */
  | { type: 'clock'; t0: number; server: number }
  | { type: 'changed'; what: NetworkChange }
  /** The connection is ending, and why (the device was revoked, the network turned off...). */
  | { type: 'bye'; reason: ByeReason };

export type ByeReason = 'unauthorized' | 'revoked' | 'network-off' | 'too-slow' | 'not-allowed';

export const BYE_TEXT: Record<ByeReason, string> = {
  unauthorized: 'This device is not paired with Drashti (or its pairing was removed). Pair it again.',
  revoked: 'This device was removed in Drashti. Pair it again to use it.',
  'network-off': 'Drashti’s network was turned off.',
  'too-slow': 'The connection was too slow to keep up. Connecting again…',
  'not-allowed': 'This device cannot show the state.',
};

/**
 * Clock sync: of several round trips, the shortest says the most. The
 * offset is what to add to this device's clock to get the engine's.
 */
export function clockOffset(samples: readonly { t0: number; t1: number; server: number }[]): number | null {
  let best: { rtt: number; offset: number } | null = null;
  for (const s of samples) {
    const rtt = s.t1 - s.t0;
    if (rtt < 0) continue;
    const offset = s.server - (s.t0 + s.t1) / 2;
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  return best ? best.offset : null;
}
