/** How a screen's canvas is scaled into its output window. */
export type ScalingMode = 'fit' | 'fill' | 'stretch';
export const SCALING_MODES = ['fit', 'fill', 'stretch'] as const satisfies readonly ScalingMode[];

export type ScreenRole = 'audience' | 'stage' | 'stream' | 'keyfill' | 'other';
/** The roles a group can be given in Screens (the stream's group is made by the stream). */
export const GROUP_ROLES = ['audience', 'stage', 'keyfill'] as const satisfies readonly ScreenRole[];

/** In a key and fill group, which a screen is: the picture, or its key for a video switcher. */
export type ScreenFeed = 'fill' | 'key';

/**
 * Enough about an OS display to find it again after a restart. Display ids
 * are not guaranteed stable, so matching also uses the label, pixel size
 * and position.
 */
export interface DisplayKey {
  id: number;
  label: string;
  pixelWidth: number;
  pixelHeight: number;
  x: number;
  y: number;
  internal: boolean;
}

/** A display as the OS reports it right now. Drashti never changes display modes. */
export interface DisplayInfo {
  id: number;
  label: string;
  /** Position and size in device-independent pixels (what windows use). */
  bounds: { x: number; y: number; width: number; height: number };
  /** The part not taken by the menu bar, Dock or taskbar. */
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  /** Physical resolution. */
  pixelWidth: number;
  pixelHeight: number;
  refreshHz: number;
  rotation: number;
  internal: boolean;
  primary: boolean;
  key: DisplayKey;
}

export interface ScreenConfig {
  id: string;
  groupId: string;
  name: string;
  displayKey: DisplayKey | null;
  canvasWidth: number;
  canvasHeight: number;
  scaling: ScalingMode;
  enabled: boolean;
  /** In a key and fill group: the fill or the key (null in other groups). */
  feed: ScreenFeed | null;
  /** The node whose display it is on (Session 13), or null for this computer's own displays. */
  nodeId: string | null;
}

/** A screen group. What its screens show (layers, languages, slide style) is set in the Looks (shared/looks.ts). */
export interface ScreenGroupConfig {
  id: string;
  name: string;
  role: ScreenRole;
  screens: ScreenConfig[];
}

export type ScreenState =
  /** An output window is open on its display. */
  | 'showing'
  /** Assigned to a display that is not connected; the window opens when it is. */
  | 'missing-display'
  /** No display assigned. */
  | 'unassigned'
  /** Turned off by the operator. */
  | 'disabled'
  /** On a node that is not connected now (its screens show the last picture, if it is on). */
  | 'node-offline'
  /**
   * Its window kept crashing and the watchdog gave up on it (Session 23): black, tried again by
   * itself after 2 minutes and then every 10, or at once with Try again in Screens.
   */
  | 'stopped';

export interface ScreenStatus {
  screenId: string;
  state: ScreenState;
  displayId: number | null;
}

/** A node and the displays it last reported, as Screens lists them under it (Session 13). */
export interface NodeDisplays {
  id: string;
  name: string;
  online: boolean;
  displays: DisplayInfo[];
}

export interface ScreensSnapshot {
  displays: DisplayInfo[];
  groups: ScreenGroupConfig[];
  status: ScreenStatus[];
  /** Paired nodes, with their displays. */
  nodes: NodeDisplays[];
}

export type ScreensResult =
  | { ok: true; snapshot: ScreensSnapshot }
  /**
   * `confirm` means nothing was changed yet: the operator must agree first,
   * then repeat the request with the matching option (for example coverOperator).
   */
  | { ok: false; message: string; confirm?: 'covers-operator' };

/** Options for requests that can cover the operator window. */
export interface CoverOptions {
  /** The operator agreed that an output may cover the display the controls are on. */
  coverOperator?: boolean;
}

/** Changes the operator can make to a screen. */
export interface ScreenPatch {
  name?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  scaling?: ScalingMode;
  enabled?: boolean;
  /** In a key and fill group: the fill or the key. */
  feed?: ScreenFeed;
}

/** What an output window needs to know about itself. */
export interface OutputContext {
  screenId: string;
  screenName: string;
  /** Its group: what it shows comes from the group's settings in the live Look (engine state). */
  groupId: string;
  groupName: string;
  /** What the screen shows: the audience picture, the performers' stage view, or a key and fill pair's half. */
  role: ScreenRole;
  /** In a key and fill group: the fill or the key; null otherwise. */
  feed: ScreenFeed | null;
  /** Until when (ms since the epoch) it shows the setup wizard's test slide; null for none. */
  testCardUntil: number | null;
  canvasWidth: number;
  canvasHeight: number;
  scaling: ScalingMode;
  display: { pixelWidth: number; pixelHeight: number; refreshHz: number; scaleFactor: number } | null;
  /**
   * What to add to this computer's clock to get the engine's (Session 13):
   * 0 on Main, the measured offset on a node.
   */
  clockOffsetMs?: number;
}

/** What an output window says about how it draws (every few seconds). */
export interface OutputReport {
  /** Frames that came more than one and a half frame times late, in the last minute. */
  droppedFrames: number;
  /** The engine revision it last painted. */
  paintedRev: number;
}

/** Common canvas sizes offered in the UI; any size is allowed. */
export const CANVAS_PRESETS: readonly { label: string; width: number; height: number }[] = [
  { label: '1920 × 1080 (HD)', width: 1920, height: 1080 },
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  { label: '1024 × 768 (4:3)', width: 1024, height: 768 },
];
