import type { BackgroundLayer, InputBackground } from '../../../shared/engine/state';

/*
 * Which background images and videos an output keeps while the background
 * changes. The one on screen stays until the next one has its first frame,
 * so changing background never flashes black; clearing is immediate. A
 * background that a dissolving slide brings dissolves in over the old one
 * once it is ready. A video input (Session 50) comes and goes the same way, as a video does.
 */

export type MediaLayer = Extract<BackgroundLayer, { kind: 'media' }>;

/** What a slot shows: an image or a video from the library, or a video input, live (Session 50). */
export type SlotLayer = MediaLayer | InputBackground;

export interface Slot {
  /** One playback: a file (or an input) and when it started. The same key is the same playback, carrying on. */
  key: string;
  layer: SlotLayer;
  state: 'loading' | 'ready' | 'failed';
  /** How many times it has been tried again (a node's copy that landed late); left out the first time. */
  attempt?: number;
  /**
   * It had its first frame here and failed while it played (Q60-31): drawn as it was, never black, until the show
   * takes it off (the page has told Main) or the next background has its first frame.
   */
  drawn?: true;
  /**
   * The first background a window heard of, as it opened (Session 23): shown whole, never faded in
   * from black, even part-way through the slide's dissolve.
   */
  joined?: true;
}

/** A slot of a file from the library, or of a video input (Session 50). */
export type MediaSlot = Slot & { layer: MediaLayer };
export type InputSlot = Slot & { layer: InputBackground };
export const isMediaSlot = (slot: Slot): slot is MediaSlot => slot.layer.kind === 'media';
export const isInputSlot = (slot: Slot): slot is InputSlot => slot.layer.kind === 'input';

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

/** Whether a slot draws: ready, or failed while it played (drawn as it was until it is taken off). */
export const isDrawn = (slot: Slot): boolean => slot.state === 'ready' || slot.drawn === true;

/** The background drawn on screen now, by its key (null: none, the screen's nothing-up showing instead). */
export const drawnKeyOf = (slots: Slots): string | null =>
  slots.shown && isDrawn(slots.shown) ? slots.shown.key : null;

/**
 * A file that failed (as it loaded: the one coming in; or while it played: the one on screen), if one did; none while
 * the one on screen is being tried again (out of sight).
 */
const failedFile = (slots: Slots): Slot | null => {
  const coming = slots.incoming;
  if (coming?.state === 'failed' && coming.layer.kind === 'media') return coming;
  if (coming !== null && coming.key === slots.shown?.key) return null;
  return slots.shown?.state === 'failed' && slots.shown.layer.kind === 'media' ? slots.shown : null;
};

export const slotKey = (layer: SlotLayer): string =>
  layer.kind === 'input'
    ? `input:${layer.inputId}@${layer.startedAt}`
    : `${layer.mediaId}@${layer.startedAt}`;

/**
 * On a node: the background failed (its copy had not arrived) and its file has landed since its last try; or a GPU
 * process stopped and another started (Sessions 31–36). It tries again once for each landing, so a try that fails
 * again never starts a loop of tries. The slot to try again, or null.
 */
export function retryAfterLanding(slots: Slots, landed: number): string | null {
  const failed = failedFile(slots);
  return failed !== null && landed > (failed.attempt ?? 0) ? failed.key : null;
}

/**
 * A background that is ready goes on screen: dissolving in over the one there, when it came with a slide
 * that dissolves and that dissolve is not over at `at` (from where the slide began, or from `at` if it was
 * not ready then); otherwise at once. A video input's capture takes a moment to open (Session 50), the picture
 * before it staying meanwhile: it dissolves in from when it is ready, however late, never cut in.
 */
