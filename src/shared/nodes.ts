import type { EngineMessage } from './engine/protocol';
import type { DisplayInfo, DisplayKey, ScalingMode, ScreenFeed, ScreenRole } from './screens';

/*
 * Output nodes (PLAN.md 4.1, Session 13). The same Drashti app, started as a
 * Node, follows one Main over the local network and drives its own displays:
 * it receives the show (the engine's state feed) and the media, draws with
 * the same output renderer, and reports its health. It never changes the
 * show, the library or the settings, and never makes sound.
 *
 * Main and its nodes talk over TLS on a port of their own (8741), separate
 * from the phones' plain HTTP. Main makes its own certificate once; a node
 * pins it when it pairs and from then on follows only that Main. Pairing is
 * a code Main shows, typed on the node: the code drives a password-
 * authenticated key exchange bound to the certificate's fingerprint
 * (src/main/nodes/pake.ts), so even someone between the two while they pair
 * gets one guess and cannot have their own certificate pinned.
 */

/** What this computer is: the one that runs the show, or a node that follows one. */
export type DrashtiRole = 'main' | 'node';

export const DEFAULT_NODE_PORT = 8741;
/** The node link's own protocol, sent in every hello (Main and a node must run the same Drashti anyway). */
export const NODE_PROTOCOL = 1;
export const NODE_NAME_MAX = 60;
/** A node's pairing code works once, for this long (as a phone's). */
export const NODE_PAIRING_TTL_MS = 2 * 60 * 1000;

/** Paths on the node link. */
export const NODE_PATHS = {
  pairStart: '/node/v1/pair/start',
  pairFinish: '/node/v1/pair/finish',
  feed: '/node/v1/feed',
  /** + a media id: the file, by range. */
  media: '/node/v1/media/',
} as const;

// ---- what a node shows ---------------------------------------------------------------------

/** A screen on one of a node's displays: Main's settings for it. The node keeps the last it was given. */
export interface NodeScreen {
  screenId: string;
  name: string;
  groupId: string;
  groupName: string;
  role: ScreenRole;
  feed: ScreenFeed | null;
  canvasWidth: number;
  canvasHeight: number;
  scaling: ScalingMode;
  enabled: boolean;
  displayKey: DisplayKey;
}

/** A media file a node should have a copy of, in the order to copy them. */
export interface MediaWant {
  id: string;
  sha256: string;
  bytes: number;
  /** The file's extension on Main (lower case, without the dot): the copy keeps it, so it is served as what it is. */
  ext: string;
}

/** A media file's extension as Drashti keeps it (letters and digits, up to 8; '' for none). */
export const MEDIA_EXT_PATTERN = /^[a-z0-9]{0,8}$/u;

// ---- what a node reports -------------------------------------------------------------------

export interface NodeMediaStatus {
  /** Files Main wants it to have, and how many of them it has (each checked by its hash). */
  wanted: number;
  ready: number;
  bytesWanted: number;
  bytesReady: number;
  /** The file being copied now: its id, size and how much has arrived. */
  copying: { id: string; bytes: number; done: number } | null;
  /** Files on the screens or up next that are not here yet (fetched at once). */
  missingNow: number;
  /** Why copying has stopped, in words (no room on the disk...), or null. */
  problem: string | null;
}

export interface NodeOutputStatus {
  screenId: string;
  state: 'showing' | 'missing-display' | 'disabled';
  displayId: number | null;
  /** Frames that came late (over one and a half frame times) in the last minute. */
  droppedFrames: number;
  /** The engine revision it last painted, and when (engine clock). */
  paintedRev: number;
}

export interface NodeClock {
  /** What to add to the node's clock to get Main's engine clock (ms). */
  offsetMs: number;
  /** The round trip the estimate came from (ms): the estimate is good to about half of it. */
  rttMs: number;
  /** When it was measured (ms since the epoch, Main's clock). */
  at: number;
}

export interface NodeHealth {
  version: string;
  /** The node's computer name, as its OS gives it. */
  host: string;
  displays: DisplayInfo[];
  outputs: NodeOutputStatus[];
  media: NodeMediaStatus;
  clock: NodeClock | null;
  /** The engine revision it has applied. */
  rev: number;
}

// ---- the feed ------------------------------------------------------------------------------

