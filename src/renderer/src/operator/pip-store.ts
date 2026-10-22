import { create } from 'zustand';
import type { PipLayer, PipPlace, PipSource } from '../../../shared/engine/state';
import type { MediaSummary } from '../../../shared/playlists';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import { useEngine } from '../engine/engine-store';
import { pipName } from '../render/pip';

/*
 * Picture in picture in the operator window (Session 50): its dialog (Picture in Picture…, in the library's
 * Media tools beside Show a Window…, Pro Mode), the box's place as the library remembers it for next time, and
 * what the box holds in words. The box itself is the engine's (layers.pip): showPip, hidePip, swapPip, placePip.
 */

export const usePipUi = create<{ open: boolean }>(() => ({ open: false }));

export function openPipDialog(): void {
  usePipUi.setState({ open: true });
}

export function closePipDialog(): void {
  usePipUi.setState({ open: false });
}

/** Where a new box goes and how it looks, as the library remembers it (Drashti's own when it can't be read). */
export async function rememberedPlace(): Promise<PipPlace> {
  try {
    return await window.drashti.pip.place();
  } catch {
    return DEFAULT_PIP_PLACE;
  }
}

const NOT_KEPT = 'Drashti could not keep where the box goes for next time: set it again before the next box.';

/**
 * The box's place or look changed (in the dialog, or dragged in LIVE): on the screens at once while a box is up,
 * and remembered for the next one. What went wrong, in words, or null.
 */
export async function placeBox(place: PipPlace): Promise<string | null> {
  if (useEngine.getState().state?.layers.pip) {
    const moved = await window.drashti.engine.dispatch({ type: 'placePip', place });
    if (!moved.ok) return moved.message;
  }
  try {
    const saved = await window.drashti.pip.savePlace(place);
    return saved.ok ? null : saved.message;
  } catch {
    return NOT_KEPT;
  }
}

/** What the box holds, in words: a picture's or video's own name from Media, once the window has the list. */
export function boxName(source: PipSource, media: readonly MediaSummary[]): string {
  if (source.kind === 'media') return media.find((m) => m.id === source.mediaId)?.name ?? pipName(source);
  return pipName(source);
}

/** Where the two pictures are, in words (Swap changes them over). */
export function boxWhere(box: PipLayer, name: string): string {
  if (box.source.kind === 'slides')
    return box.swapped
      ? 'Swapped: the slides are full on the screens, the background small in the box.'
      : 'The slides are small in the box; the main picture shows the background.';
  return box.swapped
    ? `Swapped: ${name} is full on the screens, the screens’ own picture small in the box.`
    : `${name} is small in the box; the main picture is as it was.`;
}
