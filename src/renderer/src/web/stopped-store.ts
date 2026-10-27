import { create } from 'zustand';
import { STOPPED_REFUSAL } from '../../../shared/access';

/*
 * Drashti has stopped (Session 54, access by Gmail), as a phone's page hears it: its feed's goodbye, or a request
 * refused with Drashti's own words for it. Until the feed is let in again (welcomed). The page then says so plainly
 * (Stopped.tsx), where it would have said only that it was not connected.
 */

export const useStopped = create<{ stopped: boolean }>(() => ({ stopped: false }));

export function heardStopped(): void {
  if (!useStopped.getState().stopped) useStopped.setState({ stopped: true });
}

export function heardLetIn(): void {
  if (useStopped.getState().stopped) useStopped.setState({ stopped: false });
}

/** Whether an answer is Drashti's refusal while it has stopped (or is not let in). */
export const isStoppedAnswer = (status: number, message: unknown): boolean =>
  status === 503 && message === STOPPED_REFUSAL;
