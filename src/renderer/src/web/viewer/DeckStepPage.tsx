import { useEffect, useMemo, useState } from 'react';
import { deckPictureId, deckSlideAt } from '../../../../shared/deck-show';
import type { RenderSlide } from '../../../../shared/model';
import type { OrderedSlide } from '../../../../shared/order';
import { useEngine } from '../../engine/engine-store';
import { OBJECT_FIT } from '../../render/media-style';
import { ScreenPictures } from '../../render/picture-looks';
import { SlideView } from '../../render/SlideView';
import { linkTo } from './DeviceVideo';
import { useViewer } from './viewer-store';

/*
 * A deck's step looked through on a phone or tablet (Session 54, D1/D2 review): its motion played once, as the deck
 * plays it, then its last frame held. The motion is the step's own clip (C2), its file through a link made for this
 * device (a <video> cannot send the token), muted (the deck's motion has no sound) and inline; until it has a frame,
 * the step before's last frame shows (nothing in the picture's place for the slide coming in). Come to by Previous,
 * the step shows still at its last frame, as Back shows it on the screens. A clip this device cannot play (or will
 * not start by itself) leaves the last frame, so a step never stays on the one before. On this device only.
 */

/** Longer than this past the clip's own length, a clip that has not ended is let go: its last frame shows. */
const SLACK_MS = 4000;

/** The slide without the picture the deck's steps are drawn in: what the slide coming in starts from. */
function withoutPicture(slide: RenderSlide): RenderSlide {
  const id = deckPictureId(slide);
  return id === null ? slide : { ...slide, elements: slide.elements.filter((e) => e.id !== id) };
}

export function DeckStepDrawn({ s, index }: { s: OrderedSlide; index: number }) {
  const slide = s.slide.slide;
  const step = slide.deck?.steps[index];
  // Come to by Previous: still, as Back shows a step on the screens.
  const [still] = useState(() => useViewer.getState().movedBy < 0);
  const [ended, setEnded] = useState(still || !step);
  const [moving, setMoving] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const pictures = useEngine((st) => st.state?.pictures);
  const screen = useMemo(() => ({ pictures: pictures ?? {}, liveZoom: null }), [pictures]);
  const pictureId = deckPictureId(slide);
  const picture = slide.elements.find((e) => e.id === pictureId);
  useEffect(() => {
    if (ended || !step) return;
    let live = true;
    void linkTo(step.clipId).then((got) => {
      if (!live) return;
      if ('url' in got) setUrl(got.url);
      else setEnded(true);
    });
    // A clip that never ends here (it will not start by itself, or stalls): its last frame after all.
    const late = setTimeout(
      () => {
        setEnded(true);
      },
      Math.max(0, step.clipMs) + SLACK_MS,
    );
    return () => {
      live = false;
      clearTimeout(late);
    };
  }, [ended, step]);
  const drawn = ended
    ? deckSlideAt(slide, index)
    : index > 0
      ? deckSlideAt(slide, index - 1)
      : withoutPicture(slide);
  return (
    <ScreenPictures.Provider value={screen}>
      <div
        style={{ position: 'absolute', inset: 0, background: '#000' }}
        data-testid="viewer-deck-step"
        data-step={index}
        data-phase={ended ? 'held' : moving ? 'clip' : 'loading'}
      >
        <SlideView slide={drawn} media="still" />
        {!ended && url && picture?.kind === 'image' && step && (
          <video
            src={url}
            muted
            playsInline
            autoPlay
            preload="auto"
            disablePictureInPicture
            data-testid="viewer-deck-clip"
            data-media-id={step.clipId}
            onCanPlay={(e) => {
              // Started here when it did not start by itself; refused (a phone saving power): its last frame.
              if (e.currentTarget.paused)
                void e.currentTarget.play().catch(() => {
                  setEnded(true);
                });
            }}
            onPlaying={() => {
              setMoving(true);
            }}
            onEnded={() => {
              setEnded(true);
            }}
            onError={() => {
              setEnded(true);
            }}
            style={{
              position: 'absolute',
              left: picture.frame.x,
              top: picture.frame.y,
              width: picture.frame.width,
              height: picture.frame.height,
              objectFit: OBJECT_FIT[picture.fit],
              // Until its first frame plays, the step before's still shows under it.
              opacity: moving ? 1 : 0,
            }}
          />
        )}
      </div>
    </ScreenPictures.Provider>
  );
}
