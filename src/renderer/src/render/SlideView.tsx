import type { CSSProperties } from 'react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { stillUrl } from '../../../shared/media';
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
import { engineNow } from './clock';
import { Looked } from './picture-looks';
import { slideShowing } from '../../../shared/picture-look';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { useMediaAttempt } from './media-attempts';
import { hasWords, revealLines, wordUnits } from './reveal';
import { useMediaUrl } from './media-urls';
import { useMeasureReport } from './measure';
import { MIN_FIT } from '../../../shared/readable';

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

/** How a run is drawn inside its box (the slide editor draws text it edits the same way). */
export function runStyle(run: Omit<TextRun, 'text'>, el: TextElement): CSSProperties {
  const lang = run.lang ?? el.lang;
  return {
    fontFamily: fontFamilyFor(run.font ?? el.style.fontFamily, lang),
    fontSize: fitted(run.size),
    color: run.color,
    fontWeight: run.weight,
    fontStyle: run.italic ? 'italic' : undefined,
    letterSpacing: run.letterSpacing,
    textShadow: textShadowCss(run.shadow),
    ...textOutlineCss(run.outline),
  };
}

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
            style={runStyle(run, el)}
          >
            {run.text}
          </span>
        );
      })}
    </>
  );
}

/**
 * The words of a box as lines (and, word by word, as words), each its own span, while they are revealed
 * one after another (Session 27, render/reveal.ts): laid out exactly as Runs lays them out (each line
 * break with its own run), each line and word moved by its own `top` and faded by its own opacity.
 */
function RevealRuns({ el, runs, words }: { el: TextElement; runs: readonly TextRun[]; words: boolean }) {
  return (
    <>
      {revealLines(runs).map((line, li) => (
        <span
          key={li}
          data-reveal-line={li}
          data-reveal-empty={hasWords(line) ? undefined : ''}
          style={{ position: 'relative' }}
        >
          {line.pieces.map((piece, pi) => {
            const lang = piece.run.lang ?? el.lang;
            const locale = lang ? HTML_LANG[lang] : undefined;
            return (
              <span key={pi} lang={locale} style={runStyle(piece.run, el)}>
                {words && piece.text !== '\n'
                  ? wordUnits(piece.text, locale).map((unit, ui) => (
                      <span key={ui} data-reveal-word="" style={{ position: 'relative' }}>
                        {unit}
                      </span>
                    ))
                  : piece.text}
              </span>
            );
          })}
        </span>
      ))}
    </>
  );
}

/**
 * Shrink-to-fit: the largest --fit (at most 1) at which the words fit the
 * box, found by measuring. Measured in layout pixels, so a box drawn scaled
 * (a thumbnail) or turned gets the same answer as the output. Every box is
 * measured (Sessions 31–36, SLD-1): one whose words still run past it, at the
 * fit shrink-to-fit reached or unshrunk, is marked data-overset, and whoever
 * asked (MeasureContext: a thumbnail, the slide editor) is told.
 */
export function useShrinkToFit(
  box: React.RefObject<HTMLDivElement | null>,
  words: React.RefObject<HTMLElement | null>,
  el: TextElement,
  /** Something else that changes the words (typing in the editor). */
  again?: unknown,
): void {
  const on = el.style.shrinkToFit === true;
  const report = useMeasureReport();
  const [fontsLoaded, setFontsLoaded] = useState(0);
  // A font arriving changes how far the words reach, shrunk or not.
  useEffect(() => {
    const again = () => {
      setFontsLoaded((n) => n + 1);
    };
    document.fonts.addEventListener('loadingdone', again);
    return () => {
      document.fonts.removeEventListener('loadingdone', again);
    };
  }, []);
  useEffect(() => () => report?.(el.id, null), [report, el.id]);
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
    // The words still past the box, at that fit.
    const over = w.offsetHeight > b.clientHeight + 0.5;
    if (over) b.setAttribute('data-overset', '');
    else b.removeAttribute('data-overset');
    report?.(el.id, { over, fit: lo });
  }, [box, words, el, on, fontsLoaded, again, report]);
}

/** How a text box is drawn (the slide editor draws the box it edits the same way). */
export function textBoxStyle(el: TextElement): CSSProperties {
  const s = el.style;
  return {
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
    opacity: el.opacity,
  };
}

