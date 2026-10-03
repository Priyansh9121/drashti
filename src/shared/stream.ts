import type { Lang } from './model';

/*
 * Built-in streaming (PLAN.md 4.2). The Program is what the stream shows: an
 * offscreen page drawn with the same renderer as the outputs, in one of two
 * layouts. The bundled FFmpeg encodes it and sends it to YouTube Live over
 * RTMPS, and can record it to a file at the same time.
 *
 * A stream key never comes back to a window once it is typed: profiles say
 * only whether they have one.
 */

/**
 * What the stream shows. Camera: the camera full frame, with the live
 * slide's words as a lower third, and pictures and videos full frame when
 * they go live. Slides: the slides full screen, as the hall sees them.
 */
export type StreamLayout = 'camera' | 'slides';
export const STREAM_LAYOUTS = ['camera', 'slides'] as const satisfies readonly StreamLayout[];

export type StreamPresetId = 'good' | 'weak';
export const STREAM_PRESET_IDS = ['good', 'weak'] as const satisfies readonly StreamPresetId[];

export interface StreamPreset {
  id: StreamPresetId;
  label: string;
  /** What it suits, for the operator. */
  note: string;
  width: number;
  height: number;
  fps: number;
  videoKbps: number;
  audioKbps: number;
  /** A keyframe this often (YouTube asks for 2 s, and no more than 4). */
  keyframeSeconds: number;
  /** Audio: AAC at this rate, in stereo. */
  sampleRate: number;
}

/**
 * Two presets, checked against YouTube's live encoder settings (October
 * 2026): H.264 at a constant bitrate, a keyframe every 2 seconds, AAC at 128
 * kbps. YouTube lists 5 Mbps as the least for 1080p30 (14 recommended) and
 * 3 Mbps for 720p30 (8 recommended), so the weak preset uses 3, not less.
 */
export const STREAM_PRESETS: Readonly<Record<StreamPresetId, StreamPreset>> = {
  good: {
    id: 'good',
    label: 'Good internet',
    note: '1080p, 30 frames a second, 6 Mbps: needs an upload of at least 8 Mbps.',
    width: 1920,
    height: 1080,
    fps: 30,
    videoKbps: 6000,
    audioKbps: 128,
    keyframeSeconds: 2,
    sampleRate: 48_000,
  },
  weak: {
    id: 'weak',
    label: 'Weak internet',
    note: '720p, 30 frames a second, 3 Mbps: for an upload of 4 to 8 Mbps.',
    width: 1280,
    height: 720,
    fps: 30,
    videoKbps: 3000,
    audioKbps: 128,
    keyframeSeconds: 2,
    sampleRate: 48_000,
  },
};

/** YouTube Live's RTMPS ingest; the key is added after a slash. */
export const YOUTUBE_RTMPS_URL = 'rtmps://a.rtmps.youtube.com/live2';

/** A camera or sound input as the stream's page sees it (its id is only good in that page). */
export interface DeviceChoice {
  id: string;
  label: string;
}

/** A stream profile as windows see it: never the key, only whether there is one. */
export interface StreamProfile {
  id: string;
  name: string;
  /** Where to send it: YouTube's RTMPS address (the key goes after it). */
  url: string;
  preset: StreamPresetId;
  camera: DeviceChoice | null;
  sound: DeviceChoice | null;
  /** Holds the sound back this long, to line it up with the camera's picture. */
  soundDelayMs: number;
  /** Drashti's own sound (videos and audio cues) goes into the stream too. */
  mixOwnSound: boolean;
  hasKey: boolean;
}

/** What the operator sets on a profile (the key goes separately). */
export type StreamProfileInput = Omit<StreamProfile, 'id' | 'hasKey'>;

export const SOUND_DELAY_MAX_MS = 1000;

