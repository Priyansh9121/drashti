import { create } from 'zustand';
import type { EngineState } from '../../../shared/engine/state';
import type { OperatorAction } from '../../../shared/keymap';
import type { PracticeAction, Practice } from '../../../shared/practice';
import { PRACTICE_START, practiceState, practiceStep } from '../../../shared/practice';
import { useEngine } from '../engine/engine-store';

/*
 * The practice show (Session 26g), in this window only: its own little state (shared/practice.ts),
 * never sent to the main process. While it is on, the window's keys, MIDI pads and show buttons
 * work it instead of the show, and LIVE and the show controls draw it; the outputs, nodes, the
 * stream, recordings, phones and the API never hear of it, and nothing is saved.
 */

interface PracticeView {
  on: boolean;
  practice: Practice;
  /** The practice as an EngineState, for LIVE and the show controls to draw. */
  state: EngineState;
}

const start = (): Pick<PracticeView, 'practice' | 'state'> => ({
  practice: PRACTICE_START,
  state: practiceState(PRACTICE_START),
});

export const usePractice = create<PracticeView>(() => ({ on: false, ...start() }));

export function startPractice(): void {
  usePractice.setState({ on: true, ...start() });
}

export function stopPractice(): void {
  usePractice.setState({ on: false, ...start() });
}

/** One step of the practice show. */
export function runPractice(action: PracticeAction): void {
  const { practice } = usePractice.getState();
  const next = practiceStep(practice, action);
  if (next !== practice) usePractice.setState({ practice: next, state: practiceState(next) });
}

/** What a show key does in the practice show (the others do nothing there). */
const KEYS: Partial<Record<OperatorAction, PracticeAction>> = {
  next: 'next',
  previous: 'previous',
  nextItem: 'next',
  previousItem: 'previous',
  clearAll: 'clearAll',
  clearSlide: 'clearSlide',
  toggleBlackout: 'toggleBlackout',
  toggleLogo: 'toggleLogo',
};

/** A key or button while practising: true when the practice show took it. */
export function practiceKey(action: OperatorAction | 'back' | 'putBack'): boolean {
  if (!usePractice.getState().on) return false;
  const step = action === 'back' || action === 'putBack' ? action : KEYS[action];
  if (step) runPractice(step);
  return true;
}

/** The show as this window draws it: the practice show while it is on, else the engine's state. */
export function useShowState(): EngineState | null {
  const on = usePractice((s) => s.on);
  const practice = usePractice((s) => s.state);
  const real = useEngine((s) => s.state);
  return on ? practice : real;
}

/** Its revision, so pictures know when to draw again. */
export function useShowRev(): number {
  const on = usePractice((s) => s.on);
  const practice = usePractice((s) => s.practice.rev);
  const real = useEngine((s) => s.rev);
  return on ? practice : real;
}
