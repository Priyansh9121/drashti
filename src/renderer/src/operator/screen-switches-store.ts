import { create } from 'zustand';
import {
  ALL_ON,
  asksFirst,
  openUnder,
  type ScreenSwitch,
  type ScreenSwitches,
} from '../../../shared/screen-switches';
import { useEngine } from '../engine/engine-store';
import { useScreens } from '../screens/screens-store';

/*
 * Audience and Stage (Session 50), as the operator window keeps them: which are on, as the main process says,
 * and the one waiting for its question. Off closes this computer's screens of that kind, so their displays go
 * back to the computer; on opens them again where they were. Turning one off asks first while its screens show
 * something (the top bar's switch, Mod+1 and Mod+2), and in the window's first moments, before it has the
 * screens (Session 51, S2-4); on never asks. Simple Mode only turns them on. Both are on at every start.
 *
 * The question is this window's own, and the main process is told as it opens and goes (Session 51, S2-2): an
 * output over the controls then asks the same, large, in its middle, Enter turning it off and Esc cancelling.
 */

interface SwitchesView {
  switches: ScreenSwitches;
  /** The main process has said (until then both count as on, as every start has them). */
  known: boolean;
  /** Turning this one off waits for the operator's answer, or null. */
  asking: ScreenSwitch | null;
  /** While it asks: an output covers these controls and asks the same in its middle. */
  covered: boolean;
}

export const useScreenSwitches = create<SwitchesView>(() => ({
  switches: { ...ALL_ON },
  known: false,
  asking: null,
  covered: false,
}));

let connected = false;
/** A question on its way: the main process is told before it opens, so it opens once, keyboard and all. */
let opening = false;

/** Tell the main process the question that is open now (null: none); whether an output over the controls asks too. */
async function tellAsking(which: ScreenSwitch | null): Promise<boolean> {
  try {
    return (await window.drashti.screenSwitches.asking(which)).covered;
  } catch (error: unknown) {
    // The window asks all the same: only the output over the controls does not.
    console.warn('The main process could not be told of the question', error);
    return false;
  }
}

/** Learn them from the main process and follow each change (once per page). */
export function connectScreenSwitches(): void {
  if (connected) return;
  connected = true;
  window.drashti.screenSwitches.onChanged((switches) => {
    useScreenSwitches.setState({ switches, known: true });
  });
  // An output over the controls started or stopped asking too (the uncover key, say): only while it asks here.
  window.drashti.screenSwitches.onCovered((covered) => {
    if (useScreenSwitches.getState().asking) useScreenSwitches.setState({ covered });
  });
  // A question this window's last page left on an output (it loaded again) is taken off.
  void tellAsking(null);
  void window.drashti.screenSwitches.get().then(
    (switches) => {
      useScreenSwitches.setState({ switches, known: true });
    },
    (error: unknown) => {
      // Both on is what every start has: the window shows that until the main process says otherwise.
      console.warn('Audience and Stage could not be asked: showing both on', error);
    },
  );
}

/** Turn one off or on now. The problem in words, or null when it worked. */
export async function turnSwitch(which: ScreenSwitch, on: boolean): Promise<string | null> {
  const result = await window.drashti.screenSwitches.turn(which, on);
  if (!result.ok) return result.message;
  useScreenSwitches.setState({ switches: result.switches, known: true });
  return null;
}

/**
 * Would turning it off ask first now? While its screens on this computer are open and show something; and before
 * this window knows which are on, or which screens are open (its first moments: the safe side, Session 51, S2-4).
 */
export function switchAsksFirst(which: ScreenSwitch): boolean {
  const snapshot = useScreens.getState().snapshot;
  const open = snapshot && useScreenSwitches.getState().known ? openUnder(snapshot, which) : null;
  return asksFirst(which, open, useEngine.getState().state);
}

/**
 * Pro Mode's switch, key or menu: on at once; off at once while its screens show nothing, else asked first.
 * Nothing while a question is open, or on its way. The problem in words, or null.
 */
export async function toggleSwitch(which: ScreenSwitch): Promise<string | null> {
  const { switches, asking } = useScreenSwitches.getState();
  if (asking || opening) return null;
  if (!switches[which]) return turnSwitch(which, true);
  if (!switchAsksFirst(which)) return turnSwitch(which, false);
  opening = true;
  try {
    const covered = await tellAsking(which);
    useScreenSwitches.setState({ asking: which, covered });
  } finally {
    opening = false;
  }
  return null;
}

/** The question answered Turn off. */
export function confirmAsk(): Promise<string | null> {
  const which = useScreenSwitches.getState().asking;
  useScreenSwitches.setState({ asking: null, covered: false });
  if (!which) return Promise.resolve(null);
  void tellAsking(null);
  return turnSwitch(which, false);
}

/** The question answered Cancel (or closed): nothing changes. */
export function cancelAsk(): void {
  const { asking } = useScreenSwitches.getState();
  useScreenSwitches.setState({ asking: null, covered: false });
  if (asking) void tellAsking(null);
}

/**
 * Answered on the output over the controls, as that output had the keyboard (Session 51, S2-2): Enter (true)
 * turns it off, Esc (false) cancels, as this window's own buttons do. An answer when nothing is asked does nothing.
 */
export function answerFromOutput(yes: boolean): Promise<string | null> {
  if (!useScreenSwitches.getState().asking) return Promise.resolve(null);
  if (yes) return confirmAsk();
  cancelAsk();
  return Promise.resolve(null);
}

/** Simple Mode's key and the status bar's Turn on: on if it is off, never off. */
export function turnOnIfOff(which: ScreenSwitch): Promise<string | null> {
  return useScreenSwitches.getState().switches[which] ? Promise.resolve(null) : turnSwitch(which, true);
}
