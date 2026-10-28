import type { PendingScreens } from './keep-screens';
import { type CameraAccess, VIDEO_INPUT_DEVICE_MAX, type VideoInput } from './video-inputs';
import type { ScreenSwitch, ScreenSwitches } from './screen-switches';
import type { DisplayInfo, NodeDisplays, ScreenGroupConfig, ScreenStatus } from './screens';
import type { MidiLearnable, MidiSeen, MidiSettings } from './midi';

/*
 * The phone as a full Drashti (Session 54, the owner's item 3: "just like a mirror … full of drashti connection"):
 * what a Remote reads of the Drashti computer's own things to set them up as the operator window does, starting
 * with its screens (its displays as it sees them, the screen groups and each screen's state) and Audience and
 * Stage. Each acts on the computer's own things, chosen by their ids, never by a file, a path or an address; the
 * main process does each as the window's own request does (the same service, the same checks, Simple Mode's
 * refusals). Covering the controls (an output on the display the operator window is on) is the operator's to
 * agree to, at the computer: a phone asks, and only the computer's own box says yes (main/network/desktop-consent.ts).
 */

/**
 * How a phone's ask to cover the controls stands, for a minute after: the computer's box is up ('waiting'), it
 * agreed (the change was made), it did not ('refused'), or it agreed but the change could not be made then
 * ('failed': the screens had changed meanwhile).
 */
export type DesktopAsk = 'waiting' | 'agreed' | 'refused' | 'failed';

/** A phone's ask as it reads it with the screens: how it stands, and the computer's words for it. */
export interface DesktopAskView {
  state: DesktopAsk;
  message: string;
}

/** The screens as a Remote reads them (GET /api/v1/screens): enough to set them up as Screens does. */
export interface RemoteScreens {
  /** The computer's connected displays, as it sees them (Drashti never changes their modes). */
  displays: DisplayInfo[];
  /** The display the Drashti controls are on: an output there covers them (null: none can, as windowed outputs). */
  controlsDisplayId: number | null;
  /** The screen groups and their screens, a node's too; the stream's group is YouTube's, and stays on the computer. */
  groups: ScreenGroupConfig[];
  status: ScreenStatus[];
  /** The paired nodes and their displays, so a node's screen is named with it (set up on the computer). */
  nodes: NodeDisplays[];
  /** Audience and Stage: which are on. */
  switches: ScreenSwitches;
  /** Whether turning each off asks first now (its screens are open and show something). */
  asksFirst: ScreenSwitches;
  /** Keep these screens?: the change waiting for Keep or Go back (its deadline on the computer's clock), or null. */
  pending: PendingScreens | null;
  /** This phone's ask to cover the controls, while the computer has it or for a minute after its answer. */
  asked: DesktopAskView | null;
}

/** What a phone is told as it asks the computer: nothing changes until the operator agrees there. */
export const ASKED_AT_COMPUTER =
  'The Drashti controls are on that display, so the Drashti computer must agree first: it is asking there now.';

/** Another phone's question is up on the computer: one at a time. */
export const COMPUTER_BUSY =
  'The Drashti computer is already asking something: wait until it is answered, then try again.';

/** Told no a moment ago: a phone waits a little before it asks again, so no phone can keep the box up. */
export const ASK_AGAIN_SOON = 'The Drashti computer said no just now: wait a moment before asking again.';

/** How each ask ended, as the phone says it. */
export const ASK_WORDS: Readonly<Record<Exclude<DesktopAsk, 'failed'>, string>> = {
  waiting: 'Waiting for the Drashti computer to agree…',
  agreed: 'The Drashti computer agreed.',
  refused: 'The Drashti computer did not agree, so nothing changed.',
};

/**
 * What turning a switch off asks first on a phone, in the window's words (shared/screen-switches.ts), and the
 * main process's answer when a phone sends Off without having asked (409: nothing changed).
 */
export const SWITCH_ASKS_FIRST = 'Turning this off asks first: answer the question on the phone.';

/** Which switch a request names in its path (`/api/v1/switches/audience`). */
export const SWITCH_PARAM = /^(?:audience|stage)$/u;

/** Both switches' answer to one question, Audience's and Stage's. */
export const bothSwitches = (of: (which: ScreenSwitch) => boolean): ScreenSwitches => ({
  audience: of('audience'),
  stage: of('stage'),
});

/**
 * The computer's video inputs as a Remote reads them (GET /api/v1/video-inputs, Session 54): Media's named inputs,
 * to put one up, name another or change one, choosing among the cameras the computer lists, never naming its own.
 */
export interface RemoteInputs {
  inputs: VideoInput[];
  /** Whether Drashti may use the computer's cameras (a Mac's Camera setting, Windows' camera privacy setting). */
  access: CameraAccess;
  /** The computer's cameras and capture inputs by name, as its operator window last saw them; null: not yet. */
  cameras: string[] | null;
}

/**
 * Another app's window on the computer, as a Remote reads it (Session 54): its id in the list just made, and its
 * name. Never a picture of it: a phone chooses by name, and what is on the computer's screen stays there.
 */
export interface RemoteWindow {
  id: string;
  name: string;
}

export type RemoteWindows =
  { ok: true; windows: RemoteWindow[] } | { ok: false; reason: 'permission' | 'unlisted'; message: string };

/** The most camera names a computer's window reports, each as long as a device name is kept. */
export const CAMERA_NAMES_MAX = 64;

/** The camera names an operator window reports, as checked (a page is never trusted): names only, each once. */
export function cameraNamesIn(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const names: string[] = [];
  for (const n of raw)
    if (typeof n === 'string' && n.trim() !== '' && n.length <= VIDEO_INPUT_DEVICE_MAX && !names.includes(n))
      names.push(n);
  return names.slice(0, CAMERA_NAMES_MAX);
}

/** A phone choosing a camera the computer has not listed: never one of its own naming. */
export const NOT_A_LISTED_CAMERA =
  'The Drashti computer does not list that camera now: choose one it lists, or plug it in there and look again.';

/** Before the computer's window has listed its cameras (it does as it starts, once Drashti may use them). */
export const CAMERAS_NOT_LISTED =
  'The Drashti computer has not listed its cameras yet: on it, open Library, then Media, then Add a Video Input… once.';

/** macOS's or Windows' camera setting is answered at the computer, never from a phone. */
export const CAMERA_AT_COMPUTER =
  'Drashti may not use the cameras on its computer yet. On the Drashti computer: Library, Media, Add a Video Input… asks for the camera, or says where to turn it on.';

/** macOS's Screen Recording is answered at the computer, never from a phone. */
export const SCREEN_RECORDING_AT_COMPUTER =
  'macOS has not let Drashti see other apps’ windows. On the Drashti computer: Library, Media, Show a Window… says how to turn on Screen Recording for Drashti.';

/**
 * MIDI as a Remote reads it (GET /api/v1/midi, Session 54): the controller's settings, the computer's MIDI devices as
 * its operator window sees them (null until it has said), and the action a phone asked it to learn, waiting for a
 * press on the controller at the computer.
 */
export interface RemoteMidi {
  settings: MidiSettings;
  seen: MidiSeen | null;
  learning: MidiLearnable | null;
}

/** Before the computer's window has listed its MIDI devices. */
export const MIDI_NOT_LISTED =
  'The Drashti computer has not listed its MIDI devices yet: it lists them a moment after this opens, while its window is open.';

/** A phone choosing a MIDI device the computer does not list: never one of its own naming. */
export const NOT_A_LISTED_MIDI_DEVICE =
  'The Drashti computer does not list that MIDI device now: plug it in there, then choose it again.';
