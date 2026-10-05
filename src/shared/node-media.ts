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

/** Media ids drawn now (`now`) and those Next would bring (`next`), each once, `now` first. */
export function mediaInState(state: EngineState): { now: string[]; next: string[] } {
  const now = new Set<string>();
  const bg = state.layers.background;
  if (bg?.kind === 'media') now.add(bg.mediaId);
  if (state.layers.slide) fromElements(state.layers.slide.slide.elements, now);
  for (const p of state.layers.props) fromElements(p.elements, now);
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
