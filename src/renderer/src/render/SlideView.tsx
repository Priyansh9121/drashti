import type { CSSProperties } from 'react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mediaUrl, stillUrl } from '../../../shared/media';
import type {
  MediaElement,
  Outline,
  RenderSlide,
  ShapeElement,
  SlideElement,
  TextElement,
  TextRun,
  TextShadow,
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
/** Drashti's own soft shadow (a text shadow of `true`): it grows with the text. */
export const TEXT_SHADOW = '0 0.06em 0.18em rgba(0, 0, 0, 0.85)';

/** CSS for a text shadow; undefined leaves it to the box. */
export function textShadowCss(shadow: TextShadow | undefined): string | undefined {
  if (shadow === undefined) return undefined;
  if (shadow === true) return TEXT_SHADOW;
  if (shadow === false) return 'none';
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}`;
}

/**
 * CSS for an outline around letters. The stroke is painted under the
 * letters (paint-order), so half of it shows outside them: it is drawn twice
 * as wide as the outline should look. Undefined leaves it to the box.
 */
export function textOutlineCss(outline: Outline | null | undefined): CSSProperties {
  if (outline === undefined) return {};
  if (outline === null || outline.width <= 0) return { WebkitTextStroke: '0 transparent' };
  return { WebkitTextStroke: `${outline.width * 2}px ${outline.color}`, paintOrder: 'stroke fill' };
}

function frameStyle(el: SlideElement): CSSProperties {
  return {
    position: 'absolute',
    left: el.frame.x,
    top: el.frame.y,
    width: el.frame.width,
    height: el.frame.height,
    // About the frame's centre (the default origin).
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

/** A size that shrink-to-fit can scale: the box's --fit (1 unless the words do not fit). */
const fitted = (px: number | undefined) => (px === undefined ? undefined : `calc(var(--fit, 1) * ${px}px)`);

/** Styled runs, inline, inside one block so the element's vertical alignment still applies. */
function Runs({ el, runs }: { el: TextElement; runs: TextRun[] }) {
  return (
    <>
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
              fontSize: fitted(run.size),
              color: run.color,
              fontWeight: run.weight,
              fontStyle: run.italic ? 'italic' : undefined,
              letterSpacing: run.letterSpacing,
              textShadow: textShadowCss(run.shadow),
              ...textOutlineCss(run.outline),
            }}
          >
            {run.text}
          </span>
        );
      })}
    </>
  );
}

/** The smallest shrink-to-fit goes (a tenth of the size set). */
const MIN_FIT = 0.1;

/**
 * Shrink-to-fit: the largest --fit (at most 1) at which the words fit the
 * box, found by measuring. Measured in layout pixels, so a box drawn scaled
 * (a thumbnail) or turned gets the same answer as the output.
 */
function useShrinkToFit(
  box: React.RefObject<HTMLDivElement | null>,
  words: React.RefObject<HTMLDivElement | null>,
  el: TextElement,
): void {
  const on = el.style.shrinkToFit === true;
  const [fontsLoaded, setFontsLoaded] = useState(0);
  useEffect(() => {
    if (!on) return;
    const again = () => {
      setFontsLoaded((n) => n + 1);
    };
    document.fonts.addEventListener('loadingdone', again);
    return () => {
      document.fonts.removeEventListener('loadingdone', again);
    };
  }, [on]);
  useLayoutEffect(() => {
    const b = box.current;
    const w = words.current;
    if (!b || !w) return;
    const fits = (fit: number) => {
      b.style.setProperty('--fit', String(fit));
      return w.offsetHeight <= b.clientHeight + 0.5;
    };
    let lo = 1;
    if (!on) {
      b.style.removeProperty('--fit');
    } else if (!fits(1)) {
      lo = MIN_FIT;
      let hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      b.style.setProperty('--fit', String(lo));
    }
    // For tests and diagnostics: how much it was made smaller.
    if (lo < 1) b.setAttribute('data-fit', lo.toFixed(3));
    else b.removeAttribute('data-fit');
  }, [box, words, el, on, fontsLoaded]);
}

function TextView({ el }: { el: TextElement }) {
  const s = el.style;
  const box = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  useShrinkToFit(box, words, el);
  return (
    <div
      ref={box}
      data-element={el.id}
      data-lang={el.lang ?? ''}
      data-shrink={s.shrinkToFit ? 'true' : undefined}
      lang={el.lang ? HTML_LANG[el.lang] : undefined}
      style={{
        ...frameStyle(el),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify[s.verticalAlign],
        textAlign: s.align,
        fontFamily: fontFamilyFor(s.fontFamily, el.lang),
        fontSize: fitted(s.fontSize),
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontKerning: 'normal',
        textShadow: s.shadow === false ? undefined : textShadowCss(s.shadow),
        ...textOutlineCss(s.outline ?? undefined),
      }}
    >
      <div ref={words} style={{ width: '100%', flexShrink: 0 }}>
        {el.runs && el.runs.length > 0 ? <Runs el={el} runs={el.runs} /> : el.text}
      </div>
    </div>
  );
}

/**
 * A shape, drawn as SVG so its outline sits on its edge (half inside, half
 * outside) as in the presentation programs it came from, and an ellipse or
 * a line is exact.
 */
function ShapeView({ el }: { el: ShapeElement }) {
  const { width, height } = el.frame;
  const kind = el.shape ?? 'rectangle';
  const stroke = el.outline && el.outline.width > 0 ? el.outline : null;
  const paint = {
    fill: kind === 'line' ? 'none' : (el.fill ?? 'none'),
    stroke: stroke?.color ?? 'none',
    strokeWidth: stroke?.width ?? 0,
  };
  const radius = Math.min(el.cornerRadius, width / 2, height / 2);
  return (
    <svg
      data-element={el.id}
      data-shape={kind}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      style={{ ...frameStyle(el), opacity: el.opacity, overflow: 'visible' }}
    >
      {kind === 'ellipse' ? (
        <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...paint} />
      ) : kind === 'line' ? (
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} {...paint} />
      ) : (
        <rect x={0} y={0} width={width} height={height} rx={radius} ry={radius} {...paint} />
      )}
    </svg>
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
