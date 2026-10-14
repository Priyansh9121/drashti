import type { PresentationDoc, SlideInfo } from '../../shared/library';
import type { RenderSlide } from '../../shared/model';
import type { RepeatSettings } from '../../shared/repeat';
import { repeatPlaylistOf, repeatPresentationId } from '../../shared/repeat';
import type { PlayItem } from '../engine/playlist-source';
import type { PlayedSlide, PlayOrder, SlideSource } from '../engine/slide-source';

/*
 * A Repeat Slides playlist as the slides it goes round (Session 26d;
 * shared/repeat.ts): played as one presentation of its own,
 * `repeat:<playlistId>`, so the engine's auto-advance times every step on
 * every screen at once and goes back to the first after the last.
 *
 * Its steps, in the playlist's order: each picture, and each slide of each
 * presentation (a deck's pages, a kirtan's slides, a passage's) in the order
 * it plays. Each is up for the playlist's seconds and comes on by its
 * transition; their own transitions, cues and macros are left out, so what
 * goes round is only the slides. Headers, placeholders and anything gone
 * are stepped over, as are videos and sounds (a Repeat Slides playlist
 * refuses them; one already there plays elsewhere).
 */

export interface RepeatSlidesDeps {
  /** A Repeat Slides playlist's name and settings, or null when it is not one (or is deleted). */
  playlist(playlistId: string): { name: string; settings: RepeatSettings } | null;
  /** Its items, as the engine plays playlist items. */
  items(playlistId: string): readonly PlayItem[] | null;
  /** The library's presentations and passages, in their orders. */
  slides: SlideSource;
}

/** A picture as a slide of its own: the whole screen, fitted. */
function pictureSlide(id: string, mediaId: string): RenderSlide {
  return {
    id,
    width: 1920,
    height: 1080,
    background: null,
    elements: [
      { id: 'picture', kind: 'image', frame: { x: 0, y: 0, width: 1920, height: 1080 }, mediaId, fit: 'fit' },
    ],
  };
}

interface Part {
  itemId: string;
  label: string;
  steps: PlayedSlide[];
}

export class RepeatSlides {
  constructor(private readonly deps: RepeatSlidesDeps) {}

  /** The playlist's steps, item by item; null when it is not a Repeat Slides playlist. */
  private parts(playlistId: string): { name: string; settings: RepeatSettings; parts: Part[] } | null {
    const playlist = this.deps.playlist(playlistId);
    const items = playlist ? this.deps.items(playlistId) : null;
    if (!playlist || !items) return null;
    const ms = Math.round(playlist.settings.secondsEach * 1000);
    const step = (id: string, slide: RenderSlide, notes: string): PlayedSlide => ({
      id,
      slide: { ...slide, id },
      cues: [],
      notes,
      transition: null,
      autoAdvanceMs: ms,
      macroId: null,
    });
    const parts: Part[] = [];
    for (const item of items) {
      if (item.kind === 'media') {
        if (item.media === 'image')
          parts.push({
            itemId: item.id,
            label: item.label,
            steps: [step(`${item.id}/picture`, pictureSlide(`${item.id}/picture`, item.mediaId), '')],
          });
        continue;
      }
      if (item.kind !== 'presentation') continue;
      const order = this.deps.slides.order(item.presentationId, item.arrangementId);
      if (!order || order.slides.length === 0) continue;
      parts.push({
        itemId: item.id,
        label: item.label ?? '',
        steps: order.slides.map((s, i) => step(`${item.id}/${String(i)}`, s.slide, s.notes)),
      });
    }
    return { name: playlist.name, settings: playlist.settings, parts };
  }

  /** `repeat:<playlistId>`'s steps in order, going round; null for any other id. */
  order(presentationId: string): PlayOrder | null {
    const playlistId = repeatPlaylistOf(presentationId);
    const built = playlistId === null ? null : this.parts(playlistId);
    if (!built) return null;
    return {
      arrangementId: null,
      slides: built.parts.flatMap((p) => p.steps),
      transition: built.settings.transition,
      loop: true,
    };
  }

  /** The steps as a presentation for the slide grid: a group for each picture or presentation. */
  doc(presentationId: string): PresentationDoc | null {
    const playlistId = repeatPlaylistOf(presentationId);
    const built = playlistId === null ? null : this.parts(playlistId);
    if (!built || playlistId === null) return null;
    let index = 0;
    return {
      id: repeatPresentationId(playlistId),
      name: built.name,
      width: 1920,
      height: 1080,
      groups: built.parts.map((p) => ({
        id: p.itemId,
        name: p.label,
        color: null,
        slides: p.steps.map((s): SlideInfo => ({
          id: s.id,
          index: index++,
          label: '',
          notes: s.notes,
          slide: s.slide,
          cues: [],
          transition: null,
          autoAdvanceMs: s.autoAdvanceMs ?? null,
          macroId: null,
        })),
      })),
      arrangements: [],
      selectedArrangementId: null,
      transition: built.settings.transition,
      loop: true,
      kirtan: null,
      source: null,
      repeat: { playlistId },
    };
  }
}
