import { create } from 'zustand';
import type { StageBox, StageLayout, StageLayoutResult } from '../../../shared/stage-layouts';
import { standardAsBoxes } from '../../../shared/stage-layouts';

/*
 * Stage layouts in the operator window: the list (kept current from the main
 * process) and the layout editor: the layout being changed (a copy, saved as
 * one change), which box is chosen, and what to say.
 */

/** The Standard stage screen's id in the editor's list (it is built in, not a row). */
export const STANDARD = 'standard';

interface Editing {
  /** Null for a new layout, not saved yet. */
  id: string | null;
  name: string;
  background: string;
  boxes: StageBox[];
}

interface StageLayoutsStore {
  layouts: StageLayout[] | null;
  /** The editor is open. */
  open: boolean;
  /** The layout shown in the editor: STANDARD, or a layout's id. */
  shownId: string;
  editing: Editing | null;
  /** The layout as it was when shown (anything else has changes to save). */
  saved: Editing | null;
  boxId: string | null;
  problem: string | null;
}

export const useStageLayouts = create<StageLayoutsStore>(() => ({
  layouts: null,
  open: false,
  shownId: STANDARD,
  editing: null,
  saved: null,
  boxId: null,
  problem: null,
}));

let started = false;

export function connectStageLayouts(): void {
  if (started) return;
  started = true;
  window.drashti.stageLayouts.onChanged((layouts) => {
    useStageLayouts.setState({ layouts });
  });
  void window.drashti.stageLayouts.list().then((layouts) => {
    useStageLayouts.setState({ layouts });
  });
}

const editingOf = (l: StageLayout): Editing => ({
  id: l.id,
  name: l.name,
  background: l.background,
  boxes: l.boxes,
});

export const isDirty = (s: StageLayoutsStore): boolean => s.editing !== s.saved;

/** Open the editor on a layout (or Standard). */
export function openStageLayouts(id: string = STANDARD): void {
  connectStageLayouts();
  useStageLayouts.setState({ open: true, problem: null });
  show(id);
}

export function closeStageLayouts(): void {
  useStageLayouts.setState({ open: false, editing: null, saved: null, boxId: null, problem: null });
}

/** Show a layout in the editor (changes to the one shown are dropped: the caller asks first). */
export function show(id: string): void {
  const layout = useStageLayouts.getState().layouts?.find((l) => l.id === id);
  const editing = layout ? editingOf(layout) : null;
  useStageLayouts.setState({
    shownId: layout ? id : STANDARD,
    editing,
    saved: editing,
    boxId: null,
    problem: null,
  });
}

/** A new layout from Standard's parts (Duplicate of Standard), or a copy of the one shown; not saved yet. */
export function duplicate(): void {
  const s = useStageLayouts.getState();
  const from = s.editing;
  const names = new Set((s.layouts ?? []).map((l) => l.name));
  const base = from ? `${from.name} copy` : 'Stage layout';
  let name = base;
  for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
  const newId = () => crypto.randomUUID();
  const editing: Editing = from
    ? { id: null, name, background: from.background, boxes: from.boxes.map((b) => ({ ...b, id: newId() })) }
    : { id: null, name, background: '#000000', boxes: standardAsBoxes(newId) };
  useStageLayouts.setState({ shownId: '', editing, saved: null, boxId: null, problem: null });
}

export function change(fn: (e: Editing) => Editing): void {
  const s = useStageLayouts.getState();
  if (s.editing) useStageLayouts.setState({ editing: fn(s.editing) });
}

export function chooseBox(boxId: string | null): void {
  useStageLayouts.setState({ boxId });
}

async function answer(run: () => Promise<StageLayoutResult>): Promise<StageLayoutResult> {
  const result = await run();
  if (result.ok) useStageLayouts.setState({ layouts: result.layouts, problem: null });
  else useStageLayouts.setState({ problem: result.message });
  return result;
}

/** Save the layout shown (make it, if new). */
export async function save(): Promise<boolean> {
  const e = useStageLayouts.getState().editing;
  if (!e) return false;
  const result = await answer(() =>
    window.drashti.stageLayouts.save(e.id, { name: e.name, background: e.background, boxes: e.boxes }),
  );
  if (!result.ok) return false;
  show(result.id);
  return true;
}

export async function remove(): Promise<boolean> {
  const e = useStageLayouts.getState().editing;
  if (!e?.id) return false;
  const id = e.id;
  const result = await answer(() => window.drashti.stageLayouts.remove(id));
  if (result.ok) show(STANDARD);
  return result.ok;
}
