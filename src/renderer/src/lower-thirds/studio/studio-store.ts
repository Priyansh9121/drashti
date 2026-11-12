import { create } from 'zustand';
import type {
  LowerThird,
  LowerThirdInput,
  LowerThirdLook,
  StudioOpen,
} from '../../../../shared/lower-thirds';
import { lowerThirdName, NEW_LOWER_THIRD } from '../../../../shared/lower-thirds';

/*
 * The Lower Thirds studio's state (Session 55, Part 16): the library's lower thirds, the one open (its id, as it is
 * being changed, and as it was saved), the tab shown, and what waits on the question about changes not saved
 * (choosing another, a new one, a template, or closing the window). The library is the main process's: every
 * change goes through the lower thirds' channels.
 */

export type StudioTab = 'words' | 'style' | 'animation' | 'background' | 'timing';

interface StudioState {
  list: LowerThird[] | null;
  /** The one open (null: a new one, not saved yet). */
  id: string | null;
  draft: LowerThirdInput;
  /** As it was saved (null: a new one). */
  saved: LowerThirdInput | null;
  saving: boolean;
  problem: string | null;
  tab: StudioTab;
  /** Asked before changes are thrown away: what to do once they may be. */
  asking: { then: () => void } | null;
  /** Just deleted, with Undo. */
  deleted: { ids: string[]; name: string } | null;
  /** Changed to play the preview again. */
  play: number;
}

/** A lower third's three lines, blank where it has none. */
const threeLines = (lines: readonly string[]): string[] => [...lines, '', '', ''].slice(0, 3);

const fresh = (): LowerThirdInput => ({ ...NEW_LOWER_THIRD, lines: ['', '', ''] });

export const useStudio = create<StudioState>(() => ({
  list: null,
  id: null,
  draft: fresh(),
  saved: null,
  saving: false,
  problem: null,
  tab: 'words',
  asking: null,
  deleted: null,
  play: 0,
}));

/** The lower third's fields as the studio keeps them (its lines always three). */
export function inputOf(lt: LowerThird | LowerThirdInput): LowerThirdInput {
  return {
    lines: threeLines(lt.lines),
    look: lt.look,
    where: lt.where,
    animation: lt.animation,
    ...(lt.outAnimation === undefined ? {} : { outAnimation: lt.outAnimation }),
    ...(lt.seconds === undefined ? {} : { seconds: lt.seconds }),
  };
}

/** Changed since it was saved (a new one: once it has words). */
export function isDirty(s: Pick<StudioState, 'draft' | 'saved'>): boolean {
  if (s.saved === null) return s.draft.lines.some((l) => l.trim() !== '');
  return JSON.stringify(s.saved) !== JSON.stringify(s.draft);
}

/** Do `then` now, or once the operator has said changes not saved may go (asked first). */
export function whenFree(then: () => void): void {
  const s = useStudio.getState();
  if (isDirty(s)) useStudio.setState({ asking: { then } });
  else then();
}

function load(lt: LowerThird | null): void {
  const draft = lt ? inputOf(lt) : fresh();
  useStudio.setState((s) => ({
    id: lt?.id ?? null,
    draft,
    saved: lt ? draft : null,
    problem: null,
    play: s.play + 1,
  }));
}

/** Open one (asked first when the one open has changes). */
export function choose(id: string): void {
  if (useStudio.getState().id === id) return;
  whenFree(() => {
    load(useStudio.getState().list?.find((l) => l.id === id) ?? null);
  });
}

/** A new one, blank or from a template (asked first when the one open has changes). */
export function makeNew(from: LowerThirdInput | null = null, accepted?: () => void): void {
  whenFree(() => {
    load(null);
    if (from) {
      useStudio.setState({ draft: inputOf(from), tab: 'words' });
    } else useStudio.setState({ tab: 'words' });
    accepted?.();
  });
}

export function change(patch: Partial<LowerThirdInput>): void {
  useStudio.setState((s) => ({ draft: { ...s.draft, ...patch } }));
}

