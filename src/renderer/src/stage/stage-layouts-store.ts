import { create } from 'zustand';
import type { StageBox, StageBoxKind, StageLayout, StageLayoutResult } from '../../../shared/stage-layouts';
import {
  MAX_STAGE_BOXES,
  newStageBox,
  STAGE_BOX_NAMES,
  standardAsBoxes,
  withBoxAdded,
} from '../../../shared/stage-layouts';
import { freshName } from '../../../shared/stage-templates';

/*
 * Stage layouts in the operator window: the list (kept current from the main
 * process) and the layout editor: the layout being changed (a copy, saved as
 * one change), which box is chosen, and what to say. Since Session 55 every
 * step in the editor has Undo: each change to the layout shown (a box added,
 * moved, changed or deleted), and each change to the list (New, New from a
 * Template…, Duplicate, Rename, Save and Delete), latest first; and the one
 * layout every stage screen shows is chosen here too (the Stage screen panel's
 * Layout).
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

/**
 * One step Undo takes back (Session 55): a change to the layout shown, not saved yet (as it was before), or a change
 * to the list, with what puts it back. `key` and `at` let changes to one field in a row count as one step.
 */
export type StageStep =
  | { kind: 'draft'; text: string; before: Editing; key: string; at: number }
  | { kind: 'saved'; text: string; undo: () => Promise<void> };

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
  /** What Undo takes back, latest last (Session 55). */
  steps: StageStep[];
}

export const useStageLayouts = create<StageLayoutsStore>(() => ({
  layouts: null,
  open: false,
  shownId: STANDARD,
  editing: null,
  saved: null,
  boxId: null,
  problem: null,
  steps: [],
}));

/** How many steps Undo keeps. */
const KEEP_STEPS = 100;
/** Changes to the same field within this long are one step (typing a name, a size). */
const ONE_STEP_MS = 1500;

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
  if (useStageLayouts.getState().layouts !== null || id === STANDARD) {
    show(id);
    return;
  }
  // Not read yet (opened from the stage panel before anything listed them, Session 26a): that layout
  // once they are, unless the operator has moved on meanwhile.
  show(STANDARD);
  void window.drashti.stageLayouts.list().then((layouts) => {
    useStageLayouts.setState({ layouts });
    const s = useStageLayouts.getState();
    if (s.open && s.shownId === STANDARD && s.editing === null) show(id);
  });
}

export function closeStageLayouts(): void {
  useStageLayouts.setState({
    open: false,
    editing: null,
    saved: null,
    boxId: null,
    problem: null,
    steps: [],
  });
}

/** The steps without those of the layout shown not saved (they go with it as another is shown, or it is saved). */
const savedSteps = (steps: readonly StageStep[]): StageStep[] => steps.filter((x) => x.kind === 'saved');

/** Show a layout in the editor (changes to the one shown are dropped: the caller asks first). */
export function show(id: string): void {
  const s = useStageLayouts.getState();
  const layout = s.layouts?.find((l) => l.id === id);
  const editing = layout ? editingOf(layout) : null;
  useStageLayouts.setState({
    shownId: layout ? id : STANDARD,
    editing,
    saved: editing,
    boxId: null,
    problem: null,
    steps: savedSteps(s.steps),
  });
}

/** A step Undo can take back, latest last. */
function pushStep(step: StageStep): void {
  useStageLayouts.setState((s) => ({ steps: [...s.steps, step].slice(-KEEP_STEPS) }));
}

/**
 * A change to the layout shown, not saved yet: Undo puts it back as it was. Changes to one field (`key`) in a row,
 * within a moment of each other, are one step.
 */
export function change(fn: (e: Editing) => Editing, text = 'Changed the layout', key = text): void {
  const s = useStageLayouts.getState();
  if (!s.editing) return;
  const next = fn(s.editing);
  if (next === s.editing) return;
  const last = s.steps.at(-1);
  const now = Date.now();
  const same = last?.kind === 'draft' && last.key === key && now - last.at < ONE_STEP_MS;
  const steps: StageStep[] = same
    ? [...s.steps.slice(0, -1), { ...last, at: now }]
    : [...s.steps, { kind: 'draft' as const, text, before: s.editing, key, at: now }].slice(-KEEP_STEPS);
  useStageLayouts.setState({ editing: next, steps });
}

export function chooseBox(boxId: string | null): void {
  useStageLayouts.setState({ boxId });
}