/** What a node sends Main on the feed. The first message must be `hello`, within a few seconds. */
export type FromNode =
  | { type: 'hello'; token: string; version: string; protocol: number; engine: number }
  /** Clock sync: the node's time when it asked. */
  | { type: 'clock'; t0: number }
  /** Its copy fell behind (a revision went missing): the whole state again. */
  | { type: 'resync' }
  | { type: 'health'; health: NodeHealth }
  /** A small picture of what a screen shows (while the dashboard is open): a JPEG, base64. */
  | { type: 'thumb'; screenId: string; jpeg: string };

export type NodeByeReason = 'unauthorized' | 'revoked' | 'version' | 'too-slow' | 'closing' | 'replaced';

/** What Main sends a node on the feed. */
export type ToNode =
  | {
      type: 'welcome';
      main: { id: string; name: string; version: string; addresses: string[] };
      node: { id: string; name: string };
      /** This run of Main's engine: a new one after a restart, whatever the revision numbers. */
      session: string;
    }
  | { type: 'engine'; message: EngineMessage }
  | { type: 'clock'; t0: number; server: number }
  /** The screens the node shows on its displays (all of them, replacing the last). */
  | { type: 'screens'; screens: NodeScreen[] }
  /** The media to have copies of, in order. */
  | { type: 'media'; wanted: MediaWant[] }
  /** Send a small picture of each screen this often (the dashboard is open), or stop (null). */
  | { type: 'thumbs'; everyMs: number | null }
  /** Show a display's number and name on it for a few seconds (null: on every display). */
  | { type: 'identify'; displayId: number | null; label: string }
  /** Reload an output window (its picture comes back from the show at once). */
  | { type: 'reload'; screenId: string }
  | { type: 'bye'; reason: NodeByeReason; mainVersion?: string };

/** What each kind of goodbye means, as the node's window says it. */
export const NODE_BYE_TEXT: Record<NodeByeReason, string> = {
  unauthorized: 'Main does not know this node any more. Pair it again.',
  revoked: 'This node was removed on Main. Pair it again to use it.',
  version: 'Main runs another version of Drashti.',
  'too-slow': 'The connection was too slow to keep up. Connecting again…',
  closing: 'Main is closing.',
  replaced: 'This node connected again from elsewhere.',
};

/** Main and a node on different versions refuse each other; this says why, on both sides. */
export function versionMismatch(mainVersion: string, nodeVersion: string): string {
  return `Main runs Drashti ${mainVersion} and this node runs ${nodeVersion}. Install the same version on both.`;
}

// ---- pairing (HTTPS on the node link) -------------------------------------------------------

/** The node's first step: its share of the key exchange, its name and version. */
export interface PairStart {
  /** The node's public value, hexadecimal. */
  x: string;
  name: string;
  version: string;
  protocol: number;
}

export type PairStartAnswer =
  | { ok: true; session: string; y: string; main: { id: string; name: string; version: string } }
  | { ok: false; message: string; mainVersion?: string };

/** The node's proof that it knows the code and saw Main's own certificate. */
export interface PairFinish {
  session: string;
  confirm: string;
}

export type PairFinishAnswer =
  | {
      ok: true;
      /** Main's proof in return; the node checks it before keeping anything. */
      confirm: string;
      token: string;
      node: { id: string; name: string };
    }
  | { ok: false; message: string };

// ---- the node's own window -----------------------------------------------------------------

/** How a node's link to Main stands. */
export type LinkState = 'connecting' | 'online' | 'offline' | 'refused' | 'unpaired';

export interface NodeDisplayView {
  id: number;
  label: string;
  pixelWidth: number;
  pixelHeight: number;
  refreshHz: number;
  /** The screen Main gave this display, and whether its output is showing. */
  screen: { name: string; groupName: string; showing: boolean } | null;
}

/** What a node's window shows. */
export interface NodeView {
  version: string;
  host: string;
  paired: {
    main: { name: string; addresses: string[]; port: number; fingerprint: string };
    node: { name: string };
    pairedAt: string;
  } | null;
  link: { state: LinkState; why: string | null; since: number };
  displays: NodeDisplayView[];
  media: NodeMediaStatus;
  clock: NodeClock | null;
  /** Showing the last picture kept from before: Main has not been reached since this node started. */
  fromSaved: boolean;
}

export type NodeViewResult = { ok: true; view: NodeView } | { ok: false; message: string };

// ---- Main's view of its nodes ---------------------------------------------------------------

