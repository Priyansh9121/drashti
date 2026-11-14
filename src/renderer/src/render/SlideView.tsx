import type { CSSProperties, ReactNode } from 'react';
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type VideoClips, videoClip, type VideoSeeks, videoSeek } from '../../../shared/engine/state';
import { type PlaybackClip, type PlaybackSeek, stillUrl } from '../../../shared/media';
import type {
  Glow,
  GradientFill,
  ElementMotion,
  ListMark,
  MediaElement,
  Outline,
  RenderSlide,
  ShapeElement,
  SlideElement,
  TextElement,
  TextParagraph,
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
import { clockHeld, engineFrameNow, engineNow, onClockJump } from './clock';
import { hasElementMotion, motionFrame } from '../../../shared/element-motion';
import { wakeAt } from './wake-at';
import { Looked } from './picture-looks';
import { nativePathData, shapePath } from '../../../shared/shape-path';
import { slideShowing } from '../../../shared/picture-look';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { useGpuRestarts, useMediaAttempt } from './media-attempts';
import { hasWords, revealLines, wordUnits } from './reveal';
import { useMediaUrl } from './media-urls';
import { useMeasureReport } from './measure';
import { observeTextSizes } from './observe-text-sizes';
import { missingFontsOf } from './font-probe';
import { queueFit } from './shrink-to-fit';
import { standsUpright } from '../../../shared/text-runs';
import { drawnLines, hasList } from '../../../shared/text-lists';
import { cutLineHeight, sourceFitScale, sourceLineCut, sourceRunScale } from '../../../shared/source-fit';
import { TimerElementView } from './TimerElementView';
import { PlayBar } from './PlayBar';
import type { DeckMedia } from '../../../shared/deck';
import {
  deckMediaOf,
  deckPictureId,
  type DeckVideoTiming,
  type StepTiming,
  videoShowsFrom,
} from '../../../shared/deck-show';
import { DeckStepView, useDeckCover } from './DeckStep';
import { NativeDeckElement, useNativeDeckTiming } from './NativeDeckElement';

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

/** A glow that shows: one with a colour spreading some way. */
const glowing = (glow: Glow | null | undefined): glow is Glow => glow != null && glow.size > 0;

/**
 * CSS for a shadow and a glow together (Session 55, Part 17a): the glow first, all round the letters, then the
 * shadow; a text shadow alone as it always was (textShadowCss) when there is no glow.
 */
export function textEffectsCss(
  shadow: TextShadow | undefined,
  glow: Glow | null | undefined,
): string | undefined {
  if (!glowing(glow)) return textShadowCss(shadow);
  const own = `0 0 ${String(glow.size)}px ${glow.color}`;
  const behind = shadow === undefined || shadow === false ? undefined : textShadowCss(shadow);
  return behind ? `${own}, ${behind}` : own;
}

/**
 * A run's shadow with its glow (Session 55, Part 17a). Text shadows do not add up, so a run with a shadow or a glow
 * of its own draws both, the other one its box's; one with neither leaves both to its box. With no glow anywhere it
 * is the run's shadow alone, as before.
 */
function runEffectsCss(run: Pick<TextRun, 'shadow' | 'glow'>, el: TextElement): string | undefined {
  if (run.glow === undefined && !glowing(el.style.glow)) return textShadowCss(run.shadow);
  if (run.shadow === undefined && run.glow === undefined) return undefined;
  const shadow = run.shadow ?? el.style.shadow;
  const glow = run.glow !== undefined ? run.glow : el.style.glow;
  return textEffectsCss(shadow, glow) ?? 'none';
}

/** Underlined, struck through, or both (Session 55, Part 17a); undefined for neither. */
function decorationOf(run: Pick<TextRun, 'underline' | 'strike'>): string | undefined {
  const lines = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean);
  return lines.length > 0 ? lines.join(' ') : undefined;
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
    transform:
      [
        el.rotation ? `rotate(${el.rotation}deg)` : '',
        el.flipX || el.flipY ? `scale(${el.flipX ? -1 : 1}, ${el.flipY ? -1 : 1})` : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  };
}

