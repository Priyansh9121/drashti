import type { ClockStyle } from './format';
import type { Lang } from './model';
import type { HallPicture } from './stage-layouts';

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
  /**
   * The display's own identity (Session 55, main/outputs/display-ids.ts): its maker, model and serial number as
   * its EDID gives them, the same through unplugging, another port and a restart, and different for two displays
   * of one model. Null when it gives no serial number that tells it apart, or before it has been read; left out
   * in a key saved before Session 55.
   */
  hardwareId?: string | null;
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
  /**
   * The languages its screens show of a kirtan's slides, in order (null: every language), as Screens sets them
   * (Session 55, Part 12: no longer in Looks). In the screens' snapshot; left out where a group is read alone.
   */
  languages?: Lang[] | null;
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
  /**
   * Its switch, Audience or Stage, is off (Session 50): its window is closed and its display is the computer's
   * until the switch is on again, when it opens there again. On purpose, never a failure; not saved.
   */
  | 'switched-off'
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
  /** What each of this computer's connected displays does now (Session 55), in the order of `displays`. */
  uses: DisplayUse[];
}

/**
 * A display's job (Session 55): the audience picture, the stage, or nothing. A display plugged in is given one
 * by itself (main/outputs/auto-screens.ts); Screens and Set Up Screens… change it, one click each.
 */
export type DisplayJob = 'audience' | 'stage' | 'none';
export const DISPLAY_JOBS = ['audience', 'stage', 'none'] as const satisfies readonly DisplayJob[];

/** A display's job, as Screens, Set Up Screens… and a phone offer it. */
export const DISPLAY_JOB_WORDS: Readonly<Record<DisplayJob, string>> = {
  audience: 'Audience',
  stage: 'Stage',
  none: 'Not used',
};

/**
 * What one of this computer's connected displays does (Session 55): the screen given it, on or off, and its
 * group's role; none when no screen has it. A key and fill pair's screen sends the audience picture.
 */
export interface DisplayUse {
  displayId: number;
  screenId: string | null;
  groupId: string | null;
  role: ScreenRole | null;
}

/**
 * What the screens did by themselves (Session 55), said in the operator window in one line: displays plugged in
 * given their jobs (with Change…, which opens Screens at them), or once how to extend when the computer mirrors.
 */
export interface ScreensSaid {
  /** A new one each time it says something. */
  id: number;
  kind: 'set' | 'mirroring';
  text: string;
  /** The displays it is about, in order (Change… opens Screens at the first); none for mirroring. */
  displayIds: number[];
}

/** The job a display's use stands for: a stage group's is the stage, any other group's the audience picture. */
export function jobOf(use: Pick<DisplayUse, 'role'> | undefined): DisplayJob {
  if (use?.role === undefined || use.role === null) return 'none';
  return use.role === 'stage' ? 'stage' : 'audience';
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
  canvasWidth: number;
  canvasHeight: number;
  scaling: ScalingMode;
  display: { pixelWidth: number; pixelHeight: number; refreshHz: number; scaleFactor: number } | null;
  /**
   * What to add to this computer's clock to get the engine's (Session 13):
   * 0 on Main, the measured offset on a node.
   */
  clockOffsetMs?: number;
  /** How Main writes the time (Sessions 31–36, I18N-8): a node in another time zone shows Main's. */
  clockStyle?: ClockStyle;
  /**
   * The hall's picture, for a stage layout's audience picture box (Session 50, shared/stage-layouts.ts): the
   * first audience group, and its screen's canvas (on a node, the node's own first); null with none.
   */
  hall?: HallPicture | null;
}

/** What an output window says about how it draws (every few seconds). */
export interface OutputReport {
  /** Its page's first painted frame: its revision, and when (this computer's clock), for the start's phase lines. */
  firstPaint?: { rev: number; wallAt: number } | null;
  /** Frames that came more than one and a half frame times late, in the last minute. */
  droppedFrames: number;
  /** The engine revision it last painted. */
  paintedRev: number;
  /** Still warming up its GPU, unseen (Session 27): running, not yet drawing the show. */
  warming?: boolean;
  /** Fonts the words it draws name that this computer does not have (Sessions 31–36, I18N-1). */
  missingFonts?: string[];
}

/** A report's missing fonts as checked: names only, a few, each short (a page is never trusted). */
export function missingFontsIn(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '' && n.length <= 200)
    .slice(0, 20);
}

/** Each screen's state as Screens says it, and a phone setting the screens up (Session 54). */
export const SCREEN_STATE_WORDS: Readonly<Record<ScreenState, string>> = {
  showing: 'Showing',
  'missing-display': 'Display not connected',
  unassigned: 'No display',
  disabled: 'Off',
  // Audience or Stage is off (Session 50): on purpose, never a failure.
  'switched-off': 'Switched off',
  'node-offline': 'Node offline',
  stopped: 'Stopped',
};

/** What a group shows, as Screens' Shows offers it. */
export const GROUP_ROLE_WORDS: Readonly<Record<(typeof GROUP_ROLES)[number], string>> = {
  audience: 'The audience picture',
  stage: 'The stage view (performers)',
  keyfill: 'Key and fill (for a video switcher)',
};

/** How a screen's canvas is scaled into it, as Screens' Scaling offers it. */
export const SCALING_WORDS: Readonly<Record<ScalingMode, string>> = {
  fit: 'Fit (letterbox)',
  fill: 'Fill (crop)',
  stretch: 'Stretch',
};

/** Common canvas sizes offered in the UI; any size is allowed. */
export const CANVAS_PRESETS: readonly { label: string; width: number; height: number }[] = [
  { label: '1920 × 1080 (HD)', width: 1920, height: 1080 },
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  { label: '1024 × 768 (4:3)', width: 1024, height: 768 },
];
