import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import type { PipLayer, PipPlace, PipSource } from '../../shared/engine/state';
import type { Movement } from '../../shared/looks';
import { DEFAULT_PIP_PLACE, pipSwapMs } from '../../shared/pip';
import type { VideoInput } from '../../shared/video-inputs';
import type { EngineAction } from './actions';
import { sameData } from './reducer';

/*
 * Picture in picture in the engine (Session 50). What the box holds is looked up by the main process, never
 * taken from a page: a video input in this computer's list, a window Show a Window… has just offered (Session
 * 48), a picture or video in Media, or the slides (the slide as designed, made small). A new box goes where the
 * library remembers (src/main/pip/); Swap and moving it keep how it was (`changed`), so every screen animates
 * from there alike (moved while a swap runs, it keeps the swap's: Session 52); Take off plays its out (`pipOff`).
 * Clear all, Put it back and black-out are the engine's own, as for every layer.
 *
 * Swap: `swapped` says which picture is the main one, and the screens draw from it.
 * - The slides in the box: unswapped, the main picture shows the background (with the props, messages and
 *   ticker) without the slide, and the slide is in the box; swapped, the slide shows full as usual and the
 *   background goes in the box.
 * - A video input, media or a window in the box: unswapped, it is in the box over the show as usual; swapped,
 *   it fills the background's place (under the slide and everything else) and the background goes in the box.
 */

type Refused = Extract<CommandResult, { ok: false }>;
/** What the operator asks the box to hold (shared/engine/commands.ts). */
export type PipChoice = Extract<EngineCommand, { type: 'showPip' }>['source'];
export type PipResolved = { ok: true; actions: EngineAction[] } | Refused;

/** Where the engine looks up what a box may hold, and where a new one goes (show-engine.ts EngineOptions). */
export interface PipLookups {
  mediaKind?: (mediaId: string) => 'image' | 'video' | 'audio' | null;
  /** A video input in this computer's list (Session 50), the same lookup showInput uses. */
  videoInput?: (inputId: string) => Pick<VideoInput, 'name' | 'device'> | null;
  windows?: (id: string) => { sourceId: string; name: string } | null;
  pipPlace?: () => PipPlace;
}

/** The box's picture for a choice, as the main process's own lists have it; or why there is none. */
export function pipSourceFor(
  choice: PipChoice,
  lookups: PipLookups,
): { ok: true; source: PipSource } | Refused {
  switch (choice.kind) {
    case 'slides':
      return { ok: true, source: { kind: 'slides' } };
    case 'media': {
      const kind = lookups.mediaKind?.(choice.mediaId) ?? null;
      if (kind === 'image' || kind === 'video')
        return { ok: true, source: { kind: 'media', mediaId: choice.mediaId, media: kind } };
      return kind === 'audio'
        ? { ok: false, error: 'not-playable', message: 'A sound has no picture to show in the box.' }
        : { ok: false, error: 'unknown-item', message: 'That picture or video is not in Media any more.' };
    }
    case 'input': {
      const input = lookups.videoInput?.(choice.inputId) ?? null;
      return input
        ? {
            ok: true,
            source: { kind: 'input', inputId: choice.inputId, name: input.name, device: input.device },
          }
        : { ok: false, error: 'unknown-input', message: 'That video input is not in the list any more.' };
    }
    case 'window': {
      const window = lookups.windows?.(choice.id) ?? null;
      return window
        ? { ok: true, source: { kind: 'window', sourceId: window.sourceId, name: window.name } }
        : {
            ok: false,
            error: 'unknown-item',
            message: 'That window is not in the list any more. Choose it again.',
          };
    }
  }
}

/** The box as it is, changed at `at`: how it was goes with it, for the animation. */
const changedAt = (
  was: PipLayer,
  at: number,
  to: Partial<Pick<PipLayer, 'place' | 'swapped'>>,
): PipLayer => ({
  ...was,
  ...to,
  changed: { at, place: was.place, swapped: was.swapped },
});

/**
 * Put a box up with this picture, at `place` (else where the box up now is, else where the library remembers).
 * The same picture again stays as it is (moved, when a place is given: its video carries on); another picture
 * is a box of its own from `at`, its in played and its video from the start, unswapped.
 */