/** A size that shrink-to-fit can scale: the box's --fit (1 unless the words do not fit). */
const fitted = (px: number | undefined) => (px === undefined ? undefined : `calc(var(--fit, 1) * ${px}px)`);

/**
 * A run's size in a deck's box that PowerPoint shrank: each run at its own size rounded to a whole point once the box
 * is at PowerPoint's fit (shared/source-fit.ts sourceRunScale; Q58-50). As written for every other box.
 */
const ownSize = (px: number | undefined, el: TextElement) => {
  if (px === undefined) return undefined;
  const share = sourceRunScale(el, px);
  return share === 1 ? px : Math.round(px * share * 10_000) / 10_000;
};

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
    fontSize: fitted(ownSize(run.size, el)),
    color: run.color,
    fontWeight: run.weight,
    fontStyle: run.italic && !upright ? 'italic' : undefined,
    letterSpacing: upright ? undefined : run.letterSpacing,
    textShadow: runEffectsCss(run, el),
    ...textOutlineCss(run.outline),
    // Underlined and struck through (Session 55, Part 17a): never changes how Gujarati or Devanagari letters join.
    textDecorationLine: decorationOf(run),
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

/** A list's room (Session 55, Part 17a), in its line's words' size: for a bullet, for a number, and each level in. */
const BULLET_ROOM = 1.2;
const NUMBER_ROOM = 1.9;
const LEVEL_STEP = 1.5;

/**
 * How a list's mark is drawn (Session 55, Part 17a): a bullet is a shape in its line's colour, the same on every
 * screen whatever fonts it has; a number is its words, up against the line's own, in the line's colour.
 */
export function listMarkerStyle(mark: ListMark, look: Pick<TextRun, 'color' | 'paragraph'>): CSSProperties {
  const markerColor = look.paragraph?.bulletColor ?? look.color;
  const color = markerColor ?? 'currentColor';
  switch (mark) {
    case 'disc':
      return {
        display: 'inline-block',
        width: '0.34em',
        height: '0.34em',
        borderRadius: '50%',
        background: color,
        verticalAlign: 'middle',
      };
    case 'circle':
      return {
        display: 'inline-block',
        width: '0.34em',
        height: '0.34em',
        borderRadius: '50%',
        background: 'transparent',
        border: `0.07em solid ${color}`,
        boxSizing: 'border-box',
        verticalAlign: 'middle',
      };
    case 'square':
      return {
        display: 'inline-block',
        width: '0.3em',
        height: '0.3em',
        background: color,
        verticalAlign: 'middle',
      };
    case 'dash':
      return {
        display: 'inline-block',
        width: '0.55em',
        height: '0.09em',
        background: color,
        verticalAlign: 'middle',
      };
    case 'arrow':
      return {
        display: 'inline-block',
        width: 0,
        height: 0,
        borderLeft: `0.4em solid ${color}`,
        borderTop: '0.22em solid transparent',
        borderBottom: '0.22em solid transparent',
        verticalAlign: 'middle',
      };
    default:
      return {
        color: markerColor,
        textAlign: 'right',
        paddingRight: '0.3em',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      };
  }
}

/** A list's line (Session 55, Part 17a): in by its level and its mark's room, in its first words' size. */
export function listLineStyle(
  line: { mark: ListMark | null; level: number; label: string | null },
  size: number,
): CSSProperties {
  if (line.mark === null) return {};
  const room = line.label === null ? BULLET_ROOM : NUMBER_ROOM;
  return { paddingLeft: fitted((line.level * LEVEL_STEP + room) * size) };
}

