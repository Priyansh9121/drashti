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
    const layers = { ...next.layers };
    const bg = layers.background;
    if (bg?.kind === 'media' && bg.media === 'video')
      layers.background = { ...bg, mediaId: mapped('background', bg.mediaId, bg.startedAt) };
    const audio = layers.audio;
    if (audio?.mediaId) layers.audio = { ...audio, mediaId: mapped('audio', audio.mediaId, audio.startedAt) };
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
      layers.slide = {
        ...slide,
        slide: { ...slide.slide, elements, ...(deck && media ? { deck: { ...deck, media } } : {}) },
        ...(slide.clips ? { clips: remap(slide.clips, ids) as VideoClips } : {}),
        ...(slide.seeks ? { seeks: remap(slide.seeks, ids) as VideoSeeks } : {}),
      };
    }
    const box = layers.pip;
    if (box?.source.kind === 'media' && box.source.media === 'video') {
      const id = mapped('pip', box.source.mediaId, box.shownAt);
      const ids = new Map([[box.source.mediaId, id]]);
      layers.pip = {
        ...box,
        source: { ...box.source, mediaId: id },
        ...(box.clips ? { clips: remap(box.clips, ids) as VideoClips } : {}),
        ...(box.seeks ? { seeks: remap(box.seeks, ids) as VideoSeeks } : {}),
      };
    }
    return { state: { ...next, layers } };
  } catch (error) {
    return {
      message:
        error instanceof ProxyRefused
          ? error.message
          : 'The lighter playing copy could not be checked. Open Edit Video… and try again.',
    };
  }
}
