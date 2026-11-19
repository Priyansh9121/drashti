import { create } from 'zustand';
import { type ManualChapterId, manualStart } from '../../../shared/manual';
import type { OperatorMode } from '../../../shared/mode';
import { useMode } from '../operator/mode-store';

/*
 * The Drashti Manual's window (x37, Session 60): Help › Drashti Manual…, in either mode, and a panel's "?". Open or
 * not, the chapter shown, the passage to bring into view and mark (from a search or a "?"), what is searched, and
 * the mode it was last opened in: the first time in each mode it opens at that mode's start (Simple Mode at its own
 * chapter), and after that as it was left.
 */

interface ManualState {
  open: boolean;
  chapter: ManualChapterId;
  /** The passage to show and mark, or null for the chapter's start. */
  passage: number | null;
  query: string;
  /** The mode it was last opened in (null: not yet). */
  mode: OperatorMode | null;
}

export const useManual = create<ManualState>(() => ({
  open: false,
  chapter: 'start',
  passage: null,
  query: '',
  mode: null,
}));

/** Open the manual: as it was (at the mode's start the first time in this mode), or at a chapter's passage. */
export function showManual(at?: { chapter: ManualChapterId; passage?: number | null }): void {
  const mode = useMode.getState().mode ?? 'pro';
  useManual.setState((s) => {
    if (at) return { open: true, chapter: at.chapter, passage: at.passage ?? null, query: '', mode };
    if (s.mode === mode) return { ...s, open: true };
    return { open: true, chapter: manualStart(mode), passage: null, query: '', mode };
  });
}

export function closeManual(): void {
  useManual.setState({ open: false });
}
