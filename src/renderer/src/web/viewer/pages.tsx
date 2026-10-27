import { useMemo } from 'react';
import type { EngineState } from '../../../../shared/engine/state';
import { backgroundCueOf } from '../../../../shared/library';
import { groupLookIn } from '../../../../shared/looks';
import type { OrderedSlide } from '../../../../shared/order';
import { PLAIN } from '../../../../shared/picture-look';
import { useEngine } from '../../engine/engine-store';
import { ScreenPictures } from '../../render/picture-looks';
import { PreviewPicture } from '../../render/previews';
import { Scene } from '../../render/Scene';
import { SlideView } from '../../render/SlideView';
import { useRemote } from '../remote/remote-store';
import { DeviceVideoControls, DeviceVideoPicture } from './DeviceVideo';
import { frameInCanvas, frameInSlide, frameOfBackground, keptFraming, zoomTargetOf } from './live-zoom';
import { setPageSize, useViewer, type ViewerPage } from './viewer-store';

/*
 * The pages a phone or tablet looks at (Session 54, D1): what the screens show now, a presentation's slides in
 * their order (a PDF's or a deck's pages among them), a picture and a video. Each says how it is drawn, and (D2)
 * when it is what the screens show and where the picture the live zoom zooms is in it. Pictures are drawn as the
 * phones draw them (render/previews.tsx): at the size they are drawn, sharper as they are zoomed.
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
      const target = zoomTargetOf(state);
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
      const target = zoomTargetOf(state);
      const frame = frameInSlide(state);
      return target && frame ? { frame, kept: keptFraming(state, target.mediaId) } : null;
    },
  };
}

/** Whether the screens' background is this picture or video now. */
const backgroundIs = (state: EngineState | null, mediaId: string): boolean => {
  const bg = state?.layers.background;
  return bg?.kind === 'media' && bg.mediaId === mediaId;
};

/** A picture filling its page, which takes the picture's own shape once it has loaded. */
function PictureDrawn({ mediaId, pageKey }: { mediaId: string; pageKey: string }) {
  return (
    <PreviewPicture
      mediaId={mediaId}
      onSize={(natural) => {
        setPageSize(pageKey, { width: 1920, height: Math.round((1920 * natural.height) / natural.width) });
      }}
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
    // The background on the screens: their frame (the canvas, the picture fitted into it) over its own shape. The
    // picture is drawn here as it is (no kept look), so the phone's zoom is the screens' whole zoom.
    onScreens: (state) => {
      const bg = state?.layers.background;
      const target = zoomTargetOf(state);
      if (
        bg?.kind !== 'media' ||
        bg.media !== 'image' ||
        bg.mediaId !== mediaId ||
        target?.mediaId !== mediaId
      )
        return null;
      const own = useViewer.getState().sizes[key] ?? { width: 1920, height: 1080 };
      return { frame: frameOfBackground(bg.fit, own, CANVAS), kept: PLAIN };
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