/** The camera, as the stream's page found it. */
export type CameraState =
  /** No camera chosen: the Camera layout shows black under the words. */
  | 'none'
  | 'starting'
  | 'on'
  /** The chosen camera is not connected. */
  | 'missing'
  /** The system refuses Drashti the camera (privacy settings). */
  | 'blocked'
  /** It is connected but cannot start (another app may be using it). */
  | 'failed';

export type SoundState = 'none' | 'starting' | 'on' | 'missing' | 'blocked' | 'failed';

/** What the stream's page reports about its inputs. */
export interface ProgramInputs {
  cameras: DeviceChoice[];
  microphones: DeviceChoice[];
  camera: CameraState;
  sound: SoundState;
  /** A sentence for the operator when the camera or sound cannot be used. */
  message: string | null;
}

/** What the stream's page needs to know about itself. */
export interface ProgramContext {
  layout: StreamLayout;
  /** The stream group's languages for a kirtan's words; null for all of them. */
  languages: Lang[] | null;
  /** The size the Program is drawn at (the preset's). */
  width: number;
  height: number;
  camera: DeviceChoice | null;
  sound: DeviceChoice | null;
  soundDelayMs: number;
  mixOwnSound: boolean;
  /** Frames are wanted by the encoder (live or recording). */
  capturing: boolean;
  /** The operator is watching the preview (a port for it comes separately). */
  preview: boolean;
}

/** How well the stream is reaching YouTube. */
export type StreamHealth = 'good' | 'struggling' | 'reconnecting' | 'off';

export type LiveState = 'off' | 'starting' | 'live' | 'reconnecting' | 'ending';
export type RecordingState = 'off' | 'starting' | 'recording';

export interface StreamStatus {
  /** The stream's page is drawing the Program. */
  programOn: boolean;
  layout: StreamLayout;
  profileId: string | null;
  inputs: ProgramInputs;
  live: {
    state: LiveState;
    /** When it went on air (ms since the epoch), for the time on air. */
    since: number | null;
    health: StreamHealth;
    /** What is being sent, from FFmpeg's progress. */
    bitrateKbps: number | null;
    fps: number | null;
    droppedFrames: number;
    reconnects: number;
    /** When the next try to reconnect is (ms since the epoch). */
    retryAt: number | null;
    /** A sentence for the operator: what is happening or went wrong (never the key). */
    message: string | null;
  };
  recording: {
    state: RecordingState;
    since: number | null;
    /** The file being written (its name only). */
    file: string | null;
    folder: string | null;
    bytes: number;
    /** Free space on the recording's disk, and about how long it can go on. */
    freeBytes: number | null;
    secondsLeft: number | null;
    message: string | null;
  };
  /** The encoder in use: e.g. "VideoToolbox (hardware)". */
  encoder: string | null;
  /** Saving stream keys works here (the system's secure storage). */
  keyStorage: { available: boolean; message: string | null };
  /** The bundled FFmpeg was found. */
  ffmpeg: { available: boolean; version: string | null };
  /**
   * Drashti stopped unexpectedly while on air or recording, more than 5
   * minutes before it started again: what was going on, offered to the
   * operator (sooner than that it goes again by itself).
   */
  resume: { live: boolean; recording: boolean; profileName: string; stoppedAt: number } | null;
  /** Goes up whenever a profile or a key changes: windows read the profiles again. */
  profilesVersion: number;
}

/** The Program's preview for the operator: a small JPEG, a few times a second. */
export const PREVIEW_WIDTH = 480;
export const PREVIEW_FPS = 5;

/** The stream's page, for windows that check where a message came from. */
export const STREAM_PAGE = 'stream';

/** The profiles, and the one in use. */
export interface StreamProfiles {
  profiles: StreamProfile[];
  activeId: string | null;
  keyStorage: { available: boolean; message: string | null };
}

export type StreamProfilesResult = { ok: true; profiles: StreamProfiles } | { ok: false; message: string };

export type StreamResult = { ok: true; status: StreamStatus } | { ok: false; message: string };
