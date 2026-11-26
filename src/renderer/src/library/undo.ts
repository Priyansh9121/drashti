import { create } from 'zustand';
import type { OperatorMode } from '../../../shared/mode';
import { useMode } from '../operator/mode-store';

/*
 * Undo for removals and changes: presentations from the library, playlists
 * and folders, items added to, moved in or removed from a playlist, words
 * and themes. Each step knows how to bring itself back.
 */

export interface Removal {
  /** What the Undo bar says, for example "Removed “Song”" or "Moved “Song” up". */
  text: string;
  restore: () => Promise<void>;
}

interface UndoStep extends Removal {
  /** Pro changes stay in history but are never offered or consumed by Simple Mode. */
  mode: OperatorMode;
}

/** How many removals Undo remembers. */
const KEEP = 50;

/**
 * How long the Undo line at the left column's foot stays after a change (QA23-UNDOLINE-1, the owner: "it should not
 * keep saying deleted "" under wallpapers for more than a minute"): a minute from the last change, then it goes. Edit >
 * Undo and its key still bring back each of the last KEEP changes after that, as before.
 */
export const LINE_MS = 60_000;

export const useUndo = create<{
  stack: UndoStep[];
  /** What was last done or undone, for a screen reader: said once, even when it repeats ("Moved … up" twice). */
  said: { text: string; count: number; mode: OperatorMode | null };
  /** Whether the Undo line shows: from a change until its minute (LINE_MS) is up. */
  line: boolean;
}>(() => ({ stack: [], said: { text: '', count: 0, mode: null }, line: false }));

/** The line's clock: this computer's steady one, or a test's held one (holdLineClock). */
let lineNow = (): number => performance.now();
/** When, by lineNow, the line goes. */
let lineDue = 0;
let lineTimer: ReturnType<typeof setTimeout> | undefined;

/** The line goes once its minute is up; a timer that comes early (or a held clock) just waits on. */
function timeLine(): void {
  clearTimeout(lineTimer);
  lineTimer = undefined;
  const left = lineDue - lineNow();
  if (left > 0) lineTimer = setTimeout(timeLine, left);
  else useUndo.setState({ line: false });
}

/**
 * Tests only (library/undo-line-test.ts, under a test switch that a packaged Drashti never honours): the line's clock
 * held from now, moved on only by the function given back, so a test sees the line at 59 s and gone at 60.
 */
export function holdLineClock(): (ms: number) => void {
  let held = lineNow();
  lineNow = () => held;
  return (ms) => {
    held += ms;
    if (lineTimer !== undefined) timeLine();
  };
}

const say = (text: string, mode: OperatorMode) => {
  useUndo.setState((s) => ({ said: { text, count: s.said.count + 1, mode } }));
};

export function pushRemoval(removal: Removal): void {
  const mode = useMode.getState().mode ?? 'pro';
  useUndo.setState((s) => ({ stack: [...s.stack.slice(1 - KEEP), { ...removal, mode }], line: true }));
  lineDue = lineNow() + LINE_MS;
  timeLine();
  say(removal.text, mode);
}

/** The last step this mode can undo; Pro Mode can undo steps made in either mode. */
export function lastRemoval(stack: readonly UndoStep[], mode: OperatorMode | null): UndoStep | undefined {
  return stack.findLast((step) => mode !== 'simple' || step.mode === 'simple');
}

/**
 * What the Undo line at the left column's foot shows: the last step this mode can undo, until the minute of the last
 * change is up (LINE_MS); then nothing, while that step stays for Edit > Undo.
 */
export function lineRemoval(
  state: { stack: readonly UndoStep[]; line: boolean },
  mode: OperatorMode | null,
): UndoStep | undefined {
  return state.line ? lastRemoval(state.stack, mode) : undefined;
}

/** Bring back the last change available in this mode, leaving other history intact. */
export async function undoRemoval(mode: OperatorMode = useMode.getState().mode ?? 'pro'): Promise<boolean> {
  const last = lastRemoval(useUndo.getState().stack, mode);
  if (!last) return false;
  useUndo.setState((s) => ({ stack: s.stack.filter((step) => step !== last) }));
  await last.restore();
  say(`Undone: ${last.text}`, mode);
  return true;
}

/** “Name” for one thing, or "3 presentations" for several. */
export function describeSome(names: readonly string[], count: number, noun: string): string {
  const [first] = names;
  if (count === 1 && first !== undefined) return `“${first}”`;
  return `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
}
