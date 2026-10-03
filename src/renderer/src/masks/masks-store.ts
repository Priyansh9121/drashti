import { create } from 'zustand';
import type { Mask, MaskMode, MaskResult, MaskShape } from '../../../shared/masks';

/*
 * The mask library in the operator window: the list (kept current from the
 * main process) and the mask editor: the mask being changed (a copy, saved
 * as one change), which shape is chosen, and what to say.
 */

interface Editing {
  /** Null for a new mask, not saved yet. */
  id: string | null;
  name: string;
  width: number;
  height: number;
  mode: MaskMode;
  shapes: MaskShape[];
}

interface MasksStore {
  masks: Mask[] | null;
  open: boolean;
  editing: Editing | null;
  saved: Editing | null;
  shapeId: string | null;
  problem: string | null;
}

export const useMasks = create<MasksStore>(() => ({
  masks: null,
  open: false,
  editing: null,
  saved: null,
  shapeId: null,
  problem: null,
}));

let started = false;

export function connectMasks(): void {
  if (started) return;
  started = true;
  window.drashti.masks.onChanged((masks) => {
    useMasks.setState({ masks });
  });
  void window.drashti.masks.list().then((masks) => {
    useMasks.setState({ masks });
  });
}

export const isDirty = (s: MasksStore): boolean => s.editing !== s.saved;

const editingOf = (m: Mask): Editing => ({ ...m });

/** Open the editor on a mask, or on the first (or a new one when there is none). */
export function openMasks(id: string | null = null, canvas = { width: 1920, height: 1080 }): void {
  connectMasks();
  useMasks.setState({ open: true, problem: null });
  const list = useMasks.getState().masks ?? [];
  const found = list.find((m) => m.id === id) ?? list[0];
  if (found) show(found.id);
  else startNew(canvas);
}

export function closeMasks(): void {
  useMasks.setState({ open: false, editing: null, saved: null, shapeId: null, problem: null });
}

export function show(id: string): void {
  const mask = useMasks.getState().masks?.find((m) => m.id === id);
  const editing = mask ? editingOf(mask) : null;
  useMasks.setState({ editing, saved: editing, shapeId: null, problem: null });
}

const freshName = (base: string) => {
  const names = new Set((useMasks.getState().masks ?? []).map((m) => m.name));
  let name = base;
  for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
  return name;
};

/** A new mask (not saved yet) on a canvas this size, hiding nothing yet. */
export function startNew(canvas: { width: number; height: number }): void {
  const editing: Editing = {
    id: null,
    name: freshName('New mask'),
    width: canvas.width,
    height: canvas.height,
    mode: 'hide',
    shapes: [],
  };
  useMasks.setState({ editing, saved: null, shapeId: null, problem: null });
}

/** A copy of the mask shown (not saved yet). */
export function duplicate(): void {
  const e = useMasks.getState().editing;
  if (!e) return;
  const editing: Editing = {
    ...e,
    id: null,
    name: freshName(`${e.name} copy`),
    shapes: e.shapes.map((s) => ({ ...s, id: crypto.randomUUID() })),
  };
  useMasks.setState({ editing, saved: null, shapeId: null, problem: null });
}

export function change(fn: (e: Editing) => Editing): void {
  const e = useMasks.getState().editing;
  if (e) useMasks.setState({ editing: fn(e) });
}

export function chooseShape(shapeId: string | null): void {
  useMasks.setState({ shapeId });
}

async function answer(run: () => Promise<MaskResult>): Promise<MaskResult> {
  const result = await run();
  if (result.ok) useMasks.setState({ masks: result.masks, problem: null });
  else useMasks.setState({ problem: result.message });
  return result;
}

export async function save(): Promise<boolean> {
  const e = useMasks.getState().editing;
  if (!e) return false;
  const { id, ...mask } = e;
  const result = await answer(() => window.drashti.masks.save(id, mask));
  if (!result.ok) return false;
  show(result.id);
  return true;
}

export async function remove(): Promise<boolean> {
  const e = useMasks.getState().editing;
  if (!e?.id) return false;
  const id = e.id;
  const result = await answer(() => window.drashti.masks.remove(id));
  if (!result.ok) return false;
  const first = useMasks.getState().masks?.[0];
  if (first) show(first.id);
  else startNew({ width: e.width, height: e.height });
  return true;
}