export function showPip(
  was: PipLayer | null,
  choice: PipChoice,
  place: PipPlace | undefined,
  at: number,
  lookups: PipLookups,
): PipResolved {
  const found = pipSourceFor(choice, lookups);
  if (!found.ok) return found;
  const where = place ?? was?.place ?? lookups.pipPlace?.() ?? DEFAULT_PIP_PLACE;
  if (was && sameData(was.source, found.source))
    return sameData(was.place, where)
      ? { ok: true, actions: [] }
      : { ok: true, actions: [{ type: 'pip/set', layer: changedAt(was, at, { place: where }) }] };
  const layer: PipLayer = { source: found.source, place: where, swapped: false, shownAt: at };
  return { ok: true, actions: [{ type: 'pip/set', layer }] };
}

const noPip = (doing: string): Refused => ({
  ok: false,
  error: 'no-pip',
  message: `No picture in picture is on the screens to ${doing}.`,
});

/**
 * A swap still running on any screen at `at` (Session 51): it runs out and in again by each group's Movement
 * (`movements`: the live Look's), so as long as the slowest group's: 500 ms, 600 ms with a Bold group
 * (shared/pip.ts pipSwapMs).
 */
function swapRunning(was: PipLayer, at: number, movements: readonly Movement[]): boolean {
  const last = was.changed;
  return last !== undefined && last.swapped !== was.swapped && at - last.at < pipSwapMs(movements);
}

/**
 * Swap: the box's picture and the main picture change places (see above), from `at`. Pressed again while a swap
 * still runs on any screen (Session 51), it changes nothing: the box and the main picture would jump back
 * part-way.
 */
export function swapPip(was: PipLayer | null, at: number, movements: readonly Movement[] = []): PipResolved {
  if (!was) return noPip('swap');
  if (swapRunning(was, at, movements)) return { ok: true, actions: [] };
  return { ok: true, actions: [{ type: 'pip/set', layer: changedAt(was, at, { swapped: !was.swapped }) }] };
}

/**
 * The box moved or resized (a corner, dragged, its size, border, corners or motion), from `at`. While a swap still
 * runs on any screen (Session 52), the swap plays on: the box takes its new place at once and keeps the swap's
 * `changed`, so the main picture's dissolve and the box's own pictures carry on (taken as a move, both would cut).
 */
export function placePip(
  was: PipLayer | null,
  place: PipPlace,
  at: number,
  movements: readonly Movement[] = [],
): PipResolved {
  if (!was) return noPip('move');
  if (sameData(was.place, place)) return { ok: true, actions: [] };
  const layer = swapRunning(was, at, movements) ? { ...was, place } : changedAt(was, at, { place });
  return { ok: true, actions: [{ type: 'pip/set', layer }] };
}

/** Take off: off the screens, its out from `at`; nothing up, nothing changes. */
export function hidePip(was: PipLayer | null, at: number): PipResolved {
  return { ok: true, actions: was ? [{ type: 'pip/hide', at }] : [] };
}

/**
 * The box restart recovery puts back (recovery/live-state.ts): the slides or media as it was, still (its video
 * carrying on from when it went up); a video input while it is still in this computer's list, as the list names
 * it now (whether its camera is there, the screens then say: src/main/video-inputs/); never a window (it may be
 * gone, or be another window now), only named. A video input no longer in the list is named too (`inputGone`,
 * Session 51), as the background's is. What it was animating is not put back.
 */
export function restoredPip(
  saved: PipLayer | null,
  lookups: PipLookups,
): { layer: PipLayer | null; window: string | null; inputGone: string | null } {
  if (!saved) return { layer: null, window: null, inputGone: null };
  const { changed: _animating, ...still } = saved;
  const source = saved.source;
  if (source.kind === 'window') return { layer: null, window: source.name, inputGone: null };
  if (source.kind !== 'input') return { layer: still, window: null, inputGone: null };
  const input = lookups.videoInput?.(source.inputId) ?? null;
  if (!input) return { layer: null, window: null, inputGone: source.name };
  return {
    layer: { ...still, source: { ...source, name: input.name, device: input.device } },
    window: null,
    inputGone: null,
  };
}

/** The media a box taken off still draws while its out plays, so it keeps its look (Session 26e); or null. */
export function leavingMedia(off: { layer: PipLayer } | null): string | null {
  const source = off?.layer.source;
  return source?.kind === 'media' ? source.mediaId : null;
}