/** A node as Main's windows list it (never its token). */
export interface NodeInfo {
  id: string;
  name: string;
  pairedAt: string;
  /** Connected now, with the feed open. */
  online: boolean;
  /** Since when it has been online or offline (ISO), or null when not seen since Main started. */
  since: string | null;
  lastSeenAt: string | null;
  /** The address it connects from (a number on the local network). */
  address: string | null;
  /** Its last report, kept while it is offline (null before its first). */
  health: NodeHealth | null;
  /** Round trip of the last clock answer Main saw it ask for (ms), as latency. */
  latencyMs: number | null;
  /** Refused for running another version (its version), or null. */
  versionRefused: string | null;
  /** Copy every picture and video in the library, not only the week's ("Get everything ready"). */
  everything: boolean;
  /** Since when (ISO) it has not caught up with the show (its last report older than Main's changes), or null. */
  behindSince: string | null;
}

/** Past this, a node's clock estimate could be more than two frames out (half the round trip). */
export const STEP_ROUND_TRIP_MS = 34;
/** A node that has not caught up with a change for this long is behind. */
export const BEHIND_AFTER_MS = 6000;

export type NodeWarningKind = 'offline' | 'media' | 'step' | 'version';

export interface NodeWarning {
  nodeId: string;
  kind: NodeWarningKind;
  text: string;
}

/**
 * What needs the operator's eye (the status bar and the dashboard): a node
 * offline, one behind on media (something on its screens not copied yet, or
 * copying stopped), one out of step (its clock not measured, or measured too
 * loosely, or not caught up with the show), or one refused for its version.
 */
export function nodeWarnings(nodes: readonly NodeInfo[], now: number): NodeWarning[] {
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return nodes.flatMap((n): NodeWarning[] => {
    const name = `“${n.name}”`;
    if (n.versionRefused)
      return [{ nodeId: n.id, kind: 'version', text: `${name} runs another version of Drashti` }];
    if (!n.online)
      return [
        { nodeId: n.id, kind: 'offline', text: `${name} offline${n.since ? ` since ${time(n.since)}` : ''}` },
      ];
    const out: NodeWarning[] = [];
    const media = n.health?.media;
    if (media && (media.missingNow > 0 || media.problem))
      out.push({
        nodeId: n.id,
        kind: 'media',
        text: media.problem
          ? `${name}: ${media.problem}`
          : `${name} is still copying ${media.missingNow === 1 ? 'a file' : `${media.missingNow} files`} on its screens`,
      });
    const clock = n.health?.clock;
    const behind = n.behindSince !== null && now - Date.parse(n.behindSince) > BEHIND_AFTER_MS;
    if (n.health && (!clock || clock.rttMs > STEP_ROUND_TRIP_MS || behind))
      out.push({ nodeId: n.id, kind: 'step', text: `${name} is out of step with the show` });
    return out;
  });
}

/** A pairing code Main offers for a node, as its window shows it. */
export interface NodePairingOffer {
  code: string;
  expiresAt: number;
  /** Where the node reaches Main: numbers, then the computer's local name. */
  addresses: string[];
  port: number;
}

export interface NodesStatus {
  /** The node link is listening (it listens while a node is paired or being paired). */
  state: 'off' | 'starting' | 'listening' | 'failed';
  port: number;
  message: string | null;
  /** This Main's name for its nodes, and its certificate's fingerprint (shown so it can be compared). */
  mainName: string;
  fingerprint: string | null;
  nodes: NodeInfo[];
  pairing: NodePairingOffer | null;
  /** Main itself: its version, and how its own outputs draw. */
  main: { version: string; outputs: NodeOutputStatus[] };
}

export type NodesResult = { ok: true; status: NodesStatus } | { ok: false; message: string };

/** A small picture of what one screen shows, for the dashboard (a JPEG data URL). */
export interface ScreenThumb {
  screenId: string;
  /** null for Main's own displays. */
  nodeId: string | null;
  url: string;
  at: number;
}

/** The fingerprint of a certificate, as people compare it: the first 16 hex digits in groups of four. */
export function shortFingerprint(hex: string): string {
  return (
    hex
      .replace(/[^0-9a-f]/giu, '')
      .slice(0, 16)
      .toUpperCase()
      .match(/.{1,4}/gu)
      ?.join(' ') ?? ''
  );
}
