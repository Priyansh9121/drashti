import { create } from 'zustand';
import type { AnnouncementResult, AnnouncementsView } from '../../../shared/announcements';

/* Announcements sent from phones, as the operator window sees them: the queue, and whether its panel is open. */

interface AnnouncementsQueue {
  view: AnnouncementsView | null;
  open: boolean;
  error: string | null;
}

export const useAnnouncements = create<AnnouncementsQueue>(() => ({ view: null, open: false, error: null }));

let connected = false;

export function connectAnnouncements(): void {
  if (connected) return;
  connected = true;
  window.drashti.announcements.onChanged((view) => {
    useAnnouncements.setState({ view });
  });
  void window.drashti.announcements.list().then((view) => {
    useAnnouncements.setState({ view });
  });
}

/** Run a change; a refusal (Simple Mode, or it is no longer waiting) is shown in the panel. */
export async function announcementAction(
  run: () => Promise<AnnouncementResult>,
): Promise<AnnouncementResult> {
  const result = await run();
  useAnnouncements.setState(result.ok ? { view: result.view, error: null } : { error: result.message });
  return result;
}

export function openAnnouncements(): void {
  useAnnouncements.setState({ open: true, error: null });
}

export function closeAnnouncements(): void {
  useAnnouncements.setState({ open: false, error: null });
}