export function paragraphLineStyle(
  line: { mark: ListMark | null; level: number; label: string | null },
  size: number,
  paragraph: TextParagraph | undefined,
  /** Its space before and after at the box's edges, and the source's own shrink of line spacings (PF-4b). */
  space: { before: boolean; after: boolean; lineCut?: number },
): CSSProperties {
  const base = listLineStyle(line, size);
  if (!paragraph) return base;
  const { align, marginLeft, marginRight, indent, lineHeight, lineHeightPx, spaceBefore, spaceAfter } =
    paragraph;
  const indentWords = indent !== undefined && (line.mark === null || indent > 0) ? fitted(indent) : undefined;
  return {
    ...base,
    textAlign: align,
    ...(marginLeft !== undefined ? { paddingLeft: undefined, paddingInlineStart: fitted(marginLeft) } : {}),
    ...(marginRight !== undefined ? { paddingInlineEnd: fitted(marginRight) } : {}),
    ...(space.before && spaceBefore !== undefined ? { paddingBlockStart: fitted(spaceBefore) } : {}),
    ...(space.after && spaceAfter !== undefined ? { paddingBlockEnd: fitted(spaceAfter) } : {}),
    textIndent: indentWords,
    lineHeight:
      lineHeightPx !== undefined
        ? fitted(lineHeightPx)
        : lineHeight === undefined
          ? undefined
          : cutLineHeight(lineHeight, space.lineCut ?? 0),
  };
}

/**
 * Where a list's mark sits (Session 55, Part 17a): in the room before its line's words, in the size, weight and
 * colour of the line's first words; a number in their font too (Gujarati and Devanagari digits drawn by their fonts).
 */
export function listMarkerBoxStyle(
  line: { mark: ListMark; label: string | null },
  first: Omit<TextRun, 'text'>,
  el: TextElement,
): CSSProperties {
  const size = first.size ?? el.style.fontSize;
  const markerSize = first.paragraph?.bulletSize ?? size * (first.paragraph?.bulletScale ?? 1);
  const room = line.label === null ? BULLET_ROOM : NUMBER_ROOM;
  const indent = first.paragraph?.marginLeft === undefined ? undefined : first.paragraph.indent;
  const markerRoom = indent !== undefined && indent < 0 ? -indent : room * size;
  return {
    display: 'inline-block',
    ...(first.paragraph
      ? { inlineSize: fitted(markerRoom), marginInlineStart: fitted(-markerRoom) }
      : { width: fitted(markerRoom), marginLeft: fitted(-markerRoom) }),
    textIndent: 0,
    textAlign: 'center',
    fontSize: fitted(markerSize),
    fontWeight: first.weight,
    ...(line.label === null && !first.paragraph?.bullet
      ? {}
      : {
          fontFamily: fontFamilyFor(
            first.paragraph?.bulletFont ?? first.font ?? el.style.fontFamily,
            first.lang ?? el.lang,
          ),
          ...(line.label === null
            ? { color: first.paragraph?.bulletColor ?? first.color }
            : listMarkerStyle(line.mark, first)),
        }),
  };
}

/**
 * The words of a box with a list in it (Session 55, Part 17a), line by line: each line a block, a list's line in by
 * its level with its mark in the room before its words (and its wrapped lines under its words, not its mark). Every
 * run keeps its look. While revealed line by line or word by word (Session 27), each line and word is its own, as
 * RevealRuns has them.
 */
