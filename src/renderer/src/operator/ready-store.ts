import { create } from 'zustand';
import type { ReadyReport } from '../../../shared/ready';
import { usePlaylists } from '../playlists/playlist-store';

/*
 * Ready? (Session 55, Part 8, H): the top bar's button opens it and checks at once; Check again checks again. The
 * main process reads the facts (main/ready/ready-facts.ts); the window says which playlist is open, so its files are
 * the ones checked. Never at start: only when it is pressed.
 */

interface ReadyUi {
  open: boolean;
  /** Checking now. */
  busy: boolean;
  report: ReadyReport | null;
  /** The check could not be made (the main process said no, or failed). */
  failed: boolean;
}

export const useReady = create<ReadyUi>(() => ({ open: false, busy: false, report: null, failed: false }));

/** Check now (and again): the lines come when every fact is read. */
export async function checkReady(): Promise<void> {
  useReady.setState({ busy: true, failed: false });
  try {
    const report = await window.drashti.ready.check(usePlaylists.getState().openId ?? null);
    useReady.setState({ busy: false, report, failed: report === null });
  } catch {
    useReady.setState({ busy: false, failed: true });
  }
}

export function openReady(): void {
  useReady.setState({ open: true, report: null });
  void checkReady();
}

export function closeReady(): void {
  useReady.setState({ open: false });
}
