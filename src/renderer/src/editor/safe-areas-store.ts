import { create } from 'zustand';

/*
 * View › Show Safe Areas (Sessions 31–36, SLD-2): whether the slide editor draws where words are safe, the
 * ticker's and a message's bands, and where each screen group cuts the slide off. Off to begin with, kept
 * with the library's settings, anyone's to turn on.
 */

export const useSafeAreas = create<{ on: boolean }>(() => ({ on: false }));

let connected = false;

export function connectSafeAreas(): void {
  if (connected) return;
  connected = true;
  window.drashti.app.onSafeAreasChanged((on) => {
    useSafeAreas.setState({ on });
  });
  void window.drashti.app.safeAreas().then((on) => {
    useSafeAreas.setState({ on });
  });
}
