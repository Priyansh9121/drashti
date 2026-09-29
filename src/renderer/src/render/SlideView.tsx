import type { CSSProperties } from 'react';
import { memo, useEffect, useRef, useState } from 'react';
import { mediaUrl, stillUrl } from '../../../shared/media';
import type {
  MediaElement,
  RenderSlide,
  ShapeElement,
  SlideElement,
  TextElement,
  TextRun,
} from '../../../shared/model';
import { fontFamilyFor, HTML_LANG } from './fonts';
import { OBJECT_FIT } from './media-style';
import { startPlayback } from './playback';
import { requestStill, useStill } from './stills';

/**
 * How a slide draws its videos: 'live' plays them (outputs and the live
 * preview); 'still' shows a still frame (thumbnails never play video).
 */
export type MediaMode = 'live' | 'still';

const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

function frameStyle(el: SlideElement): CSSProperties {
  return {
    position: 'absolute',
    left: el.frame.x,
    top: el.frame.y,
    width: el.frame.width,
    height: el.frame.height,
  };
}

/** Styled runs, inline, inside one block so the element's vertical alignment still applies. */
function Runs({ el, runs }: { el: TextElement; runs: TextRun[] }) {
  return (
    <div style={{ width: '100%' }}>
      {runs.map((run, i) => {
        const lang = run.lang ?? el.lang;
        return (
          <span
            key={i}
            data-run={i}
            data-lang={run.lang ?? undefined}
            data-legacy={run.legacy ? 'true' : undefined}
            lang={lang ? HTML_LANG[lang] : undefined}
            style={{
              fontFamily: fontFamilyFor(run.font ?? el.style.fontFamily, lang),
              fontSize: run.size,
              color: run.color,
              fontWeight: run.weight,
              fontStyle: run.italic ? 'italic' : undefined,
              letterSpacing: run.letterSpacing,
            }}
          >
            {run.text}
          </span>
        );
      })}
    </div>
  );
}

function TextView({ el }: { el: TextElement }) {
  const s = el.style;
  return (
    <div
      data-element={el.id}
      data-lang={el.lang ?? ''}
      lang={el.lang ? HTML_LANG[el.lang] : undefined}
      style={{
        ...frameStyle(el),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify[s.verticalAlign],
        textAlign: s.align,
        fontFamily: fontFamilyFor(s.fontFamily, el.lang),
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontKerning: 'normal',
        textShadow: s.shadow ? '0 0.06em 0.18em rgba(0, 0, 0, 0.85)' : undefined,
      }}
    >
      {el.runs && el.runs.length > 0 ? <Runs el={el} runs={el.runs} /> : el.text}
    </div>
  );
}

function ShapeView({ el }: { el: ShapeElement }) {
  return (
    <div
      data-element={el.id}
      style={{ ...frameStyle(el), background: el.fill, borderRadius: el.cornerRadius, opacity: el.opacity }}
    />
  );
}

function mediaStyle(el: MediaElement): CSSProperties {
  return { ...frameStyle(el), objectFit: OBJECT_FIT[el.fit], opacity: el.opacity ?? 1 };
}

/** A video placed on a slide, playing (muted) from when the slide went live, in step on every window. */
function SlideVideo({ el, startedAt }: { el: MediaElement; startedAt: number | undefined }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Props and other things without a start time play from when they appear.
  const [mountedAt] = useState(() => Date.now());
  const start = startedAt ?? mountedAt;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    return startPlayback(v, { mediaId: el.mediaId, startedAt: start });
  }, [el.mediaId, start]);
  return (
    <video
      ref={ref}
      data-element={el.id}
      data-media-id={el.mediaId}
      muted
      playsInline
      disablePictureInPicture
      preload="auto"
      loop={el.loop ?? false}
      style={mediaStyle(el)}
    />
  );
}

/** A video's still frame, made once and kept (thumbnails never play video). */
export function VideoStill({ mediaId, style }: { mediaId: string; style: CSSProperties }) {
  const still = useStill(mediaId);
  if (still.failed) {
    return <div data-media-id={mediaId} data-still="none" style={{ ...style, background: '#1f2937' }} />;
  }
  return (
    <img
      data-media-id={mediaId}
      data-still={still.version}
      src={stillUrl(mediaId, still.version)}
      alt=""
      draggable={false}
      onError={() => {
        requestStill(mediaId);
      }}
      style={style}
    />
  );
}

function MediaView({ el, media, startedAt }: { el: MediaElement; media: MediaMode; startedAt?: number }) {
  if (el.kind === 'image') {
    return (
      <img
        data-element={el.id}
        data-media-id={el.mediaId}
        src={mediaUrl(el.mediaId)}
        alt=""
        draggable={false}
        style={mediaStyle(el)}
      />
    );
  }
  if (media === 'still') return <VideoStill mediaId={el.mediaId} style={mediaStyle(el)} />;
  return <SlideVideo el={el} startedAt={startedAt} />;
}

export function ElementView({
  el,
  media = 'live',
  startedAt,
}: {
  el: SlideElement;
  media?: MediaMode;
  /** When the slide went live, for its videos. */
  startedAt?: number;
}) {
  if (el.kind === 'text') return <TextView el={el} />;
  if (el.kind === 'shape') return <ShapeView el={el} />;
  return <MediaView el={el} media={media} startedAt={startedAt} />;
}

/** One slide at its design size. Parents scale it with Placed. */
export const SlideView = memo(function SlideView({
  slide,
  media = 'live',
  startedAt,
}: {
  slide: RenderSlide;
  media?: MediaMode;
  /** When the slide went live (the engine's shownAt), so its videos play in step everywhere. */
  startedAt?: number;
}) {
  return (
    <div
      data-slide={slide.id}
      style={{
        position: 'relative',
        width: slide.width,
        height: slide.height,
        overflow: 'hidden',
        background: slide.background ?? 'transparent',
      }}
    >
      {slide.elements.map((el) => (
        <ElementView key={el.id} el={el} media={media} startedAt={startedAt} />
      ))}
    </div>
  );
});
