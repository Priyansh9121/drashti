import type { LiveFit } from '../../../shared/engine/state';
import {
  type CameraAccess,
  inputNamed,
  type VideoInput,
  type VideoInputStatus,
} from '../../../shared/video-inputs';
import type { InputCaptureState, StopReason } from '../render/video-input-state';

/*
 * Video inputs in the operator window (Session 50): Add a Video Input…, Media's Video inputs and the notice when
 * one stops. What they say, and the choices that need no window, tested on their own.
 */

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The name a new input is offered: Input 1, or the first "Input N" no input has. */
export function nextInputName(inputs: readonly Pick<VideoInput, 'name'>[]): string {
  for (let n = 1; ; n++) {
    const name = `Input ${n}`;
    if (!inputs.some((i) => same(i.name, name))) return name;
  }
}

/** What is wrong with a name, or null: it needs one, and one no other input has. */
export function nameProblem(
  name: string,
  inputs: readonly Pick<VideoInput, 'id' | 'name'>[],
  editingId: string | null,
): string | null {
  if (name.trim() === '') return `Give it a name, such as “${nextInputName(inputs)}”.`;
  const other = inputs.find((i) => i.id !== editingId && same(i.name, name));
  return other ? `Another video input is called “${other.name}”.` : null;
}

/**
 * What Add a Video Input… shows for the computer's camera setting: still asking, why it asks (a Mac that has not
 * been asked: macOS asks only once, after Drashti has said why), refused (and where to change it), or the inputs.
 */
export type AccessView = 'checking' | 'ask' | 'refused' | 'list';

export function accessView(access: CameraAccess | null, platform: string): AccessView {
  if (access === null) return 'checking';
  if (access === 'denied' || access === 'restricted') return 'refused';
  return access === 'not-determined' && platform === 'darwin' ? 'ask' : 'list';
}

/**
 * Whether a small live picture may open an input: never before macOS has been asked (after Drashti said why), nor
 * where the camera is refused. Unknown (Drashti cannot tell) opens it, and an input that cannot open says so.
 */
export const mayOpenInputs = (access: CameraAccess | null): boolean =>
  access === 'granted' || access === 'unknown';

/** Why Drashti asks a Mac for the camera, said before macOS asks. */
export const CAMERA_WHY =
  'To show a camera or a capture input (a video mixer’s program, say) on the hall’s screens and the stream, macOS has to let Drashti use the camera. Drashti only ever shows the input you choose, never its sound, and nothing goes up until you click it in Media. Press Continue, then Allow when macOS asks.';

/** The settings page's button. */
export const settingsLabel = (platform: string): string =>
  platform === 'win32' ? 'Open Settings' : 'Open System Settings';

/** The camera refused: what it means, and where to turn it on. */
export function refusedWords(access: CameraAccess, platform: string): { title: string; text: string } {
  if (platform === 'win32')
    return {
      title: 'Windows’ camera privacy setting is off',
      text: 'Windows does not let apps on this computer use the camera, so Drashti cannot see its cameras or capture inputs. Press Open Settings, turn on Camera access and Let desktop apps access your camera, then look again.',
    };
  if (access === 'restricted')
    return {
      title: 'Drashti may not use the camera',
      text: 'This Mac does not let apps use the camera: a setting only its administrator can change.',
    };
  return {
    title: 'Drashti may not use the camera',
    text: 'macOS does not let Drashti use the camera, so it cannot see this computer’s cameras or capture inputs. Press Open System Settings, turn Drashti on under Camera, then look again. If it still cannot see them, quit Drashti and open it again.',
  };
}

/** The main process's word that an input stopped, while that input is still the one up. */
export function stoppedInput(
  status: VideoInputStatus,
  upInputId: string | null,
): { inputId: string; name: string } | null {
  const stopped = status.stopped;
  return stopped !== null && stopped.inputId === upInputId ? stopped : null;
}

/** The stopped notice's words: its last picture stays, and why it may have stopped. */
export function stoppedWords(access: CameraAccess, platform: string): string {
  // An input that never started has no last picture (Session 50, section 1's review): said so.
  const kept = 'The screens keep its last picture, if it showed one.';
  if (access === 'denied' || access === 'restricted')
    return platform === 'win32'
      ? `Windows’ camera privacy setting is off. ${kept} Press Open Settings and turn on Camera access and Let desktop apps access your camera, or clear it.`
      : `macOS no longer lets Drashti use the camera. ${kept} Press Open System Settings and turn Drashti on under Camera, or clear it.`;
  return `${kept} Its cable may be out, or another app may be using it: it comes back by itself when the input returns.`;
}

/** How it sits on the screen, in a row's words and the Fit choice's. */
export const FIT_WORDS: Record<LiveFit, { choice: string; row: string }> = {
  fit: { choice: 'Fit inside, with black around it', row: 'fitted inside' },
  fill: { choice: 'Fill the screen', row: 'filling the screen' },
};

/**
 * This computer's input of a name (Session 51: the one a playlist item or a slide's background cue names): the input,
 * or null when the list has none of that name; 'unread' while the list has not been read yet (the window has just
 * opened), which counts as there: nothing says "not on this computer" for that moment.
 */
export function inputOfName(
  inputs: readonly VideoInput[] | null,
  name: string,
): VideoInput | 'unread' | null {
  return inputs === null ? 'unread' : inputNamed(inputs, name);
}

/** A row's second line: a video input, and how it sits, or why it has no picture now. */
export function inputRowNote(
  capture: { state: InputCaptureState; reason: StopReason | null } | null,
  fit: LiveFit,
): string {
  if (capture?.state !== 'stopped') return `Video input · ${FIT_WORDS[fit].row}`;
  if (capture.reason === 'missing') return 'Video input · not connected';
  return capture.reason === 'refused'
    ? 'Video input · the camera is refused'
    : 'Video input · no picture now';
}

/** No sound from it in the hall; the stream's sound stays its own sound input (which a mixer's USB output can be). */
export const NO_SOUND =
  'Drashti shows its picture only, never its sound: the hall’s sound comes through the mixer, as now. The stream’s sound stays its own sound input, and a mixer’s USB output can be chosen there too.';

/** A mixer's program that is Drashti's own picture makes a picture inside itself. */
export const NOT_ITS_OWN_PICTURE =
  'If the mixer’s program shows Drashti’s own picture, showing it here makes a picture inside itself, over and over: put it up while the mixer shows a camera.';

/**
 * Changing one (Session 53): what a new name does. This computer's playlist items and slides that name the input
 * take the new name (Session 52, main/db/input-renames.ts), but another computer finds its own input by the name,
 * so the other computer's needs the same one or there they say Not on this computer. "The other computer’s" since
 * Session 54: "the spare computer’s" read oddly when renaming on the spare, as both run as Main.
 */
export const RENAMING =
  'Renaming it takes this computer’s playlist items and slides that use it to the new name. The other computer’s input needs the same new name.';
