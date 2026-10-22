import type { EngineState } from './engine/state';
import type { SlideElement } from './model';

/*
 * The pictures and videos a show state draws (Session 13): what a node must
 * have copies of to show it, and what Main puts first in each node's list.
 * Sound is never needed on a node (Main's audio player makes all of it).
 */

function fromElements(elements: readonly SlideElement[], out: Set<string>): void {
  for (const e of elements) if (e.kind === 'image' || e.kind === 'video') out.add(e.mediaId);
}

/**
 * Every media id up now: drawn on the screens, or sounding on the audio layer (with the music's other
 * tracks). Media deleted from the library stays served while it is up (Session 26a).
 */
export function mediaUpNow(state: EngineState): Set<string> {
  const out = new Set(mediaInState(state).now);
  const audio = state.layers.audio;
  if (audio?.mediaId) out.add(audio.mediaId);
  for (const t of audio?.music?.tracks ?? []) out.add(t.mediaId);
  return out;
}

/** Media ids drawn now (`now`) and those Next would bring (`next`), each once, `now` first. */
export function mediaInState(state: EngineState): { now: string[]; next: string[] } {
  const now = new Set<string>();
  const bg = state.layers.background;
  if (bg?.kind === 'media') now.add(bg.mediaId);
  if (state.layers.slide) fromElements(state.layers.slide.slide.elements, now);
  for (const p of state.layers.props) fromElements(p.elements, now);
  // The picture-in-picture box's picture or video (Session 50); a video input or a window is no media.
  const box = state.layers.pip?.source;
  if (box?.kind === 'media') now.add(box.mediaId);
  if (state.logo) fromElements(state.logo.elements, now);
  for (const item of state.idle.items) if (item.kind === 'picture') now.add(item.mediaId);
  const next = new Set<string>();
  const n = state.next;
  if (n?.kind === 'slide') {
    fromElements(n.slide.elements, next);
    if (n.background) next.add(n.background.mediaId);
  } else if (n?.kind === 'media' && n.media !== 'audio') next.add(n.mediaId);
  for (const id of now) next.delete(id);
  return { now: [...now], next: [...next] };
}
