import { create } from 'zustand';
import type { LowerThird, LowerThirdInput } from '../../../shared/lower-thirds';
import { lowerThirdName, NEW_LOWER_THIRD } from '../../../shared/lower-thirds';
import { describeSome, pushRemoval } from '../library/undo';
import { dispatch, useNotice } from '../operator/actions';

/*
 * The Lower Thirds panel's state (Session 44): the library's lower thirds, the one being made or changed in the
 * editor (with what it was, for the question on closing), and those chosen together to delete at once.
 */

interface Editing {
  /** null: a new one. */
  id: string | null;
  draft: LowerThirdInput;
  /** As it was saved (a new one: null). */
  saved: LowerThirdInput | null;
}

interface LowerThirdsState {
  list: LowerThird[] | null;
  editing: Editing | null;
  /** Chosen together (Session 44's choosing many). */
  marked: string[];
  anchor: string | null;
  saving: boolean;
  problem: string | null;
}

export const useLowerThirds = create<LowerThirdsState>(() => ({
  list: null,
  editing: null,
  marked: [],
  anchor: null,
  saving: false,
  problem: null,
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

/** Open the editor on one (or a new one). */
export function editLowerThird(lowerThird: LowerThird | null): void {
  const draft: LowerThirdInput = lowerThird
    ? {
        lines: [...lowerThird.lines, '', '', ''].slice(0, 3),
        look: lowerThird.look,
        where: lowerThird.where,
        animation: lowerThird.animation,
      }
    : { ...NEW_LOWER_THIRD, lines: ['', '', ''] };
  useLowerThirds.setState({
    editing: { id: lowerThird?.id ?? null, draft, saved: lowerThird ? draft : null },
    problem: null,
  });
}

export function closeEditor(): void {
  useLowerThirds.setState({ editing: null, problem: null });
}

export function changeDraft(patch: Partial<LowerThirdInput>): void {
  const e = useLowerThirds.getState().editing;
  if (!e) return;
  useLowerThirds.setState({ editing: { ...e, draft: { ...e.draft, ...patch } } });
}

/** Changed since it was saved (a new one: once it has words). */
export function isDirty(e: Editing | null): boolean {
  if (!e) return false;
  if (e.saved === null) return e.draft.lines.some((l) => l.trim() !== '');
  return JSON.stringify(e.saved) !== JSON.stringify(e.draft);
}

/** Save what is in the editor: true when it was kept. */
export async function saveDraft(): Promise<boolean> {
  const e = useLowerThirds.getState().editing;
  if (!e) return false;
  useLowerThirds.setState({ saving: true });
  const result = await window.drashti.lowerThirds.save(e.id, e.draft);
  useLowerThirds.setState({ saving: false });
  if (!result.ok) {
    useLowerThirds.setState({ problem: result.message });
    return false;
  }
  useLowerThirds.setState({ editing: { id: result.id, draft: e.draft, saved: e.draft }, problem: null });
  return true;
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
