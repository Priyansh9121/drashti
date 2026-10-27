import type { CSSProperties } from 'react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type VideoClips, videoClip, type VideoSeeks, videoSeek } from '../../../shared/engine/state';
import { type PlaybackClip, type PlaybackSeek, stillUrl } from '../../../shared/media';
import type {
  MediaElement,
  Outline,
  RenderSlide,
  ShapeElement,
  SlideElement,
  TextElement,
  TextRun,
  TextShadow,
  TimerElement,
} from '../../../shared/model';
import { fontFamilyFor } from './fonts';
import { TranslitSourceContext, useHtmlLang } from './lang';
import { translitSource } from '../../../shared/tracks';
import { OBJECT_FIT } from './media-style';
import { type Playback, startPlayback } from './playback';
import { requestStill, useStill } from './stills';
import { engineNow } from './clock';
import { Looked } from './picture-looks';
import { slideShowing } from '../../../shared/picture-look';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { useGpuRestarts, useMediaAttempt } from './media-attempts';
import { hasWords, revealLines, wordUnits } from './reveal';
import { useMediaUrl } from './media-urls';
import { useMeasureReport } from './measure';
import { missingFontsOf } from './font-probe';
import { MIN_FIT } from '../../../shared/readable';
import { standsUpright } from '../../../shared/text-runs';
import { TimerElementView } from './TimerElementView';
import { PlayBar } from './PlayBar';
import type { DeckMedia } from '../../../shared/deck';
import { deckMediaOf, deckPictureId, type StepTiming, videoShowsFrom } from '../../../shared/deck-show';
import { DeckStepView, useDeckCover } from './DeckStep';

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

/**
 * How a run is drawn inside its box (the slide editor draws text it edits the same way). Gujarati and
 * Devanagari stand upright with no letter-spacing (Sessions 31–36, I18N-2: shared/text-runs.ts
 * standsUpright), whatever was stored, which is kept.
 */
export function runStyle(run: Omit<TextRun, 'text'> & { text?: string }, el: TextElement): CSSProperties {
  const lang = run.lang ?? el.lang;
  const upright = standsUpright(run, el.lang);
  return {
    fontFamily: fontFamilyFor(run.font ?? el.style.fontFamily, lang),
    fontSize: fitted(run.size),
    color: run.color,
    fontWeight: run.weight,
    fontStyle: run.italic && !upright ? 'italic' : undefined,
    letterSpacing: upright ? undefined : run.letterSpacing,
    textShadow: textShadowCss(run.shadow),
    ...textOutlineCss(run.outline),
  };
}

