import { useMemo } from 'react';
import { stepOf } from '../../../../shared/deck-show';
import type { EngineState } from '../../../../shared/engine/state';
import { backgroundCueOf } from '../../../../shared/library';
import { groupLookIn } from '../../../../shared/looks';
import type { OrderedSlide } from '../../../../shared/order';
import { useEngine } from '../../engine/engine-store';
import { OBJECT_FIT } from '../../render/media-style';
import { Looked, ScreenPictures } from '../../render/picture-looks';
import { PreviewPicture } from '../../render/previews';
import { Scene } from '../../render/Scene';
import { SlideView } from '../../render/SlideView';
import { useRemote } from '../remote/remote-store';
import { DeckStepDrawn } from './DeckStepPage';
import { DeviceSound, DeviceVideoControls, DeviceVideoPicture, SOUND_PAGE } from './DeviceVideo';
import { frameInCanvas, frameInSlide, frameOfBackground, keptFraming, phoneZoomTarget } from './live-zoom';
import { setPageSize, useViewer, type ViewerPage } from './viewer-store';

/*
 * The pages a phone or tablet looks at (Session 54, D1): what the screens show now, a presentation's slides in
 * their order (a PDF's or a deck's pages among them), a picture and a video; and (D3) a sound of a playlist
 * shared with phones. Each says how it is drawn, and (D2) when it is what the screens show and where the picture
 * the live zoom zooms is in it. Pictures are drawn as the phones draw them (render/previews.tsx): at the size they
 * are drawn, sharper as they are zoomed.
 */

/** The hall's picture as the remote draws it (the screens' canvas). */
export const CANVAS = { width: 1920, height: 1080 };

/** What is on the screens now, by when it came up: the zoom starts again from the whole when it changes. */
const showingNow = (state: EngineState | null): string => {
  const bg = state?.layers.background;
  return `${String(state?.layers.slide?.shownAt ?? '')}|${bg?.kind === 'media' ? String(bg.startedAt) : ''}`;
};

/** The hall's picture now, as the remote's live picture draws it, its pictures as kept and never zoomed live. */
function ScreensNow() {
  const state = useEngine((s) => s.state);
  const groupId = useRemote((s) => s.hall?.groupId ?? null);
  const look = groupLookIn(state?.look, groupId);
  // This device's own zoom is the whole difference from the kept look (D2), so the live zoom is left out.
  const drawn = useMemo(() => (state ? { ...state, liveZoom: null } : null), [state]);
  return drawn ? <Scene state={drawn} canvas={CANVAS} scaling="fit" look={look} /> : null;
}

/** What the screens show now, larger and sharp, zoomed on this device; and (D2) put on the screens. */
export function screensPage(): ViewerPage {
  return {
    key: 'screens',
    title: 'On the screens',
    size: CANVAS,
    draw: () => <ScreensNow />,
    showing: showingNow,
    live: (state) => state !== null && (state.layers.slide !== null || state.layers.background !== null),
    onScreens: (state) => {
      const target = phoneZoomTarget(state);
      const frame = frameInCanvas(state, CANVAS);
      return target && frame ? { frame, kept: keptFraming(state, target.mediaId) } : null;
    },
  };
}