function arrive(slots: Slots, ready: Slot, at: number | undefined): Slots {
  const fade = ready.joined ? undefined : ready.layer.fade;
  if (fade && at !== undefined && (ready.layer.kind === 'input' || at < fade.at + fade.durationMs))
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
      if (layer?.kind !== 'media' && layer?.kind !== 'input') return NO_SLOTS;
      const key = slotKey(layer);
      // The same playback: new settings (fit, loop), and whatever was loading is not wanted any more.
      if (slots.shown?.key === key) return { ...slots, shown: { ...slots.shown, layer }, incoming: null };
      if (slots.incoming?.key === key) return { ...slots, incoming: { ...slots.incoming, layer } };
      // The picture going away is wanted again (Back during a dissolve): it comes back whole, at once.
      if (slots.leaving?.key === key)
        return { shown: { ...slots.leaving, layer }, incoming: null, leaving: null, fade: null };
      // Something new, loading out of sight. A dissolve still running carries on to its end, and the new
      // one follows it (Session 23): ended where it was, the picture stayed part-way through, dim. One that failed
      // while it played stays drawn as it was until the new one is ready (Q60-31).
      const shown = slots.shown && isDrawn(slots.shown) ? slots.shown : null;
      return {
        shown,
        incoming: { key, layer, state: 'loading', ...(event.joined ? { joined: true as const } : {}) },
        leaving: shown && slots.fade ? slots.leaving : null,
        fade: shown ? slots.fade : null,
      };
    }
    case 'ready': {
      // A video input that could not start has started (Session 50: plugged in again): on at once, as nothing
      // was on screen for it meanwhile. A file that could not play stays so (a node's copy landing retries it).
      const failed = slots.shown;
      if (failed?.key === event.key && failed.state === 'failed' && failed.layer.kind === 'input')
        return { ...slots, shown: { ...failed, state: 'ready' } };
      const incoming = slots.incoming;
      if (incoming?.key !== event.key) return slots;
      // A file that could not play stays as it is: only a node's copy landing (or a new GPU process) tries it again.
      if (incoming.state === 'failed' && incoming.layer.kind === 'media') return slots;
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
      // One that failed as it loaded loads again out of sight, the picture before still drawn (Q60-31).
      const coming = slots.incoming;
      if (coming?.key === event.key && coming.state === 'failed')
        return { ...slots, incoming: { ...coming, state: 'loading', attempt: (coming.attempt ?? 0) + 1 } };
      const failed = slots.shown?.key === event.key && slots.shown.state === 'failed' ? slots.shown : null;
      // Not failed, or already being tried again.
      if (!failed || coming?.key === event.key) return slots;
      const retry: Slot = {
        key: failed.key,
        layer: failed.layer,
        state: 'loading',
        attempt: (failed.attempt ?? 0) + 1,
        ...(failed.joined ? { joined: true as const } : {}),
      };
      // One that failed while it played, drawn as it was (Q60-31): tried again out of sight, still drawn meanwhile,
      // never black. One never drawn (an input that could not start, say) is tried again in its place, as before.
      if (failed.drawn) return { ...slots, incoming: retry };
      return { shown: null, incoming: retry, leaving: null, fade: null };
    }
    case 'failed': {
      // A file that cannot play as it loads (Q60-31): the picture before stays drawn, never black; the page tells
      // Main, which takes the file off (BackgroundMedia.tsx). A video input that cannot start shows nothing, as before.
      const incoming = slots.incoming;
      if (incoming?.key === event.key) {
        if (incoming.layer.kind === 'media') return { ...slots, incoming: { ...incoming, state: 'failed' } };
        return { shown: { ...incoming, state: 'failed' }, incoming: null, leaving: null, fade: null };
      }
      // One that fails while it plays stays drawn as it was until it is taken off (never black meanwhile).
      const shown = slots.shown;
      if (shown?.key === event.key)
        return {
          ...slots,
          shown: {
            ...shown,
            state: 'failed',
            ...(shown.state === 'ready' && shown.layer.kind === 'media' ? { drawn: true as const } : {}),
          },
        };
      return slots;
    }
  }
}