/** A box's name as the steps say it. */
const boxName = (box: StageBox | undefined): string => (box ? STAGE_BOX_NAMES[box.kind] : 'a box');

/**
 * Add a box of this kind to the layout shown, and choose it (up to the most a layout holds). The audience
 * picture (Session 50) and the video input (Session 55) go under the boxes already there, so they draw over them;
 * any other on top.
 */
export function addBox(kind: StageBoxKind): void {
  const e = useStageLayouts.getState().editing;
  if (!e || e.boxes.length >= MAX_STAGE_BOXES) return;
  const made = newStageBox(kind, crypto.randomUUID());
  change(
    (x) => ({ ...x, boxes: withBoxAdded(x.boxes, made) }),
    `Added the box ${STAGE_BOX_NAMES[kind]}`,
    made.id,
  );
  useStageLayouts.setState({ boxId: made.id });
}

/** Delete a box from the layout shown (Session 55: its button on the canvas, or Delete or Backspace), with Undo. */
export function deleteBox(boxId: string): void {
  const e = useStageLayouts.getState().editing;
  const box = e?.boxes.find((b) => b.id === boxId);
  if (!e || !box) return;
  change(
    (x) => ({ ...x, boxes: x.boxes.filter((b) => b.id !== boxId) }),
    `Deleted the box ${boxName(box)}`,
    `delete:${boxId}`,
  );
  if (useStageLayouts.getState().boxId === boxId) useStageLayouts.setState({ boxId: null });
}

async function answer(run: () => Promise<StageLayoutResult>): Promise<StageLayoutResult> {
  const result = await run();
  if (result.ok) useStageLayouts.setState({ layouts: result.layouts, problem: null });
  else useStageLayouts.setState({ problem: result.message });
  return result;
}

/** The layout every stage screen shows now: its id, or null for Standard (from the engine's state). */
type ChosenNow = () => string | null;

/** Remove a layout made by a step (Undo of New, Duplicate, New from a Template…); the editor shows Standard if it was shown. */
async function unmake(id: string): Promise<void> {
  const result = await answer(() => window.drashti.stageLayouts.remove(id));
  if (result.ok && useStageLayouts.getState().shownId === id) show(STANDARD);
}

/**
 * A new layout, made at once (Session 55: New, an empty black stage; Duplicate, a copy of the one shown, or Standard's
 * parts), and shown; Undo takes it away. The one shown has no changes waiting (the caller asks first).
 */
async function makeLayout(
  name: string,
  background: string,
  boxes: StageBox[],
  text: string,
): Promise<boolean> {
  const result = await answer(() => window.drashti.stageLayouts.save(null, { name, background, boxes }));
  if (!result.ok) return false;
  const id = result.id;
  show(id);
  pushStep({ kind: 'saved', text: `${text} “${name}”`, undo: () => unmake(id) });
  return true;
}

/** A name no other layout has. */
const freeName = (base: string): string =>
  freshName(
    (useStageLayouts.getState().layouts ?? []).map((l) => l.name),
    base,
  );

/** New (Session 55): an empty black stage, made at once and shown, to add boxes to. */
export function newLayout(): Promise<boolean> {
  return makeLayout(freeName('Stage layout'), '#000000', [], 'Made');
}

/** Duplicate: a copy of the one shown (or Standard's parts), made at once and shown. */
export function duplicate(): Promise<boolean> {
  const s = useStageLayouts.getState();
  const from = s.editing;
  const newId = () => crypto.randomUUID();
  if (!from)
    return makeLayout(freeName('Stage layout'), '#000000', standardAsBoxes(newId), 'Duplicated Standard as');
  return makeLayout(
    freeName(`${from.name} copy`),
    from.background,
    from.boxes.map((b) => ({ ...b, id: newId() })),
    `Duplicated “${from.name}” as`,
  );
}

/** A new layout of these boxes on black, not saved yet, shown as Duplicate's was (New from a Template…, Session 54). */
export function startLayout(name: string, boxes: StageBox[]): void {
  const editing: Editing = { id: null, name, background: '#000000', boxes };
  useStageLayouts.setState({ shownId: '', editing, saved: null, boxId: null, problem: null });
}

/**
 * New from a Template… made it (Session 55's Undo): the layout, chosen for the stage screens at once; Undo takes it
 * away, puts back the layout chosen before, and takes away the timer it made (if it made one).
 */