/** Styled runs, inline, inside one block so the element's vertical alignment still applies. */
function Runs({ el, runs }: { el: TextElement; runs: TextRun[] }) {
  const langOf = useHtmlLang();
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
            lang={langOf(lang)}
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
  const langOf = useHtmlLang();
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
            const locale = langOf(piece.run.lang ?? el.lang);
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
  band,
}: {
  el: TextElement;
  hidden?: boolean;
  /** Line by line or word by word, while its words are revealed (Session 27). */
  reveal?: Reveal;
  /** A band behind its words this dark (Sessions 31–36, SLD-3: the slide's darkening), or none. */
  band?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const langOf = useHtmlLang();
  useShrinkToFit(box, words, el);
  // A font this computer does not have (Sessions 31–36, I18N-1): marked for the reports, drawing nothing different.
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const missing = missingFontsOf(el);
    if (missing.length > 0) b.setAttribute('data-missing-font', missing.join(', '));
    else b.removeAttribute('data-missing-font');
  }, [el]);
  return (
    <div
      ref={box}
      data-element={el.id}
      data-lang={el.lang ?? ''}
      data-shrink={el.style.shrinkToFit ? 'true' : undefined}
      data-words-hidden={hidden ? '' : undefined}
      lang={langOf(el.lang)}
      // Hidden while a Bold move draws the words apart (Session 27): laid out as ever, so nothing shifts when
      // they come back.
      style={hidden ? { ...textBoxStyle(el), visibility: 'hidden' } : textBoxStyle(el)}
    >
      <div
        ref={words}
        data-darken={band ? 'band' : undefined}
        style={{
          width: '100%',
          flexShrink: 0,
          // The band behind the lines: its spread is drawn outside them, so the words lie exactly as without it.
          ...(band
            ? {
                background: `rgba(0, 0, 0, ${String(band)})`,
                boxShadow: `0 0 0 0.3em rgba(0, 0, 0, ${String(band)})`,
              }
            : {}),
        }}
      >
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
 * How a Timer's box is drawn (Session 50): as a text box's, in its font, size, weight, colour, shadow and
 * outline, its digits on one line.
 */
export function timerBoxStyle(el: TimerElement): CSSProperties {
  const s = el.style;
  return {
    ...frameStyle(el),
    display: 'flex',
    flexDirection: 'column',
    justifyContent: justify[s.verticalAlign],
    textAlign: s.align,
    fontFamily: fontFamilyFor(s.fontFamily, null),
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    color: s.color,
    whiteSpace: 'pre',
    fontKerning: 'normal',
    textShadow: s.shadow === false ? undefined : textShadowCss(s.shadow),
    ...textOutlineCss(s.outline ?? undefined),
    opacity: el.opacity,
  };
}

/**
 * Whether the slide's darkening goes behind an element as behind words (Sessions 31–36, SLD-3): a box with
 * words, or a Timer (Session 50).
 */
export const darkensBehind = (el: SlideElement): boolean =>
  el.kind === 'timer' || (el.kind === 'text' && el.text.trim() !== '');

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

/**
 * A video placed on a slide, playing (muted) from when the slide went live, in step on every window; between its
 * file's start and end points when it has them (Session 52), going round between them when it loops, as a
 * background video does; from where the time bar moved it, or waiting where it paused it (Session 54).
 */
function SlideVideo({
  el,
  startedAt,
  attempt,
  clip,
  seek,
  deck,
  deckStep,
}: {
  el: MediaElement;
  startedAt: number | undefined;
  attempt: number;
  /** Its file's start and end points, as the engine stamped them (its layer's clips); undefined: the whole file. */
  clip: PlaybackClip | undefined;
  /** Where the time bar moved it, paused or not (its layer's seeks, Session 54); undefined: never moved. */
  seek: PlaybackSeek | undefined;
  /** A deck's own video (Session 54, C2): its poster before it plays, hidden while stopped when its deck says. */
  deck?: DeckMedia;
  /** The step its slide shows (C review): it shows between its entrance and its exit only. */
  deckStep?: StepTiming | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // Props and other things without a start time play from when they appear.
  const [mountedAt] = useState(() => engineNow());
  const start = startedAt ?? mountedAt;
  // One that failed with a GPU process that stopped plays again, from the engine's time, once another has
  // started (Sessions 31–36, ROB-5): each such try loads it at a new address.
  const restarts = useGpuRestarts();
  const restartsNow = useRef(restarts);
  useLayoutEffect(() => {
    restartsNow.current = restarts;
  });
  const [failedWith, setFailedWith] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  if (failedWith !== null && restarts > failedWith) {
    setFailedWith(null);
    setTries(tries + 1);
  }
  // Whether it loops, its start and end points (Session 52) and the time bar's moves (Session 54) are read as they
  // change, without a reload.
  // A deck's video loops as its deck says (Session 54, C2).
  const loop = deck ? deck.loop : (el.loop ?? false);
  const timing = useRef({ loop, clip, seek });
  useLayoutEffect(() => {
    timing.current = { loop, clip, seek };
  });
  const playback = useRef<Playback | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const p = startPlayback(v, {
      mediaId: el.mediaId,
      attempt: attempt + tries,
      startedAt: start,
      timing: () => timing.current,
      onError: () => {
        setFailedWith(restartsNow.current);
      },
    });
    playback.current = p;
    return () => {
      playback.current = null;
      p();
    };
  }, [el.mediaId, attempt, tries, start]);
  // New points while it plays (the library's changed), or the time bar's move, Pause or Play (Session 54): it goes
  // where they put it at once, as a background does, landing in step on every screen.
  const clipKey = `${String(clip?.startMs)}/${String(clip?.endMs)}`;
  const seekKey = `${String(seek?.at)}/${String(seek?.toMs)}/${String(seek?.paused)}`;
  useEffect(() => {
    playback.current?.resync();
  }, [clipKey, seekKey]);
  // A deck's video (Session 54, C2): its length once known, for when it has played to its end.
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const cover = useDeckCover(deck, { startedAt: start, loop, clip, seek }, durationMs, deckStep ?? null);
  return (
    <>
      <video
        ref={ref}
        data-element={el.id}
        data-media-id={el.mediaId}
        data-deck-cover={deck ? cover : undefined}
        muted
        playsInline
        disablePictureInPicture
        preload="auto"
        // Between start and end points it goes round by playback.ts's loop, not the element's.
        loop={loop && !clip}
        onLoadedMetadata={(e) => {
          if (deck && Number.isFinite(e.currentTarget.duration))
            setDurationMs(Math.round(e.currentTarget.duration * 1000));
        }}
        style={cover === 'hidden' ? { ...mediaStyle(el), visibility: 'hidden' } : mediaStyle(el)}
      />
      {/* A deck's video's poster, over it until it plays (Session 54, C2). */}
      {cover === 'poster' && deck?.posterId && <DeckPoster mediaId={deck.posterId} style={mediaStyle(el)} />}
      {/* Its play bar (Session 54), when the slide editor's setting is ticked: drawn from the same timing. */}
      {el.playBar === true && (
        <PlayBar
          frame={frameStyle(el)}
          height={el.frame.height}
          opacity={el.opacity ?? 1}
          video={ref}
          startedAt={start}
          loop={loop}
          clip={clip}
          seek={seek}
        />
      )}
    </>
  );
}

