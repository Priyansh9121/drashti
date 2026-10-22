import type { LiveFit } from './engine/state';
import { nfc } from './nfc';

/*
 * Video inputs (Session 50): this computer's cameras and capture inputs (a capture card, a video mixer's program
 * out through its USB output), each named by the operator ("Input 1") and kept in Pro Mode's Media under Video
 * inputs, on this computer. One click puts one up as a live background (shared/engine/state.ts InputBackground).
 * A playlist item or a slide's background cue can name one too (Session 51: inputNamed).
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

/**
 * A page drawing a video input says how it stands: playing, or stopped (unplugged, or taken by another app).
 * 'missing' (Session 50, for restart recovery): the page found no camera of that device's name among this
 * computer's cameras (it can tell only once it may see their names); otherwise it is 'stopped'. Right after a
 * restart that takes the input off and the recovery notice names it; at any other time it counts as stopped.
 */
export interface VideoInputReport {
  inputId: string;
  state: 'playing' | 'stopped' | 'missing';
  /**
   * Said of the picture-in-picture box's picture of it (Session 51), not the background's: heard only right after a
   * restart, when one not there takes the box off and the recovery notice names it. The stopped notice stays the
   * background's.
   */
  box?: boolean;
}

/** How the video input on the screens stands, for the operator's notice. */
export interface VideoInputStatus {
  /** The input up now has stopped on a screen (its last picture stays), or null. */
  stopped: { inputId: string; name: string } | null;
  access: CameraAccess;
}

/** The longest name an operator gives a video input, and the longest device name kept (Session 50). */
export const VIDEO_INPUT_NAME_MAX = 60;
export const VIDEO_INPUT_DEVICE_MAX = 300;
/** The most video inputs one computer keeps. */
export const VIDEO_INPUTS_MAX = 20;

/**
 * How long a video input takes to come on (Session 50): it dissolves in from the background before, over 1 s, as
 * the mandir's setup does, the way a video background dissolves in with its slide; never a cut, never through black.
 */
export const INPUT_FADE_MS = 1000;

/**
 * Two video inputs' names as the operator reads them: any letter case, any Unicode form. Media keeps each
 * computer's names unique so (Session 50), and a playlist item or a slide's cue finds its input so (Session 51).
 */
export const sameInputName = (a: string, b: string): boolean => nfc(a).toLowerCase() === nfc(b).toLowerCase();

/**
 * The input of this computer's list that a playlist item or a slide's background cue names (Session 51), or null.
 *
 * An input belongs to one computer while the library travels (a backup put back on another computer, a spare
 * computer taking over), so the library keeps the input's own name ("Input 1") and each computer finds its own
 * input of that name. By the name alone, never by the id it had on the computer it was chosen on: what the
 * playlist or the slide says is what goes up, the same on every computer, and an input renamed in Media is never
 * put up under the name it had (the item or the slide says plainly that no input of that name is on this
 * computer, and Next goes on past it).
 */
export function inputNamed(inputs: readonly VideoInput[], name: string): VideoInput | null {
  return inputs.find((i) => sameInputName(i.name, name)) ?? null;
}
