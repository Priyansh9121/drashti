import { create } from 'zustand';
import type { EventsOutView } from '../../../shared/events-out';

/*
 * Events out in the operator window (Session 28): the dialog, opened by File › Events Out…. The addresses
 * are asked for only then.
 */

export const useEventsOut = create<{ view: EventsOutView | null; open: boolean }>(() => ({
  view: null,
  open: false,
}));

let connected = false;

export function connectEventsOut(): void {
  if (connected) return;
  connected = true;
  window.drashti.events.onChanged((view) => {
    if (useEventsOut.getState().open) useEventsOut.setState({ view });
  });
  window.drashti.events.onOpen(openEventsOut);
}

export function openEventsOut(): void {
  void window.drashti.events.view().then((view) => {
    useEventsOut.setState({ view, open: true });
  });
}

export function closeEventsOut(): void {
  useEventsOut.setState({ open: false, view: null });
}