/** A deck's video's poster (Session 54, C2), from this computer's media or, on a node, its copy. */
function DeckPoster({ mediaId, style }: { mediaId: string; style: CSSProperties }) {
  const attempt = useMediaAttempt(mediaId);
  const urlOf = useMediaUrl();
  return (
    <img
      key={attempt}
      data-deck-poster={mediaId}
      src={urlOf(mediaId, attempt)}
      alt=""
      draggable={false}
      style={style}
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

function MediaView({
  el,
  media,
  startedAt,
  clips,
  seeks,
  deck,
  deckStep,
}: {
  el: MediaElement;
  media: MediaMode;
  startedAt?: number;
  clips?: VideoClips;
  seeks?: VideoSeeks;
  /** A deck's own video (Session 54, C2). */
  deck?: DeckMedia;
  /** The step its slide shows (C review). */
  deckStep?: StepTiming | null;
}) {
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
    ) : deck && deckStep && videoShowsFrom(deck, deckStep) === null ? null : (
      // A deck's video outside its entrance and its exit (C review) shows nothing on a phone either.
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
  return (
    <SlideVideo
      key={attempt}
      el={el}
      startedAt={startedAt}
      attempt={attempt}
      clip={videoClip(clips, el.mediaId)}
      seek={videoSeek(seeks, el.mediaId)}
      deck={deck}
      deckStep={deckStep}
    />
  );
}

export function ElementView({
  el,
  media = 'live',
  startedAt,
  clips,
  seeks,
  textHidden = false,
  reveal,
  band,
  deck,
  deckStep,
}: {
  el: SlideElement;
  media?: MediaMode;
  /** When the slide went live, for its videos. */
  startedAt?: number;
  /** Its layer's videos' start and end points, by file (the engine's, Session 52): a video plays between them. */
  clips?: VideoClips;
  /** Where the time bar moved or paused its layer's videos, by file (the engine's, Session 54). */
  seeks?: VideoSeeks;
  /** Words laid out but not drawn (they are drawn apart while a Bold move runs, Session 27). */
  textHidden?: boolean;
  /** Words line by line or word by word, while they are revealed (Session 27). */
  reveal?: Reveal;
  /** A band behind a box's words this dark (Sessions 31–36, SLD-3). */
  band?: number;
  /** A deck's own video (Session 54, C2): how its deck plays it. */
  deck?: DeckMedia;
  /** The step its slide shows (C review): a deck's video shows between its entrance and its exit only. */
  deckStep?: StepTiming | null;
}) {
  if (el.kind === 'text') return <TextView el={el} hidden={textHidden} reveal={reveal} band={band} />;
  if (el.kind === 'shape') return <ShapeView el={el} />;
  // A timer on a slide (Session 50): live, its digits moving on the screens, still in a thumbnail.
  if (el.kind === 'timer')
    return <TimerElementView el={el} box={timerBoxStyle(el)} animate={media === 'live'} band={band} />;
  return (
    <MediaView
      el={el}
      media={media}
      startedAt={startedAt}
      clips={clips}
      seeks={seeks}
      deck={deck}
      deckStep={deckStep}
    />
  );
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
  clips,
  seeks,
  text = 'shown',
  reveal,
  step,
}: {
  slide: RenderSlide;
  media?: MediaMode;
  /** When the slide went live (the engine's shownAt), so its videos play in step everywhere. */
  startedAt?: number;
  /** Its videos' start and end points, by file (the slide layer's, Session 52); left out: whole files. */
  clips?: VideoClips;
  /** Where the time bar moved or paused its videos, by file (the slide layer's, Session 54). */
  seeks?: VideoSeeks;
  text?: SlideText;
  /** Its words alone (`only`), line by line or word by word (Session 27). */
  reveal?: Reveal;
  /**
   * A deck's slide on the screens (Session 54, C2): the step showing, drawn in its picture's place as it plays by the
   * engine's time. Left out (a thumbnail, any other slide), its picture is drawn as it is: the slide whole.
   */
  step?: StepTiming | null;
}) {
  const darken = slide.darken;
  // The deck's picture, drawn as the step showing (Session 54, C2).
  const deck = slide.deck;
  const deckPicture = step && deck && media === 'live' ? deckPictureId(slide) : null;
  // What its transliteration is of (Sessions 31–36, I18N-4), for its words' lang.
  const source = useMemo(() => slide.translitOf ?? translitSource(slide.elements), [slide]);
  // The words the whole-picture darkening goes under: the first box with any, or a Timer (none in the words alone).
  const wholeUnder =
    darken?.kind === 'whole' && text !== 'only' ? slide.elements.find(darkensBehind)?.id : undefined;
  return (
    <TranslitSourceContext.Provider value={source}>
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
        {slide.elements.map((el) => [
          // The whole picture darkened (Sessions 31–36, SLD-3): over everything before the first words (a
          // picture, the colour, the background layer's video under the slide), under the words.
          el.id === wholeUnder && darken ? (
            <div
              key="darken"
              data-darken="whole"
              style={{
                position: 'absolute',
                inset: 0,
                background: `rgba(0, 0, 0, ${String(darken.strength)})`,
              }}
            />
          ) : null,
          text === 'only' && el.kind !== 'text' ? null : el.id === deckPicture && deck && step ? (
            <DeckStepView
              key={el.id}
              deck={deck}
              timing={step}
              style={{ ...frameStyle(el), opacity: el.kind === 'image' ? (el.opacity ?? 1) : 1 }}
              fit={el.kind === 'image' ? OBJECT_FIT[el.fit] : 'contain'}
            />
          ) : (
            <ElementView
              key={el.id}
              el={el}
              media={media}
              startedAt={startedAt}
              clips={clips}
              seeks={seeks}
              textHidden={text === 'hidden'}
              reveal={text === 'only' ? reveal : undefined}
              band={darken?.kind === 'band' && darkensBehind(el) ? darken.strength : undefined}
              deck={deck && el.kind === 'video' ? deckMediaOf(slide, el.mediaId, 'video') : undefined}
              deckStep={step ?? null}
            />
          ),
        ])}
      </div>
    </TranslitSourceContext.Provider>
  );
});
