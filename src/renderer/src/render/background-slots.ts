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
  /** How many times it has been tried again (a node's copy that landed late); left out the first time. */
  attempt?: number;
  /**
   * The first background a window heard of, as it opened (Session 23): shown whole, never faded in
   * from black, even part-way through the slide's dissolve.
   */
  joined?: true;
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
  /** `joined`: the first the window hears of the layer (it has just opened or reloaded). */
  | { type: 'layer'; layer: BackgroundLayer | null; joined?: boolean }
  /** `at`: when it became ready, to time its dissolve. */
  | { type: 'ready'; key: string; at?: number }
  | { type: 'failed'; key: string }
  /** The file it failed on can be had now (a node's copy landed): try that playback again. */
  | { type: 'retry'; key: string }
  /** The dissolve that started at `start` has finished. */
  | { type: 'faded'; start: number };

export const NO_SLOTS: Slots = { shown: null, incoming: null, leaving: null, fade: null };

export const slotKey = (layer: MediaLayer): string => `${layer.mediaId}@${layer.startedAt}`;

/**
 * On a node: the shown background failed (its copy had not arrived) and its file has landed since
 * its last try. It tries again once for each landing, so a try that fails again never starts a
 * loop of tries. The slot to try again, or null.
 */
export function retryAfterLanding(shown: Slot | null, landed: number): string | null {
  return shown?.state === 'failed' && landed > (shown.attempt ?? 0) ? shown.key : null;
}

/**
 * A background that is ready goes on screen: dissolving in over the one there, when it came with a slide
 * that dissolves and that dissolve is not over at `at` (from where the slide began, or from `at` if it was
 * not ready then); otherwise at once.
 */
function arrive(slots: Slots, ready: Slot, at: number | undefined): Slots {
  const fade = ready.joined ? undefined : ready.layer.fade;
  if (fade && at !== undefined && at < fade.at + fade.durationMs)
    return {
      shown: ready,
      incoming: null,
      leaving: slots.shown?.state === 'ready' ? slots.shown : null,
      fade: { start: Math.max(fade.at, at), ms: fade.durationMs },
    };
  return { shown: ready, incoming: null, leaving: null, fade: null };
}

export function slotsReducer(slots: Slots, event: SlotEvent): Slots {
  switch (event.type) {
    case 'layer': {
      const { layer } = event;
      if (layer?.kind !== 'media') return NO_SLOTS;
      const key = slotKey(layer);
      // The same playback: new settings (fit, loop), and whatever was loading is not wanted any more.
      if (slots.shown?.key === key) return { ...slots, shown: { ...slots.shown, layer }, incoming: null };
      if (slots.incoming?.key === key) return { ...slots, incoming: { ...slots.incoming, layer } };
      // The picture going away is wanted again (Back during a dissolve): it comes back whole, at once.
      if (slots.leaving?.key === key)
        return { shown: { ...slots.leaving, layer }, incoming: null, leaving: null, fade: null };
      // Something new, loading out of sight. A dissolve still running carries on to its end, and the new
      // one follows it (Session 23): ended where it was, the picture stayed part-way through, dim.
      const shown = slots.shown?.state === 'ready' ? slots.shown : null;
      return {
        shown,
        incoming: { key, layer, state: 'loading', ...(event.joined ? { joined: true as const } : {}) },
        leaving: shown && slots.fade ? slots.leaving : null,
        fade: shown ? slots.fade : null,
      };
    }
    case 'ready': {
      const incoming = slots.incoming;
      if (incoming?.key !== event.key) return slots;
      const ready: Slot = { ...incoming, state: 'ready' };
      // A dissolve still on screen finishes first (the picture part-way through never jumps back up);
      // this one follows it ('faded').
      if (slots.fade) return { ...slots, incoming: ready };
      return arrive(slots, ready, event.at);
    }
    case 'faded': {
      if (slots.fade?.start !== event.start) return slots;
      const done = { ...slots, leaving: null, fade: null };
      // A background that became ready meanwhile comes now, from where that dissolve ended.
      return done.incoming?.state === 'ready'
        ? arrive(done, done.incoming, slots.fade.start + slots.fade.ms)
        : done;
    }
    case 'retry': {
      // Loading again out of sight; nothing is on screen meanwhile, as before.
      const failed = slots.shown?.key === event.key && slots.shown.state === 'failed' ? slots.shown : null;
      if (!failed) return slots;
      return {
        shown: null,
        incoming: { ...failed, state: 'loading', attempt: (failed.attempt ?? 0) + 1 },
        leaving: null,
        fade: null,
      };
    }
    case 'failed':
      // A file that cannot play replaces the old picture with nothing, as the show asked.
      if (slots.incoming?.key === event.key)
        return { shown: { ...slots.incoming, state: 'failed' }, incoming: null, leaving: null, fade: null };
      if (slots.shown?.key === event.key) return { ...slots, shown: { ...slots.shown, state: 'failed' } };
      return slots;
  }
}
