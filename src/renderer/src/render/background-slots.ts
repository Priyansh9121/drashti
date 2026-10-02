import type { BackgroundLayer } from '../../../shared/engine/state';

/*
 * Which background images and videos an output keeps while the background
 * changes. The one on screen stays until the next one has its first frame,
 * so changing background never flashes black; clearing is immediate. A
 * background that a dissolving slide brings dissolves in over the old one
 * once it is ready.
 */

export type MediaLayer = Extract<BackgroundLayer, { kind: 'media' }>;

export interface Slot {
  /** One playback: a file and when it started. The same key is the same playback, carrying on. */
  key: string;
  layer: MediaLayer;
  state: 'loading' | 'ready' | 'failed';
}

export interface Slots {
  /** On screen (or failed, which shows nothing). */
  shown: Slot | null;
  /** Loading out of sight, until it can be shown. */
  incoming: Slot | null;
  /** Going away while `shown` dissolves in (a slide that dissolves brought a new background). */
  leaving: Slot | null;
  /** That dissolve: when it started (ms since the epoch) and how long it takes. */
  fade: { start: number; ms: number } | null;
}

export type SlotEvent =
  | { type: 'layer'; layer: BackgroundLayer | null }
  /** `at`: when it became ready, to time its dissolve. */
  | { type: 'ready'; key: string; at?: number }
  | { type: 'failed'; key: string }
  /** The dissolve that started at `start` has finished. */
  | { type: 'faded'; start: number };

export const NO_SLOTS: Slots = { shown: null, incoming: null, leaving: null, fade: null };

export const slotKey = (layer: MediaLayer): string => `${layer.mediaId}@${layer.startedAt}`;

export function slotsReducer(slots: Slots, event: SlotEvent): Slots {
  switch (event.type) {
    case 'layer': {
      const { layer } = event;
      if (layer?.kind !== 'media') return NO_SLOTS;
      const key = slotKey(layer);
      // The same playback: new settings (fit, loop), and whatever was loading is not wanted any more.
      if (slots.shown?.key === key) return { ...slots, shown: { ...slots.shown, layer }, incoming: null };
      if (slots.incoming?.key === key) return { ...slots, incoming: { ...slots.incoming, layer } };
      // Something new: a dissolve still running ends where it is.
      return {
        shown: slots.shown?.state === 'ready' ? slots.shown : null,
        incoming: { key, layer, state: 'loading' },
        leaving: null,
        fade: null,
      };
    }
    case 'ready': {
      const incoming = slots.incoming;
      if (incoming?.key !== event.key) return slots;
      const ready: Slot = { ...incoming, state: 'ready' };
      // It came with a slide that dissolves: it dissolves in from where the slide began (or from now,
      // if it was not ready then), unless that is all over already.
      const fade = incoming.layer.fade;
      const at = event.at;
      if (fade && at !== undefined && at < fade.at + fade.durationMs)
        return {
          shown: ready,
          incoming: null,
          leaving: slots.shown?.state === 'ready' ? slots.shown : null,
          fade: { start: Math.max(fade.at, at), ms: fade.durationMs },
        };
      return { shown: ready, incoming: null, leaving: null, fade: null };
    }
    case 'faded':
      return slots.fade?.start === event.start ? { ...slots, leaving: null, fade: null } : slots;
    case 'failed':
      // A file that cannot play replaces the old picture with nothing, as the show asked.
      if (slots.incoming?.key === event.key)
        return { shown: { ...slots.incoming, state: 'failed' }, incoming: null, leaving: null, fade: null };
      if (slots.shown?.key === event.key) return { ...slots, shown: { ...slots.shown, state: 'failed' } };
      return slots;
  }
}