function TextView({
  el,
  hidden = false,
  reveal,
}: {
  el: TextElement;
  hidden?: boolean;
  /** Line by line or word by word, while its words are revealed (Session 27). */
  reveal?: Reveal;
}) {
  const box = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  useShrinkToFit(box, words, el);
  return (
    <div
      ref={box}
      data-element={el.id}
      data-lang={el.lang ?? ''}
      data-shrink={el.style.shrinkToFit ? 'true' : undefined}
      data-words-hidden={hidden ? '' : undefined}
      lang={el.lang ? HTML_LANG[el.lang] : undefined}
      // Hidden while a Bold move draws the words apart (Session 27): laid out as ever, so nothing shifts when
      // they come back.
      style={hidden ? { ...textBoxStyle(el), visibility: 'hidden' } : textBoxStyle(el)}
    >
      <div ref={words} style={{ width: '100%', flexShrink: 0 }}>
        {reveal ? (
          <RevealRuns
            el={el}
            runs={el.runs && el.runs.length > 0 ? el.runs : [{ text: el.text }]}
            words={reveal === 'words'}
          />
        ) : el.runs && el.runs.length > 0 ? (
          <Runs el={el} runs={el.runs} />
        ) : (
          el.text
        )}
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
function SlideVideo({
  el,
  startedAt,
  attempt,
}: {
  el: MediaElement;
  startedAt: number | undefined;
  attempt: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // Props and other things without a start time play from when they appear.
  const [mountedAt] = useState(() => engineNow());
  const start = startedAt ?? mountedAt;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    return startPlayback(v, { mediaId: el.mediaId, attempt, startedAt: start });
  }, [el.mediaId, attempt, start]);
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
  return usePreviewsOnly() ? (
    <PreviewPicture mediaId={mediaId} style={style} />
  ) : (
    <WindowVideoStill mediaId={mediaId} style={style} />
  );
}

/** In Drashti's windows: the still the operator window made and keeps in the media folder. */
function WindowVideoStill({ mediaId, style }: { mediaId: string; style: CSSProperties }) {
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
  // On a node, a copy that landed after this picture was asked for: drawn again (a new element).
  const attempt = useMediaAttempt(el.mediaId);
  const urlOf = useMediaUrl();
  // A picture's look (Session 26e), and on the screens the live zoom of this slide's showing.
  const showing = startedAt === undefined ? null : slideShowing(startedAt);
  // A phone or tablet: pictures and videos as small previews, and no video plays.
  if (usePreviewsOnly())
    return el.kind === 'image' ? (
      <Looked mediaId={el.mediaId} showing={showing} style={mediaStyle(el)}>
        {(style, copy) => <PreviewPicture mediaId={copy?.id ?? el.mediaId} style={style} />}
      </Looked>
    ) : (
      <PreviewPicture mediaId={el.mediaId} style={mediaStyle(el)} />
    );
  if (el.kind === 'image') {
    return (
      <Looked mediaId={el.mediaId} showing={showing} style={mediaStyle(el)}>
        {(style, copy) => (
          <img
            key={attempt}
            data-element={el.id}
            data-media-id={el.mediaId}
            src={copy?.url ?? urlOf(el.mediaId, attempt)}
            alt=""
            draggable={false}
            style={style}
          />
        )}
      </Looked>
    );
  }
  if (media === 'still') return <VideoStill mediaId={el.mediaId} style={mediaStyle(el)} />;
  return <SlideVideo key={attempt} el={el} startedAt={startedAt} attempt={attempt} />;
}

export function ElementView({
  el,
  media = 'live',
  startedAt,
  textHidden = false,
  reveal,
}: {
  el: SlideElement;
  media?: MediaMode;
  /** When the slide went live, for its videos. */
  startedAt?: number;
  /** Words laid out but not drawn (they are drawn apart while a Bold move runs, Session 27). */
  textHidden?: boolean;
  /** Words line by line or word by word, while they are revealed (Session 27). */
  reveal?: Reveal;
}) {
  if (el.kind === 'text') return <TextView el={el} hidden={textHidden} reveal={reveal} />;
  if (el.kind === 'shape') return <ShapeView el={el} />;
  return <MediaView el={el} media={media} startedAt={startedAt} />;
}

/**
 * How a slide's words are drawn (Session 27): as designed (`shown`); while a Bold move draws them apart, the
 * slide's pictures, shapes and colour with its words laid out but not drawn (`hidden`), and the words alone
 * over nothing (`only`).
 */
export type SlideText = 'shown' | 'hidden' | 'only';

/** Words revealed one line, or one word, after another (Session 27). */
export type Reveal = 'lines' | 'words';

/** One slide at its design size. Parents scale it with Placed. */
export const SlideView = memo(function SlideView({
  slide,
  media = 'live',
  startedAt,
  text = 'shown',
  reveal,
}: {
  slide: RenderSlide;
  media?: MediaMode;
  /** When the slide went live (the engine's shownAt), so its videos play in step everywhere. */
  startedAt?: number;
  text?: SlideText;
  /** Its words alone (`only`), line by line or word by word (Session 27). */
  reveal?: Reveal;
}) {
  return (
    <div
      data-slide={slide.id}
      data-text={text === 'shown' ? undefined : text}
      style={{
        position: 'relative',
        width: slide.width,
        height: slide.height,
        overflow: 'hidden',
        background: text === 'only' ? 'transparent' : (slide.background ?? 'transparent'),
      }}
    >
      {slide.elements.map((el) =>
        text === 'only' && el.kind !== 'text' ? null : (
          <ElementView
            key={el.id}
            el={el}
            media={media}
            startedAt={startedAt}
            textHidden={text === 'hidden'}
            reveal={text === 'only' ? reveal : undefined}
          />
        ),
      )}
    </div>
  );
});
