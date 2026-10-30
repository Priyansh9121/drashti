import { create } from 'zustand';
import type { LowerThird, StudioOpen } from '../../../shared/lower-thirds';
import { lowerThirdName } from '../../../shared/lower-thirds';
import { describeSome, pushRemoval } from '../library/undo';
import { dispatch, useNotice } from '../operator/actions';

/*
 * The Lower Thirds panel's state (Session 44): the library's lower thirds, and those chosen together to delete at
 * once. They are made and changed in the Lower Thirds studio, a window of its own (Session 55, Part 16).
 */

interface LowerThirdsState {
  list: LowerThird[] | null;
  /** Chosen together (Session 44's choosing many). */
  marked: string[];
  anchor: string | null;
}

export const useLowerThirds = create<LowerThirdsState>(() => ({
  list: null,
  marked: [],
  anchor: null,
}));

let connected = false;
/** Read the list, and follow it as it changes (once per window). */
export function connectLowerThirds(): void {
  if (connected) return;
  connected = true;
  window.drashti.lowerThirds.onChanged((list) => {
    useLowerThirds.setState({ list });
  });
  void window.drashti.lowerThirds.list().then((list) => {
    useLowerThirds.setState({ list });
  });
}

/** The Lower Thirds studio (Session 55, Part 16), on one, a new one, or as it was. */
export async function openStudio(open: StudioOpen): Promise<void> {
  const r = await window.drashti.lowerThirds.studio(open);
  if (!r.ok) useNotice.setState({ text: r.message });
}

/** Show it, or hide it when it is the one up (one button for both). */
export function showOrHide(lowerThird: LowerThird, up: boolean): Promise<void> {
  return up ? dispatch({ type: 'hideLowerThird' }) : dispatch({ type: 'showLowerThird', lowerThird });
}

/** Delete several at once; one Undo brings them all back. */
export async function deleteLowerThirds(ids: readonly string[]): Promise<void> {
  const list = useLowerThirds.getState().list ?? [];
  const names = ids.map((id) => lowerThirdName(list.find((l) => l.id === id)?.lines ?? []));
  const result = await window.drashti.lowerThirds.remove([...ids]);
  useLowerThirds.setState({ marked: [], anchor: null });
  if (!result.ok) {
    useNotice.setState({ text: result.message });
    return;
  }
  if (result.ids.length === 0) return;
  const done = result.ids;
  pushRemoval({
    text: `Deleted ${describeSome(names, done.length, 'lower third')}`,
    restore: async () => {
      const back = await window.drashti.lowerThirds.restore(done);
      if (!back.ok) useNotice.setState({ text: back.message });
    },
  });
}
