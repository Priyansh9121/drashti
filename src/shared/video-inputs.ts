import type { LiveFit } from './engine/state';

/*
 * Video inputs (Session 50): this computer's cameras and capture inputs (a capture card, a video mixer's program
 * out through its USB output), each named by the operator ("Input 1") and kept in Pro Mode's Media under Video
 * inputs, on this computer. One click puts one up as a live background (shared/engine/state.ts InputBackground).
 */

/** A video input as Media lists it. */
export interface VideoInput {
  id: string;
  /** The operator's name for it ("Input 1"). */
  name: string;
  /** The device's name as this computer gives it (its label), by which every page finds it. */
  device: string;
  /** Fitted inside with black around it, or filling the screen, as a video can be. */
  fit: LiveFit;
}

export interface VideoInputsView {
  inputs: VideoInput[];
}

export type VideoInputResult = { ok: true; view: VideoInputsView } | { ok: false; message: string };

/** A new video input, or a change to one. */
export interface VideoInputFields {
  name: string;
  device: string;
  fit: LiveFit;
}

/**
 * Whether Drashti may use this computer's cameras: on a Mac, as System Settings' Camera says (asked the first
 * time); on Windows, whether the camera privacy setting lets desktop apps use it ('denied' when it is off).
 */
export type CameraAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

/** A page drawing a video input says how it stands: playing, or stopped (unplugged, or taken by another app). */
export interface VideoInputReport {
  inputId: string;
  state: 'playing' | 'stopped';
}

/** How the video input on the screens stands, for the operator's notice. */
export interface VideoInputStatus {
  /** The input up now has stopped on a screen (its last picture stays), or null. */
  stopped: { inputId: string; name: string } | null;
  access: CameraAccess;
}