export function templateMade(
  layout: { id: string; name: string },
  before: string | null,
  timerId: string | null,
): void {
  pushStep({
    kind: 'saved',
    text: `Made “${layout.name}” from a template`,
    undo: async () => {
      await unmake(layout.id);
      await window.drashti.stageLayouts.choose(before);
      if (timerId !== null) await window.drashti.timers.remove(timerId);
    },
  });
}

/** Save the layout shown (make it, if new); Undo puts it back as it was saved before. */
export async function save(): Promise<boolean> {
  const s = useStageLayouts.getState();
  const e = s.editing;
  if (!e) return false;
  const before = s.saved;
  const result = await answer(() =>
    window.drashti.stageLayouts.save(e.id, { name: e.name, background: e.background, boxes: e.boxes }),
  );
  if (!result.ok) return false;
  const id = result.id;
  show(id);
  if (before?.id)
    pushStep({
      kind: 'saved',
      text: `Saved “${e.name}”`,
      undo: async () => {
        const back = await answer(() =>
          window.drashti.stageLayouts.save(id, {
            name: before.name,
            background: before.background,
            boxes: before.boxes,
          }),
        );
        if (back.ok && useStageLayouts.getState().shownId === id) show(id);
      },
    });
  return true;
}

/** Rename… (Session 55): the layout shown, at once, its boxes and any changes waiting as they are; with Undo. */
export async function rename(id: string, name: string): Promise<boolean> {
  const was = useStageLayouts.getState().layouts?.find((l) => l.id === id);
  if (!was) return false;
  const result = await answer(() => window.drashti.stageLayouts.rename(id, name));
  if (!result.ok) return false;
  const now = result.layouts.find((l) => l.id === id)?.name ?? name;
  renamedShown(id, now);
  pushStep({
    kind: 'saved',
    text: `Renamed “${was.name}” to “${now}”`,
    undo: async () => {
      const back = await answer(() => window.drashti.stageLayouts.rename(id, was.name));
      if (back.ok) renamedShown(id, was.name);
    },
  });
  return true;
}

/** The layout shown took a new name: in what is saved, and in the changes waiting. */
function renamedShown(id: string, name: string): void {
  const s = useStageLayouts.getState();
  if (s.shownId !== id || !s.editing || !s.saved) return;
  const saved = { ...s.saved, name };
  useStageLayouts.setState({ saved, editing: s.editing === s.saved ? saved : { ...s.editing, name } });
}

/**
 * Delete the layout shown, at once (Session 55), with Undo: put back as it was, in its place, and chosen for the
 * stage screens again if it was. Deleting the layout in use puts the Standard stage screen on them.
 */
export async function remove(chosenNow: ChosenNow): Promise<boolean> {
  const s = useStageLayouts.getState();
  const id = s.editing?.id;
  const kept = id ? s.layouts?.find((l) => l.id === id) : undefined;
  if (!id || !kept) return false;
  const at = (s.layouts ?? []).findIndex((l) => l.id === id);
  const chosen = chosenNow() === id;
  const result = await answer(() => window.drashti.stageLayouts.remove(id));
  if (!result.ok) return false;
  show(STANDARD);
  pushStep({
    kind: 'saved',
    text: `Deleted “${kept.name}”`,
    undo: async () => {
      const back = await answer(() => window.drashti.stageLayouts.restore(kept, Math.max(0, at), chosen));
      if (back.ok) show(id);
    },
  });
  return true;
}

/** The step Undo would take back now, or null. */
export const lastStep = (s: StageLayoutsStore): StageStep | null => s.steps.at(-1) ?? null;

/** Undo (Session 55): the last step taken back, the layout shown or the list as it was. False with none. */
export async function undoStage(): Promise<boolean> {
  const s = useStageLayouts.getState();
  const step = s.steps.at(-1);
  if (!step) return false;
  useStageLayouts.setState({ steps: s.steps.slice(0, -1) });
  if (step.kind === 'draft') {
    const boxId = s.boxId !== null && step.before.boxes.some((b) => b.id === s.boxId) ? s.boxId : null;
    useStageLayouts.setState({ editing: step.before, boxId });
    return true;
  }
  await step.undo();
  return true;
}

/** The one layout every stage screen shows (Session 55): null for the Standard stage screen. */
export async function chooseStageLayout(id: string | null): Promise<string | null> {
  const result = await window.drashti.stageLayouts.choose(id).catch(() => null);
  if (!result) return 'Drashti could not choose it. Try again in a moment.';
  return result.ok ? null : result.message;
}
