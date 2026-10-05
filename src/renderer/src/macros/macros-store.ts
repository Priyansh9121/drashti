import { create } from 'zustand';
import type { Macro, MacroAction, MacroResult, MacroSchedule } from '../../../shared/macros';
import { MACRO_COLORS } from '../../../shared/macros';
import { useNotice } from '../operator/actions';

/*
 * Macros in the operator window: the list (kept current from the main
 * process), running one, and the macro editor (a copy, saved as one change).
 */

interface Editing {
  /** Null for a new macro, not saved yet. */
  id: string | null;
  name: string;
  color: string;
  actions: MacroAction[];
  /** Times it runs by itself (Session 14). */
  schedules: MacroSchedule[];
}

interface MacrosStore {
  macros: Macro[] | null;
  open: boolean;
  editing: Editing | null;
  saved: Editing | null;
  problem: string | null;
}

export const useMacros = create<MacrosStore>(() => ({
  macros: null,
  open: false,
  editing: null,
  saved: null,
  problem: null,
}));

let started = false;

export function connectMacros(): void {
  if (started) return;
  started = true;
  window.drashti.macros.onChanged((macros) => {
    useMacros.setState({ macros });
  });
  void window.drashti.macros.list().then((macros) => {
    useMacros.setState({ macros });
  });
}

/** Run a macro; what went wrong goes in the notice area. */
export async function runMacro(macroId: string): Promise<boolean> {
  const result = await window.drashti.macros.run(macroId);
  useNotice.setState({ text: result.ok ? null : result.message });
  return result.ok;
}

export const isDirty = (s: MacrosStore): boolean => s.editing !== s.saved;

export function openMacros(id: string | null = null): void {
  connectMacros();
  useMacros.setState({ open: true, problem: null });
  const list = useMacros.getState().macros ?? [];
  const found = list.find((m) => m.id === id) ?? list[0];
  if (found) show(found.id);
  else startNew();
}

export function closeMacros(): void {
  useMacros.setState({ open: false, editing: null, saved: null, problem: null });
}

export function show(id: string): void {
  const m = useMacros.getState().macros?.find((x) => x.id === id);
  const editing = m
    ? { id: m.id, name: m.name, color: m.color, actions: m.actions, schedules: m.schedules }
    : null;
  useMacros.setState({ editing, saved: editing, problem: null });
}

export function startNew(): void {
  const names = new Set((useMacros.getState().macros ?? []).map((m) => m.name));
  let name = 'New macro';
  for (let n = 2; names.has(name); n++) name = `New macro ${n}`;
  const count = useMacros.getState().macros?.length ?? 0;
  const editing: Editing = {
    id: null,
    name,
    color: MACRO_COLORS[count % MACRO_COLORS.length] ?? '#3e63dd',
    actions: [],
    schedules: [],
  };
  useMacros.setState({ editing, saved: null, problem: null });
}

export function change(fn: (e: Editing) => Editing): void {
  const e = useMacros.getState().editing;
  if (e) useMacros.setState({ editing: fn(e) });
}

async function answer(run: () => Promise<MacroResult>): Promise<MacroResult> {
  const result = await run();
  if (result.ok) useMacros.setState({ macros: result.macros, problem: null });
  else useMacros.setState({ problem: result.message });
  return result;
}

export async function save(): Promise<boolean> {
  const e = useMacros.getState().editing;
  if (!e) return false;
  const result = await answer(() =>
    window.drashti.macros.save(e.id, {
      name: e.name,
      color: e.color,
      actions: e.actions,
      schedules: e.schedules,
    }),
  );
  if (!result.ok) return false;
  show(result.id);
  return true;
}

export async function remove(): Promise<boolean> {
  const e = useMacros.getState().editing;
  if (!e?.id) return false;
  const id = e.id;
  const result = await answer(() => window.drashti.macros.remove(id));
  if (!result.ok) return false;
  const first = useMacros.getState().macros?.[0];
  if (first) show(first.id);
  else startNew();
  return true;
}