/** A slide as the phones draw slides: its background cue's picture behind it, its pictures as kept. */
function SlideDrawn({ s }: { s: OrderedSlide }) {
  const pictures = useEngine((st) => st.state?.pictures);
  const screen = useMemo(() => ({ pictures: pictures ?? {}, liveZoom: null }), [pictures]);
  const bg = backgroundCueOf(s.slide.cues);
  return (
    <ScreenPictures.Provider value={screen}>
      <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
        {bg?.background.kind === 'media' && (
          <PreviewPicture
            mediaId={bg.background.mediaId}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        <div style={{ position: 'absolute', inset: 0 }}>
          <SlideView slide={s.slide.slide} media="still" />
        </div>
      </div>
    </ScreenPictures.Provider>
  );
}

/** Whether the screens show this slide now (its presentation, its place in the order, and the slide itself). */
const slideUp = (state: EngineState | null, presentationId: string, s: OrderedSlide): boolean => {
  const up = state?.layers.slide;
  return (
    up?.presentationId === presentationId &&
    up.slideIndex === s.position &&
    (up.slide.id === s.slide.slide.id || up.slide.id === s.slide.id)
  );
};

/** A slide's name, as its thumbnail on the remote says it. */
export const slideTitle = (s: OrderedSlide): string =>
  `${String(s.position + 1)} · ${s.slide.label || s.group.name}`;

/** One slide of a presentation, to look through on this device (a deck's or a PDF's page is one too). */
export function slidePage(presentationId: string, s: OrderedSlide): ViewerPage {
  return {
    key: `slide:${presentationId}:${String(s.position)}:${s.slide.id}`,
    title: slideTitle(s),
    size: { width: s.slide.slide.width, height: s.slide.slide.height },
    draw: () => <SlideDrawn s={s} />,
    live: (state) => slideUp(state, presentationId, s),
    onScreens: (state) => {
      if (!slideUp(state, presentationId, s)) return null;
      // Its own picture only: never the background behind a slide of words (D2 review).
      const target = phoneZoomTarget(state);
      const frame = frameInSlide(state);
      return target && frame ? { frame, kept: keptFraming(state, target.mediaId) } : null;
    },
  };
}

/** A deck's slide (Session 54, C2), one step of it: its motion played once on this device, then its last frame. */
function deckStepPage(presentationId: string, s: OrderedSlide, index: number, steps: number): ViewerPage {
  // The screens show this slide at this step: what LIVE calls its click (step 0 is the slide coming in).
  const stepUp = (state: EngineState | null) => {
    const layer = state?.layers.slide;
    return (
      slideUp(state, presentationId, s) && layer !== undefined && layer !== null && stepOf(layer) === index
    );
  };
  const named = slideTitle(s);
  return {
    key: `slide:${presentationId}:${String(s.position)}:${s.slide.id}:step:${String(index)}`,
    title: index === 0 ? named : `${named} · click ${String(index)} of ${String(steps - 1)}`,
    size: { width: s.slide.slide.width, height: s.slide.slide.height },
    draw: () => <DeckStepDrawn s={s} index={index} />,
    live: stepUp,
    onScreens: (state) => {
      if (!stepUp(state)) return null;
      const target = phoneZoomTarget(state);
      const frame = frameInSlide(state);
      return target && frame ? { frame, kept: keptFraming(state, target.mediaId) } : null;
    },
  };
}

/**
 * A slide looked through on this device: its page, or a deck's slide's pages, one for each step (D1/D2 review), so
 * Next and Previous go click by click as the deck does.
 */
export function slidePages(presentationId: string, s: OrderedSlide): ViewerPage[] {
  const steps = s.slide.slide.deck?.steps.length ?? 0;
  if (steps === 0) return [slidePage(presentationId, s)];
  return Array.from({ length: steps }, (_, index) => deckStepPage(presentationId, s, index, steps));
}

/**
 * A presentation's slides as the pages looked through, and the page to start at: the slide at `from` in the order,
 * at `step` (the click the screens show of it) where it is a deck's, else its first page.
 */
export function presentationPages(
  presentationId: string,
  slides: readonly OrderedSlide[],
  from: number,
  step: number | null,
): { pages: ViewerPage[]; start: number } {
  const pages: ViewerPage[] = [];
  let start = 0;
  for (const s of slides) {
    const own = slidePages(presentationId, s);
    if (s.position === from) start = pages.length + Math.min(Math.max(0, step ?? 0), own.length - 1);
    pages.push(...own);
  }
  return { pages, start };
}

/** Whether the screens' background is this picture or video now. */
const backgroundIs = (state: EngineState | null, mediaId: string): boolean => {
  const bg = state?.layers.background;
  return bg?.kind === 'media' && bg.mediaId === mediaId;
};

/** A picture filling its page, which takes the picture's own shape once it has loaded. */
function PictureDrawn({ mediaId, pageKey }: { mediaId: string; pageKey: string }) {
  const bg = useEngine((st) => st.state?.layers.background ?? null);
  const pictures = useEngine((st) => st.state?.pictures);
  const own = useViewer((v) => v.sizes[pageKey] ?? null);
  const screen = useMemo(() => ({ pictures: pictures ?? {}, liveZoom: null }), [pictures]);
  const onSize = (natural: { width: number; height: number }) => {
    setPageSize(pageKey, { width: 1920, height: Math.round((1920 * natural.height) / natural.width) });
  };
  // The background on the screens, its shape known: drawn as they draw it (D1/D2 review), its kept look over their
  // frame (the canvas, the picture fitted into it, here over the picture's own shape), never the live zoom, so this
  // device's own zoom is the whole difference. Anything else: the picture as it is.
  if (bg?.kind === 'media' && bg.media === 'image' && bg.mediaId === mediaId && own) {
    const f = frameOfBackground(bg.fit, own, CANVAS);
    return (
      <ScreenPictures.Provider value={screen}>
        <Looked
          mediaId={mediaId}
          showing={null}
          style={{
            position: 'absolute',
            left: `${String(f.x * 100)}%`,
            top: `${String(f.y * 100)}%`,
            width: `${String(f.width * 100)}%`,
            height: `${String(f.height * 100)}%`,
            objectFit: OBJECT_FIT[bg.fit],
          }}
        >
          {(style) => <PreviewPicture mediaId={mediaId} onSize={onSize} style={style} />}
        </Looked>
      </ScreenPictures.Provider>
    );
  }
  return (
    <PreviewPicture
      mediaId={mediaId}
      onSize={onSize}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
}

/** A picture from the library or a playlist, on its own: in its own shape, sharp up to the picture itself. */
export function picturePage(mediaId: string, name: string): ViewerPage {
  const key = `picture:${mediaId}`;
  return {
    key,
    title: name,
    size: { width: 1920, height: 1080 },
    draw: () => <PictureDrawn mediaId={mediaId} pageKey={key} />,
    live: (state) => backgroundIs(state, mediaId),
    // The background on the screens: their frame (the canvas, the picture fitted into it) over its own shape, the
    // picture drawn with its kept look as they draw it (D1/D2 review), so this device's zoom adds to that.
    onScreens: (state) => {
      const bg = state?.layers.background;
      // Up alone: with a slide over it, the slide's own picture is the one the phone may zoom (D2 review).
      const target = phoneZoomTarget(state);
      if (
        bg?.kind !== 'media' ||
        bg.media !== 'image' ||
        bg.mediaId !== mediaId ||
        target?.mediaId !== mediaId
      )
        return null;
      const own = useViewer.getState().sizes[key] ?? { width: 1920, height: 1080 };
      return { frame: frameOfBackground(bg.fit, own, CANVAS), kept: keptFraming(state, mediaId) };
    },
  };
}

/** A video from the library or a playlist, played on this device at its original quality with its time bar. */
export function videoPage(mediaId: string, name: string): ViewerPage {
  const key = `video:${mediaId}`;
  return {
    key,
    title: name,
    size: { width: 1920, height: 1080 },
    draw: () => <DeviceVideoPicture mediaId={mediaId} pageKey={key} />,
    live: (state) => backgroundIs(state, mediaId),
    below: () => <DeviceVideoControls mediaId={mediaId} />,
  };
}

/** A sound of a playlist shared with phones (D3), played on this device at its own quality with its time bar. */
export function soundPage(mediaId: string, name: string): ViewerPage {
  return {
    key: `sound:${mediaId}`,
    title: name,
    size: SOUND_PAGE,
    draw: () => <DeviceSound mediaId={mediaId} name={name} />,
    // LIVE while Drashti plays it in the hall.
    live: (state) => state?.layers.audio?.mediaId === mediaId,
    below: () => <DeviceVideoControls mediaId={mediaId} what="sound" />,
  };
}