function ListedRuns({ el, runs, reveal }: { el: TextElement; runs: readonly TextRun[]; reveal?: Reveal }) {
  const langOf = useHtmlLang();
  const lines = drawnLines(runs);
  // The box's last paragraph, decided before an empty one at the end is looked at (Session 58, PF-11): the paragraph
  // before that is not the last, so it keeps its space after, as in the slide editor.
  const last = lines.length - 1;
  const tail = lines.at(-1);
  const before = lines.at(-2);
  if (lines.length > 1 && tail?.pieces.length === 0) {
    // A deck's empty last paragraph (Enter at the end of its words) is drawn as PowerPoint lays it out (Session 58,
    // FT-7): one line, in the look of the paragraph before it (what PowerPoint's Enter carries on, as the deck reader
    // keeps no look of its own for it), with its space before, so a box aligned to its middle or bottom sits where
    // PowerPoint puts it. Words without a deck's paragraphs draw none there, as plain words never have.
    if (before?.end?.paragraph) tail.end = before.end;
    else lines.pop();
  }
  return (
    <>
      {lines.map((line, li) => {
        const first: Omit<TextRun, 'text'> = line.pieces[0]?.run ?? line.end ?? {};
        const size = first.size ?? el.style.fontSize;
        const { mark, label } = line.mark;
        const blank = line.pieces.every((p) => p.text.trim() === '');
        // Each line at its own largest size (Q58-54), so its CSS strut is that line's own, as PowerPoint lays each line
        // out (run 5): only where every run on it has its own size (a deck's), so no run takes a size it did not have.
        const sized = line.pieces.length > 0 ? line.pieces.map((p) => p.run.size) : [line.end?.size];
        const sizes = sized.filter((px): px is number => px !== undefined);
        const lineSize = sizes.length > 0 && sizes.length === sized.length ? Math.max(...sizes) : undefined;
        return (
          <div
            key={li}
            data-line={li}
            data-list={mark ?? undefined}
            data-reveal-line={reveal ? li : undefined}
            data-reveal-empty={reveal && blank ? '' : undefined}
            style={{
              position: reveal ? 'relative' : undefined,
              fontSize: fitted(ownSize(lineSize, el)),
              ...paragraphLineStyle(line.mark, size, first.paragraph, {
                before: el.style.spaceAtTextEdges === true || li > 0,
                after: el.style.spaceAtTextEdges === true || li < last,
                lineCut: sourceLineCut(el.style),
              }),
            }}
          >
            {mark !== null && (
              <span
                aria-hidden="true"
                data-list-marker={mark}
                style={listMarkerBoxStyle({ mark, label }, first, el)}
              >
                {label ?? first.paragraph?.bullet ?? <span style={listMarkerStyle(mark, first)} />}
              </span>
            )}
            {line.pieces.length === 0 ? (
              <span style={line.end ? runStyle(line.end, el) : undefined}>
                <br />
              </span>
            ) : (
              line.pieces.map((piece, pi) => {
                const lang = piece.run.lang ?? el.lang;
                const locale = langOf(lang);
                return (
                  <span
                    key={pi}
                    data-run={piece.index}
                    data-lang={piece.run.lang ?? undefined}
                    data-legacy={piece.run.legacy ? 'true' : undefined}
                    lang={locale}
                    style={runStyle(piece.run, el)}
                  >
                    {reveal === 'words'
                      ? wordUnits(piece.text, locale).map((unit, ui) => (
                          <span key={ui} data-reveal-word="" style={{ position: 'relative' }}>
                            {unit}
                          </span>
                        ))
                      : piece.text}
                  </span>
                );
              })
            )}
          </div>
        );
      })}
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
  const vertical = el.style.writingMode !== undefined;
  const noWrap = el.style.noWrap === true;
  const report = useMeasureReport();
  const passive = !on && report === null;
  const [fontsLoaded, setFontsLoaded] = useState(0);
  // Measured text must refit or report when a font arrives. The observer covers passive size changes.
  useEffect(() => {
    if (passive) return;
    const again = () => {
      setFontsLoaded((n) => n + 1);
    };
    document.fonts.addEventListener('loadingdone', again);
    return () => {
      document.fonts.removeEventListener('loadingdone', again);
    };
  }, [passive]);
  useEffect(() => () => report?.(el.id, null), [report, el.id]);
  useLayoutEffect(() => {
    if (!passive) return undefined;
    const b = box.current;
    const w = words.current;
    if (!b || !w) return undefined;
    if (b.style.getPropertyValue('--fit') !== '') b.style.removeProperty('--fit');
    if (b.hasAttribute('data-fit')) b.removeAttribute('data-fit');
    // These nodes stay mounted through text and font changes. Use the browser's completed sizes.
    return observeTextSizes(b, w, ({ width, height, wordsHeight }) => {
      const over = wordsHeight > (vertical ? width : height) + 0.5;
      if (b.hasAttribute('data-overset') !== over) b.toggleAttribute('data-overset', over);
    });
  }, [box, words, passive, vertical]);
  useLayoutEffect(() => {
    if (passive) return undefined;
    const b = box.current;
    const w = words.current;
    if (!b || !w) return undefined;
    const isOver = () => {
      if (vertical)
        return (
          Math.max(w.offsetWidth, w.scrollWidth) > b.clientWidth + 0.5 ||
          (noWrap && Math.max(w.offsetHeight, w.scrollHeight) > b.clientHeight + 0.5)
        );
      return (
        w.offsetHeight > b.clientHeight + 0.5 ||
        (noWrap && Math.max(w.offsetWidth, w.scrollWidth) > b.clientWidth + 0.5)
      );
    };
    // Searched (or, with shrink-to-fit off, only measured) with the other boxes drawn in this commit
    // (render/shrink-to-fit.ts).
    let live = true;
    const forget = queueFit({
      on,
      // A deck's box is drawn at PowerPoint's own shrunk size where its words fit at it (Session 58, PF-4b; Q58-42).
      guess: on ? sourceFitScale(el) : undefined,
      write: (fit) => {
        if (fit !== null) {
          b.style.setProperty('--fit', String(fit));
          return;
        }
        if (b.style.getPropertyValue('--fit') !== '') b.style.removeProperty('--fit');
        b.removeAttribute('data-fit');
      },
      over: isOver,
      settle: (fit, over) => {
        if (!live) return;
        // For tests and diagnostics: how much it was made smaller.
        if (on && fit < 1) b.setAttribute('data-fit', fit.toFixed(3));
        else if (on) b.removeAttribute('data-fit');
        // The words still past the box, at that fit.
        if (over) b.setAttribute('data-overset', '');
        else b.removeAttribute('data-overset');
        report?.(el.id, { over, fit });
      },
    });
    return () => {
      live = false;
      forget();
    };
  }, [box, words, el, on, passive, vertical, noWrap, fontsLoaded, again, report]);
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
    writingMode: s.writingMode,
    textOrientation: s.textOrientation,
    overflow: s.clipToBox ? 'hidden' : undefined,
    fontFamily: fontFamilyFor(s.fontFamily, el.lang),
    fontSize: fitted(ownSize(s.fontSize, el)),
    fontWeight: s.fontWeight,
    // A deck's box drawn with its line spacing as PowerPoint shrank it (Session 58, PF-4b; shared/source-fit.ts).
    lineHeight: cutLineHeight(s.lineHeight, sourceLineCut(s)),
    color: s.color,
    whiteSpace: s.noWrap ? 'pre' : 'pre-wrap',
    overflowWrap: s.noWrap ? undefined : 'anywhere',
    fontKerning: 'normal',
    // A glow (Session 55, Part 17a) with its shadow; with none, the shadow as it always was.
    textShadow: glowing(s.glow)
      ? textEffectsCss(s.shadow, s.glow)
      : s.shadow === false
        ? undefined
        : textShadowCss(s.shadow),
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
          inlineSize: el.style.noWrap ? 'max-content' : '100%',
          ...(el.style.noWrap ? { minInlineSize: '100%' } : {}),
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
        {el.runs && (hasList(el) || el.runs.some((run) => run.paragraph)) ? (
          // Keep source paragraph alignment and the positions of list marks.
          <ListedRuns el={el} runs={el.runs} reveal={reveal} />
        ) : reveal ? (
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
  !el.hidden && (el.kind === 'timer' || (el.kind === 'text' && el.text.trim() !== ''));

function Gradient({ id, paint }: { id: string; paint: GradientFill }) {
  const stops = paint.stops.map((stop, index) => (
    <stop key={index} offset={stop.offset} stopColor={stop.color} />
  ));
  if (paint.kind === 'radial')
    return (
      <radialGradient id={id} cx={paint.x} cy={paint.y} r={0.707107}>
        {stops}
      </radialGradient>
    );
  const radians = (paint.angle * Math.PI) / 180;
  const x = Math.cos(radians) / 2;
  const y = Math.sin(radians) / 2;
  return (
    <linearGradient id={id} x1={0.5 - x} x2={0.5 + x} y1={0.5 - y} y2={0.5 + y}>
      {stops}
    </linearGradient>
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
  const gradientId = useId();
  const stroke = el.outline && el.outline.width > 0 ? el.outline : null;
  const paint = {
    fill: kind === 'line' ? 'none' : el.gradient ? 'url(#' + gradientId + ')' : (el.fill ?? 'none'),
    stroke: stroke?.color ?? 'none',
    strokeWidth: stroke?.width ?? 0,
  };
  const radius = Math.min(el.cornerRadius, width / 2, height / 2);
  const drawing = kind === 'path' ? el.path : undefined;
  const path = drawing ? nativePathData(drawing, width, height) : shapePath(kind, width, height);
  if (kind === 'path' && !drawing) return null;
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
      {el.gradient && (
        <defs>
          <Gradient id={gradientId} paint={el.gradient} />
        </defs>
      )}
      {path ? (
        <path
          d={path}
          {...paint}
          fillRule={drawing?.fillRule}
          strokeLinecap={drawing?.lineCap}
          strokeLinejoin={drawing?.lineJoin}
        />
      ) : kind === 'ellipse' ? (
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
  const { width, height } = el.frame;
  const clip = el.pictureClip;
  const path = clip && shapePath(clip.shape, width, height);
  const radius = clip && Math.min(clip.cornerRadius ?? 0, width / 2, height / 2);
  const clipPath =
    clip?.shape === 'ellipse'
      ? 'ellipse(50% 50%)'
      : path
        ? 'path("' + path + '")'
        : radius
          ? 'inset(0 round ' + String(radius) + 'px)'
          : undefined;
  return { ...frameStyle(el), objectFit: OBJECT_FIT[el.fit], opacity: el.opacity ?? 1, clipPath };
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
  deckStep?: DeckVideoTiming | null;
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
  deckStep?: DeckVideoTiming | null;
}) {
  // On a node, a copy that landed after this picture was asked for: drawn again (a new element).
  const attempt = useMediaAttempt(el.mediaId);
  // A picture's look (Session 26e), and on the screens the live zoom of this slide's showing.
  const showing = startedAt === undefined ? null : slideShowing(startedAt);
  const previews = usePreviewsOnly();
  if (el.kind === 'image')
    return <SlidePicture el={el} showing={showing} attempt={attempt} previews={previews} />;
  // A phone or tablet: pictures and videos as small previews, and no video plays.
  if (previews)
    return deck && deckStep && videoShowsFrom(deck, deckStep) === null ? null : (
      // A deck's video outside its entrance and its exit (C review) shows nothing on a phone either.
      <PreviewPicture mediaId={el.mediaId} style={mediaStyle(el)} />
    );
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

/** A slide's own crop clips the library picture as drawn, preserving its library look and enhancements. */
function SlidePicture({
  el,
  showing,
  attempt,
  previews,
}: {
  el: MediaElement;
  showing: string | null;
  attempt: number;
  previews: boolean;
}) {
  const urlOf = useMediaUrl();
  const crop = el.crop;
  const width = el.frame.width / (crop?.width ?? 1);
  const height = el.frame.height / (crop?.height ?? 1);
  const style: CSSProperties = crop
    ? {
        position: 'absolute',
        // The image extends beyond this crop's viewport; the shared img max-width must not shrink it back.
        maxWidth: 'none',
        left: -crop.x * width,
        top: -crop.y * height,
        width,
        height,
        objectFit: OBJECT_FIT[el.fit],
      }
    : mediaStyle(el);
  const picture = (
    <Looked mediaId={el.mediaId} showing={showing} style={style} box={crop ? { width, height } : el.frame}>
      {(paint, copy) =>
        previews ? (
          <PreviewPicture mediaId={copy?.id ?? el.mediaId} style={paint} />
        ) : (
          <img
            key={attempt}
            data-element={crop ? undefined : el.id}
            data-media-id={el.mediaId}
            src={copy?.url ?? urlOf(el.mediaId, attempt)}
            alt=""
            draggable={false}
            style={paint}
          />
        )
      }
    </Looked>
  );
  return crop ? (
    <div data-element={el.id} data-slide-crop="" style={{ ...mediaStyle(el), overflow: 'hidden' }}>
      {picture}
    </div>
  ) : (
    picture
  );
}

function ElementBody({
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
  deckStep?: DeckVideoTiming | null;
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

function MovingElement({
  el,
  motion,
  at,
  children,
}: {
  el: SlideElement;
  motion: ElementMotion;
  at: number;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    let cancelWake: () => void = () => undefined;
    const tick = () => {
      cancelAnimationFrame(frame);
      cancelWake();
      const elapsed = engineFrameNow() - at;
      const f = motionFrame(motion, elapsed);
      if (root.current) {
        root.current.style.opacity = String(f.opacity);
        root.current.style.transform = `translate(${f.x}px, ${f.y}px) rotate(${f.rotate}deg) scale(${f.scale})`;
        root.current.dataset['motionAt'] = String(Math.max(0, Math.round(elapsed)));
      }
      if (clockHeld()) return;
      if (f.moving) frame = requestAnimationFrame(tick);
      else if (f.nextAt !== null) cancelWake = wakeAt(at + f.nextAt, engineNow, tick);
    };
    tick();
    const off = onClockJump(tick);
    return () => {
      off();
      cancelAnimationFrame(frame);
      cancelWake();
    };
  }, [motion, at]);
  return (
    <div
      ref={root}
      data-element-motion={el.id}
      style={{
        position: 'absolute',
        left: el.frame.x,
        top: el.frame.y,
        width: el.frame.width,
        height: el.frame.height,
        transformOrigin: 'center',
      }}
    >
      {children}
    </div>
  );
}

export function ElementView(props: Parameters<typeof ElementBody>[0] & { previewAt?: number }) {
  if (props.el.hidden) return null;
  const at = props.previewAt ?? props.startedAt;
  const motion = props.el.motion;
  if (
    !motion ||
    !hasElementMotion(motion) ||
    at === undefined ||
    (props.media === 'still' && props.previewAt === undefined)
  )
    return <ElementBody {...props} />;
  const el = { ...props.el, frame: { ...props.el.frame, x: 0, y: 0 } };
  return (
    <MovingElement el={props.el} motion={motion} at={at}>
      <ElementBody {...props} el={el} />
    </MovingElement>
  );
}

/** The slide's own picture/gradient, shared by every live view and by the editor's still canvas. */
export function SlideBackdropView({
  slide,
  media = 'still',
}: {
  slide: Pick<RenderSlide, 'id' | 'width' | 'height' | 'backdrop'>;
  media?: MediaMode;
}) {
  const bg = slide.backdrop;
  if (!bg) return null;
  if (bg.kind === 'gradient')
    return (
      <div
        data-slide-backdrop="gradient"
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`,
        }}
      />
    );
  return (
    <div data-slide-backdrop="picture" style={{ position: 'absolute', inset: 0 }}>
      <ElementBody
        el={{
          id: `backdrop-${slide.id}`,
          kind: 'image',
          mediaId: bg.mediaId,
          fit: bg.fit,
          frame: { x: 0, y: 0, width: slide.width, height: slide.height },
        }}
        media={media}
      />
    </div>
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
  const nativeStep = useNativeDeckTiming();
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
        {text !== 'only' && <SlideBackdropView slide={slide} media={media} />}
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
          el.hidden || (text === 'only' && el.kind !== 'text') ? null : el.id === deckPicture &&
            deck &&
            step &&
            el.kind === 'image' ? (
            // The picture's kept look and the live zoom (Session 26e) apply to the step drawn in its place, as to the
            // picture itself: it is the picture the engine zooms (Session 54, D2 review).
            <Looked
              key={el.id}
              mediaId={el.mediaId}
              showing={startedAt === undefined ? null : slideShowing(startedAt)}
              style={{ ...frameStyle(el), opacity: el.opacity ?? 1, objectFit: OBJECT_FIT[el.fit] }}
              box={el.frame}
            >
              {(box) => <DeckStepView deck={deck} timing={step} style={box} fit={OBJECT_FIT[el.fit]} />}
            </Looked>
          ) : (
            <NativeDeckElement key={el.id} element={el}>
              {(placed) => (
                <ElementView
                  el={placed}
                  media={media}
                  startedAt={startedAt}
                  clips={clips}
                  seeks={seeks}
                  textHidden={text === 'hidden'}
                  reveal={text === 'only' ? reveal : undefined}
                  band={darken?.kind === 'band' && darkensBehind(el) ? darken.strength : undefined}
                  deck={deck && el.kind === 'video' ? deckMediaOf(slide, el.mediaId, 'video') : undefined}
                  deckStep={step ?? nativeStep}
                />
              )}
            </NativeDeckElement>
          ),
        ])}
      </div>
    </TranslitSourceContext.Provider>
  );
});
