import type { BackgroundLayer } from '../../../shared/engine/state';

/*
 * Which background images and videos an output keeps while the background
 * changes. The one on screen stays until the next one has its first frame,
 * so changing background never flashes black; clearing is immediate.
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
}

export type SlotEvent =
  | { type: 'layer'; layer: BackgroundLayer | null }
  | { type: 'ready'; key: string }
  | { type: 'failed'; key: string };

export const NO_SLOTS: Slots = { shown: null, incoming: null };

export const slotKey = (layer: MediaLayer): string => `${layer.mediaId}@${layer.startedAt}`;

export function slotsReducer(slots: Slots, event: SlotEvent): Slots {
  switch (event.type) {
    case 'layer': {
      const { layer } = event;
      if (layer?.kind !== 'media') return NO_SLOTS;
      const key = slotKey(layer);
      // The same playback: new settings (fit, loop), and whatever was loading is not wanted any more.
      if (slots.shown?.key === key) return { shown: { ...slots.shown, layer }, incoming: null };
      if (slots.incoming?.key === key) return { ...slots, incoming: { ...slots.incoming, layer } };
      return {
        shown: slots.shown?.state === 'ready' ? slots.shown : null,
        incoming: { key, layer, state: 'loading' },
      };
    }
    case 'ready':
      return slots.incoming?.key === event.key
        ? { shown: { ...slots.incoming, state: 'ready' }, incoming: null }
        : slots;
    case 'failed':
      // A file that cannot play replaces the old picture with nothing, as the show asked.
      if (slots.incoming?.key === event.key)
        return { shown: { ...slots.incoming, state: 'failed' }, incoming: null };
      if (slots.shown?.key === event.key) return { ...slots, shown: { ...slots.shown, state: 'failed' } };
      return slots;
  }
}