export function changeLook(patch: Partial<LowerThirdLook>): void {
  useStudio.setState((s) => ({ draft: { ...s.draft, look: { ...s.draft.look, ...patch } } }));
}

/** Leave a field out of the lower third (its out back to the in played backwards, or until hidden). */
export function leaveOut(field: 'outAnimation' | 'seconds'): void {
  useStudio.setState((s) => ({
    draft: Object.fromEntries(Object.entries(s.draft).filter(([k]) => k !== field)) as LowerThirdInput,
  }));
}

export function playAgain(): void {
  useStudio.setState((s) => ({ play: s.play + 1 }));
}

/** Save what is open: true when it was kept. */
export async function save(): Promise<boolean> {
  const s = useStudio.getState();
  useStudio.setState({ saving: true });
  const result = await window.drashti.lowerThirds.save(s.id, s.draft);
  useStudio.setState({ saving: false });
  if (!result.ok) {
    useStudio.setState({ problem: result.message });
    return false;
  }
  useStudio.setState({ id: result.id, saved: s.draft, problem: null });
  return true;
}

/** Show the one open on the screens (saved first when it has changes), or hide it when it is up. */
export async function showOrHide(up: boolean): Promise<void> {
  if (up) {
    const hidden = await window.drashti.lowerThirds.hide();
    if (!hidden.ok) useStudio.setState({ problem: hidden.message });
    return;
  }
  const s = useStudio.getState();
  if ((isDirty(s) || s.id === null) && !(await save())) return;
  const id = useStudio.getState().id;
  if (id === null) return;
  const shown = await window.drashti.lowerThirds.show(id);
  if (!shown.ok) useStudio.setState({ problem: shown.message });
}

/** Delete the one open; Undo brings it back. */
export async function remove(): Promise<void> {
  const { id, list, draft } = useStudio.getState();
  if (id === null) {
    load(null);
    return;
  }
  const name = lowerThirdName(list?.find((l) => l.id === id)?.lines ?? draft.lines);
  const result = await window.drashti.lowerThirds.remove([id]);
  if (!result.ok) {
    useStudio.setState({ problem: result.message });
    return;
  }
  load(null);
  useStudio.setState({ deleted: { ids: result.ids, name } });
}

export async function undoDelete(): Promise<void> {
  const deleted = useStudio.getState().deleted;
  if (!deleted) return;
  useStudio.setState({ deleted: null });
  const back = await window.drashti.lowerThirds.restore(deleted.ids);
  if (!back.ok) {
    useStudio.setState({ problem: back.message });
    return;
  }
  const first = deleted.ids[0];
  const lt = first === undefined ? undefined : useStudio.getState().list?.find((l) => l.id === first);
  if (lt) load(lt);
}

/** What the window was opened on (its address), or told to open while it is open. */
function opened(what: NonNullable<StudioOpen>): void {
  if ('id' in what) choose(what.id);
  else makeNew();
}

let connected = false;

/** Read the list and follow it; open what the window was opened on. */
export function connectStudio(): void {
  if (connected) return;
  connected = true;
  window.drashti.lowerThirds.onChanged((list) => {
    useStudio.setState({ list });
    const s = useStudio.getState();
    // The one open deleted elsewhere (the panel): what is here becomes a new one, kept only if saved again.
    if (s.id !== null && !list.some((l) => l.id === s.id)) useStudio.setState({ id: null, saved: null });
    // Restored by Undo: its row is back.
    const restored = s.deleted?.ids.every((id) => list.some((l) => l.id === id)) ?? false;
    if (restored) useStudio.setState({ deleted: null });
  });
  window.drashti.lowerThirds.onEdit(opened);
  void window.drashti.lowerThirds.list().then((list) => {
    useStudio.setState({ list });
    const asked = new URLSearchParams(location.search).get('open');
    if (asked === 'new') makeNew();
    else if (asked) load(list.find((l) => l.id === asked) ?? null);
  });
}
