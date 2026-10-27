import type { PendingScreens } from './keep-screens';
import type { ScreenSwitch, ScreenSwitches } from './screen-switches';
import type { DisplayInfo, NodeDisplays, ScreenGroupConfig, ScreenStatus } from './screens';

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
