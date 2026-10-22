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
 */

interface SwitchesView {
  switches: ScreenSwitches;
  /** The main process has said (until then both count as on, as every start has them). */
  known: boolean;
  /** Turning this one off waits for the operator's answer, or null. */
  asking: ScreenSwitch | null;
}

export const useScreenSwitches = create<SwitchesView>(() => ({
  switches: { ...ALL_ON },
  known: false,
  asking: null,
}));

let connected = false;

/** Learn them from the main process and follow each change (once per page). */
export function connectScreenSwitches(): void {
  if (connected) return;
  connected = true;
  window.drashti.screenSwitches.onChanged((switches) => {
    useScreenSwitches.setState({ switches, known: true });
  });
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
 * Nothing while a question is open. The problem in words, or null.
 */
export function toggleSwitch(which: ScreenSwitch): Promise<string | null> {
  const { switches, asking } = useScreenSwitches.getState();
  if (asking) return Promise.resolve(null);
  if (!switches[which]) return turnSwitch(which, true);
  if (!switchAsksFirst(which)) return turnSwitch(which, false);
  useScreenSwitches.setState({ asking: which });
  return Promise.resolve(null);
}

/** The question answered Turn off. */
export function confirmAsk(): Promise<string | null> {
  const which = useScreenSwitches.getState().asking;
  useScreenSwitches.setState({ asking: null });
  return which ? turnSwitch(which, false) : Promise.resolve(null);
}

/** The question answered Cancel (or closed): nothing changes. */
export function cancelAsk(): void {
  useScreenSwitches.setState({ asking: null });
}

/** Simple Mode's key and the status bar's Turn on: on if it is off, never off. */
export function turnOnIfOff(which: ScreenSwitch): Promise<string | null> {
  return useScreenSwitches.getState().switches[which] ? Promise.resolve(null) : turnSwitch(which, true);
}
