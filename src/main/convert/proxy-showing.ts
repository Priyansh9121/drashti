import type { EngineState, VideoClips, VideoSeeks } from '../../shared/engine/state';
import { playingNow } from '../../shared/engine/playing';
export type ProxyShowingResult = { state: EngineState; message?: never } | { state?: never; message: string };
class ProxyRefused extends Error {}
/** Called after saved edit resolution; proxy time is identical to its full-quality rendition. */
export function prepareVideoProxies(
  previous: EngineState,
  next: EngineState,
  ready: (id: string) => { mediaId: string | null; message: string | null },
  restoring = false,
): ProxyShowingResult {
  if (restoring) return { state: next };
  const key = (layer: string, id: string, at: number | undefined, slide = '') =>
    `${layer}/${id}/${String(at)}/${slide}`;
  const pinned = new Set(
    playingNow(previous).map((p) =>
      key(
        p.ref.layer,
        p.mediaId,
        p.clock.startedAt,
        p.ref.layer === 'slide' ? previous.layers.slide?.slide.id : '',
      ),
    ),
  );
  const mapped = (layer: string, id: string, at: number | undefined, slide = '') => {
    if (pinned.has(key(layer, id, at, slide))) return id;
    const selected = ready(id);
    if (!selected.mediaId)
      throw new ProxyRefused(
        selected.message ??
          'The lighter playing copy is preparing. Wait for it in Edit Video… before showing the video.',
      );
    return selected.mediaId;
  };
  const remap = <T>(
    values: Record<string, T> | undefined,
    ids: Map<string, string>,
  ): Record<string, T> | undefined =>
    values
      ? Object.fromEntries(Object.entries(values).map(([id, value]) => [ids.get(id) ?? id, value]))
      : undefined;
  try {
    // Only a layer whose file changes is copied, and the very state comes back when none does: the engine reads new
    // layers as a change of the screens (Back, Put it back and Oops would count a cover as one; the second mid-way CI).
    const layers = { ...next.layers };
    let changed = false;
    const bg = layers.background;
    if (bg?.kind === 'media' && bg.media === 'video') {
      // S5 supplies this trusted prior cue; its initial private background has a NEW cue id.
      const cue = (
        previous as EngineState & {
          videoCue?: { id: string; background: { mediaId: string } } | null;
        }
      ).videoCue;
      const held = cue && 'cueId' in bg && bg.cueId === cue.id && bg.mediaId === cue.background.mediaId;
      const id = held ? bg.mediaId : mapped('background', bg.mediaId, bg.startedAt);
      if (id !== bg.mediaId) {
        layers.background = { ...bg, mediaId: id };
        changed = true;
      }
    }
    const audio = layers.audio;
    if (audio?.mediaId) {
      const id = mapped('audio', audio.mediaId, audio.startedAt);
      if (id !== audio.mediaId) {
        layers.audio = { ...audio, mediaId: id };
        changed = true;
      }
    }
    const slide = layers.slide;
    if (slide) {
      const ids = new Map<string, string>();
      const select = (id: string) => {
        if (!ids.has(id)) ids.set(id, mapped('slide', id, slide.shownAt, slide.slide.id));
        return ids.get(id) ?? id;
      };
      const elements = slide.slide.elements.map((el) =>
        el.kind === 'video' ? { ...el, mediaId: select(el.mediaId) } : el,
      );
      const deck = slide.slide.deck;
      const media = deck?.media.map((item) =>
        item.kind === 'video' ? { ...item, mediaId: select(item.mediaId) } : item,
      );
      if ([...ids].some(([from, to]) => from !== to)) {
        layers.slide = {
          ...slide,
          slide: { ...slide.slide, elements, ...(deck && media ? { deck: { ...deck, media } } : {}) },
          ...(slide.clips ? { clips: remap(slide.clips, ids) as VideoClips } : {}),
          ...(slide.seeks ? { seeks: remap(slide.seeks, ids) as VideoSeeks } : {}),
        };
        changed = true;
      }
    }
    const box = layers.pip;
    if (box?.source.kind === 'media' && box.source.media === 'video') {
      const id = mapped('pip', box.source.mediaId, box.shownAt);
      if (id !== box.source.mediaId) {
        const ids = new Map([[box.source.mediaId, id]]);
        layers.pip = {
          ...box,
          source: { ...box.source, mediaId: id },
          ...(box.clips ? { clips: remap(box.clips, ids) as VideoClips } : {}),
          ...(box.seeks ? { seeks: remap(box.seeks, ids) as VideoSeeks } : {}),
        };
        changed = true;
      }
    }
    return { state: changed ? { ...next, layers } : next };
  } catch (error) {
    return {
      message:
        error instanceof ProxyRefused
          ? error.message
          : 'The lighter playing copy could not be checked. Open Edit Video… and try again.',
    };
  }
}
