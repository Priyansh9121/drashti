import type { DeviceKind } from './network';

/*
 * What a paired device may ask for, by kind. The network server checks the
 * kind first; the main process checks it again (and the device itself, and
 * Simple Mode) before anything runs. A device never changes the library,
 * the screens, the sound, the stream, conversions, imports, backups, the
 * network's settings or Simple Mode: none of those are here.
 */
export const DEVICE_OPS = {
  /** Who this device is. */
  me: ['remote', 'stage', 'announcements'],
  /** A short summary of what is on the screens. */
  status: ['remote', 'stage'],
  /** The whole engine state, with its revision. */
  state: ['remote', 'stage'],
  /** The stage display's screen group (the first stage group) and its languages in the live Look. */
  stage: ['stage'],
  /** The Looks, in order, and which is live. */
  looks: ['remote'],
  /** The macros (name, colour), in order. */
  macros: ['remote'],
  /** Run a macro (Simple Mode refuses). */
  'macro.run': ['remote'],
  playlists: ['remote'],
  /** A playlist's items. */
  items: ['remote'],
  /** A presentation's slides, groups and arrangements (as the operator window reads them). */
  presentation: ['remote'],
  /** Message templates and their fields. */
  messages: ['remote'],
  timers: ['remote'],
  /** Whether a logo is marked (Logo shows it). */
  logo: ['remote'],
  /** An engine command that runs the show (only the kinds in REMOTE_COMMANDS). */
  command: ['remote'],
  /** Show or hide the marked logo. */
  'logo.set': ['remote'],
  /** Fill a message template's fields and show it, or take a message off. */
  'message.show': ['remote'],
  'message.hide': ['remote'],
  /** A small picture of a media item for a thumbnail. */
  preview: ['remote'],
  /** Send an announcement for the operator to approve. */
  announce: ['announcements'],
  /** What became of an announcement this device sent. */
  announcement: ['announcements'],
} as const satisfies Record<string, readonly DeviceKind[]>;

export type DeviceOp = keyof typeof DEVICE_OPS;

export const isDeviceOp = (op: string): op is DeviceOp => Object.hasOwn(DEVICE_OPS, op);

export const deviceMay = (kind: DeviceKind, op: DeviceOp): boolean =>
  (DEVICE_OPS[op] as readonly DeviceKind[]).includes(kind);

/**
 * The engine commands a Remote may send: running the show, as the operator
 * window does, and switching the Look. Not setting backgrounds, sounds,
 * props, masks or the stage message, and never anything that changes the
 * library.
 */
export const REMOTE_COMMANDS = [
  'goLive',
  'playItem',
  'next',
  'previous',
  'back',
  'nextItem',
  'previousItem',
  'clearLayer',
  'clearAll',
  'putBack',
  'setBlackout',
  'toggleBlackout',
  'startTimer',
  'pauseTimer',
  'resetTimer',
  // Switching the live Look (Simple Mode refuses it, as in the window).
  'setLook',
] as const;

/** A request from the network server to the main process, for a paired device. */
export interface DeviceRequest {
  deviceId: string;
  op: DeviceOp;
  args: unknown;
  /** The address it came from (for the limit on announcements waiting from one phone; never logged). */
  address: string;
}

/** The main process's answer: an HTTP status and a JSON body. */
export interface DeviceAnswer {
  status: number;
  body: unknown;
}

/** What pairing answers: the new device's token (shown to it once), or why not. */
export type PairAnswer =
  | {
      ok: true;
      token: string;
      device: { id: string; name: string; kind: DeviceKind; tokenHash: string };
    }
  | { ok: false; status: number; message: string };

/** A device as the network server knows it: enough to check its token. */
export interface DeviceAuth {
  id: string;
  name: string;
  kind: DeviceKind;
  tokenHash: string;
}
