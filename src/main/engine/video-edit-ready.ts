import type { EngineState, VideoClips, VideoSeeks } from '../../shared/engine/state';
import type { VideoEditSnapshot, VideoEditRecipe } from '../../shared/video-edit';
import { playingNow } from '../../shared/engine/playing';
import { videoEditTimes } from '../../shared/video-edit-time';

export type VideoEditPreparation =
  { state: EngineState; message?: never } | { state?: never; message: string };
export interface VideoEditResolution {
  renditionOf(mediaId: string): { sourceId: string; recipe: VideoEditRecipe } | null;
  lengthOf(mediaId: string): number | null;
  available?(mediaId: string): boolean;
}

/** Resolve at the show boundary only. The renderer plays the immutable file with its ordinary clock. */
export function prepareVideoEdits(
  previous: EngineState,
  next: EngineState,
  read: (mediaId: string) => VideoEditSnapshot | null,
  restoring = false,
  resolution?: VideoEditResolution,
): VideoEditPreparation {
  if (restoring) return { state: next };
  const key = (p: ReturnType<typeof playingNow>[number], state: EngineState) =>
    `${p.ref.layer}/${p.mediaId}/${String(p.clock.startedAt)}/${p.ref.layer === 'slide' ? (state.layers.slide?.slide.id ?? '') : ''}`;
  const before = new Set(playingNow(previous).map((p) => key(p, previous)));
  const edits = new Map<string, { id: string; times: ReturnType<typeof videoEditTimes> }>();
  try {
    for (const p of playingNow(next)) {
      if (before.has(key(p, next)) || resolution?.renditionOf(p.mediaId)) continue;
      const edit = read(p.mediaId);
      if (!edit) continue;
      if (edit.state !== 'ready' || !edit.readyMediaId)
        return {
          message:
            edit.message ??
            'This video’s edited copy is still preparing. Wait until it is ready in Edit Video… before showing it.',
        };
      if (edit.readyMediaId === p.mediaId) continue;
      if (!resolution)
        return {
          message:
            'The edited video’s playing file is not available yet. Open Edit Video… and try Save again.',
        };
      if (resolution.available && !resolution.available(edit.readyMediaId))
        return { message: 'The edited video’s file is missing. Open Edit Video… and try Save again.' };
      const length = resolution.lengthOf(edit.mediaId);
      if (length === null)
        return { message: 'The source video’s length is unavailable. Open Edit Video… and save it again.' };
      edits.set(p.mediaId, { id: edit.readyMediaId, times: videoEditTimes(edit.recipe, length) });
    }
    if (edits.size === 0) return { state: next };
    const clips = (values: VideoClips | undefined): VideoClips | undefined =>
      values
        ? Object.fromEntries(
            Object.entries(values).map(([id, value]): [string, VideoClips[string]] => {
              const e = edits.get(id);
              return e ? [e.id, e.times.clip(value) ?? value] : [id, value];
            }),
          )
        : undefined;
    const seeks = (values: VideoSeeks | undefined): VideoSeeks | undefined =>
      values
        ? Object.fromEntries(
            Object.entries(values).map(([id, value]): [string, VideoSeeks[string]] => {
              const e = edits.get(id);
              return e ? [e.id, e.times.seek(value) ?? value] : [id, value];
            }),
          )
        : undefined;
    const layers = { ...next.layers };
    const bg = layers.background;
    if (bg?.kind === 'media' && bg.media === 'video') {
      const e = edits.get(bg.mediaId);
      if (e)
        layers.background = {
          ...bg,
          mediaId: e.id,
          durationMs: e.times.durationMs,
          ...(bg.clip ? { clip: e.times.clip(bg.clip) } : {}),
          ...(bg.seek ? { seek: e.times.seek(bg.seek) } : {}),
          ...(bg.marks ? { marks: e.times.marks(bg.marks) } : {}),
        };
    }
    const audio = layers.audio;
    const sound = audio?.mediaId ? edits.get(audio.mediaId) : null;
    if (audio && sound)
      layers.audio = {
        ...audio,
        mediaId: sound.id,
        durationMs: sound.times.durationMs,
        ...(audio.clip ? { clip: sound.times.clip(audio.clip) } : {}),
        ...(audio.seek ? { seek: sound.times.seek(audio.seek) } : {}),
        ...(audio.marks ? { marks: sound.times.marks(audio.marks) } : {}),
      };
    const slide = layers.slide;
    if (slide) {
      const elements = slide.slide.elements.map((el) =>
        el.kind === 'video' && edits.has(el.mediaId)
          ? { ...el, mediaId: edits.get(el.mediaId)?.id ?? el.mediaId }
          : el,
      );
      const deck = slide.slide.deck;
      const preparedDeck = deck
        ? {
            ...deck,
            media: deck.media.map((media) => {
              const edit = edits.get(media.mediaId);
              return edit
                ? { ...media, mediaId: edit.id, ...(media.clip ? { clip: edit.times.clip(media.clip) } : {}) }
                : media;
            }),
          }
        : undefined;
      layers.slide = {
        ...slide,
        slide: { ...slide.slide, elements, ...(preparedDeck ? { deck: preparedDeck } : {}) },
        ...(slide.clips ? { clips: clips(slide.clips) } : {}),
        ...(slide.seeks ? { seeks: seeks(slide.seeks) } : {}),
      };
    }
    const pip = layers.pip;
    if (pip?.source.kind === 'media' && pip.source.media === 'video') {
      const e = edits.get(pip.source.mediaId);
      if (e)
        layers.pip = {
          ...pip,
          source: { ...pip.source, mediaId: e.id },
          ...(pip.clips ? { clips: clips(pip.clips) } : {}),
          ...(pip.seeks ? { seeks: seeks(pip.seeks) } : {}),
        };
    }
    return { state: { ...next, layers } };
  } catch (error) {
    return {
      message:
        error instanceof Error && error.message.includes('row’s trim')
          ? error.message
          : 'The saved video edits could not be read. Open Edit Video… and save them again.',
    };
  }
}
