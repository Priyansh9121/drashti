import { create } from 'zustand';
import type { AppearanceView, OwnAppearance } from '../../../shared/appearance/appearances';

/*
 * The Appearance window (Sessions 39–40): open from View › Appearance…, what it shows (every appearance, the
 * choice, what that shows now), and choosing. The window itself draws in the appearance by the preload, at
 * once; this only keeps the Appearance window's own view up to date. Pro Mode only.
 */

interface AppearanceWindow {
  open: boolean;
  view: AppearanceView | null;
  /** A choice that could not be made, in words, until the next one works. */
  problem: string | null;
}

export const useAppearance = create<AppearanceWindow>(() => ({ open: false, view: null, problem: null }));

async function refresh(): Promise<void> {
  try {
    const view = await window.drashti.appearance.view();
    useAppearance.setState({ view });
  } catch {
    useAppearance.setState({
      problem: 'Drashti couldn’t read the appearances. Close this and open it again.',
    });
  }
}

export function openAppearance(): void {
  useAppearance.setState({ open: true, problem: null });
  void refresh();
}

export function closeAppearance(): void {
  useAppearance.setState({ open: false, problem: null });
}

/** Choose Follow the computer or an appearance: every window changes at once. */
export async function chooseAppearance(choice: string): Promise<void> {
  const result = await window.drashti.appearance.choose(choice);
  useAppearance.setState({ problem: result.ok ? null : result.message });
  await refresh();
}

/** Make one's own and choose it (Session 40): the new one's id, or why it could not be made. */
export async function makeAppearance(fields: Omit<OwnAppearance, 'id'>): Promise<string | null> {
  const result = await window.drashti.appearance.make(fields);
  useAppearance.setState({ problem: result.ok ? null : result.message });
  await refresh();
  return result.ok ? result.id : null;
}

/** Delete one's own: if it was in use, this computer follows its own setting again. */
export async function removeAppearance(id: string): Promise<void> {
  const result = await window.drashti.appearance.remove(id);
  useAppearance.setState({ problem: result.ok ? null : result.message });
  await refresh();
}

let connected = false;

/** View › Appearance… opens it; a change made elsewhere (the menu, the computer turning light or dark) shows. */
export function connectAppearance(): void {
  if (connected) return;
  connected = true;
  window.drashti.appearance.onOpen(openAppearance);
  window.drashti.appearance.onChanged(() => {
    if (useAppearance.getState().open) void refresh();
  });
}
