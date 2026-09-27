/** How a screen's canvas is scaled into its output window. */
export type ScalingMode = 'fit' | 'fill' | 'stretch';
export const SCALING_MODES = ['fit', 'fill', 'stretch'] as const satisfies readonly ScalingMode[];

export type ScreenRole = 'audience' | 'stage' | 'stream' | 'other';

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
}

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
  | 'disabled';

export interface ScreenStatus {
  screenId: string;
  state: ScreenState;
  displayId: number | null;
}

export interface ScreensSnapshot {
  displays: DisplayInfo[];
  groups: ScreenGroupConfig[];
  status: ScreenStatus[];
}

export type ScreensResult = { ok: true; snapshot: ScreensSnapshot } | { ok: false; message: string };

/** Changes the operator can make to a screen. */
export interface ScreenPatch {
  name?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  scaling?: ScalingMode;
  enabled?: boolean;
}

/** What an output window needs to know about itself. */
export interface OutputContext {
  screenId: string;
  screenName: string;
  groupName: string;
  canvasWidth: number;
  canvasHeight: number;
  scaling: ScalingMode;
  display: { pixelWidth: number; pixelHeight: number; refreshHz: number; scaleFactor: number } | null;
}

/** Common canvas sizes offered in the UI; any size is allowed. */
export const CANVAS_PRESETS: readonly { label: string; width: number; height: number }[] = [
  { label: '1920 × 1080 (HD)', width: 1920, height: 1080 },
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  { label: '1024 × 768 (4:3)', width: 1024, height: 768 },
];
