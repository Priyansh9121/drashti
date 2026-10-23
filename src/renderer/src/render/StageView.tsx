import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import { languageView } from '../../../shared/language-view';
import type { Lang, RenderSlide, TextElement, TimerElement } from '../../../shared/model';
import type { TimerState } from '../../../shared/timers';
import { fontFamilyFor } from './fonts';
import { htmlLang, textLang } from './lang';
import { translitSource } from '../../../shared/tracks';
import { TimerText } from './TimerText';
import { useNow } from './useNow';
import { ClockStyleContext } from './clock-style';
import { type ClockStyle, formatClock } from '../../../shared/format';

/**
 * What a stage screen says is up when no slide is: the background's kind, never the picture itself (another
 * app's window, Session 48, and a video input, Session 50, as a video).
 */
export function backgroundWords(background: EngineState['layers']['background']): string {
  if (background?.kind === 'media')
    return `${background.media === 'image' ? 'Picture' : 'Video'} on the screens`;
  if (background?.kind === 'window') return 'Window on the screens';
  if (background?.kind === 'input') return 'Video input on the screens';
  return 'Nothing on the screens';
}

/**
 * What the audience screens show, as a stage layout's box of their state says it. Off first (Session 51: with
 * Audience off they show this computer's desktop, whatever is up), then black-out, the logo, a picture or nothing.
 */
export function screensStateWords(state: EngineState, off: boolean): string {
  if (off) return 'Audience screens off';
  if (state.blackout) return 'Audience screens black';
  if (state.logo) return 'Logo on the audience screens';
  return state.layers.slide || state.layers.background
    ? 'Audience screens showing'
    : 'Nothing on the audience screens';
}

/** The same beside NOW on the Standard stage screen: said only when they do not show the picture. */
export function screensStateNote(state: EngineState, off: boolean): string {
  if (off) return ' · AUDIENCE SCREENS OFF';
  if (state.blackout) return ' · AUDIENCE SCREENS BLACK';
  return state.logo ? ' · LOGO ON THE AUDIENCE SCREENS' : '';
}

/*
 * The stage screen (PLAN.md 4.3): what the performers need, in large text
 * on black. The slide on the screens and the one after it, the slide's
 * notes, the clock, and a message from the operator that the audience never
 * sees. No backgrounds, pictures or videos. One layout for now; layouts of
 * one's own are Phase 3.
 */

export const kindName = { image: 'Picture', video: 'Video', audio: 'Sound' } as const;

const textElements = (slide: RenderSlide) =>
  slide.elements.filter((e): e is TextElement => e.kind === 'text' && e.text.trim() !== '');

/** A slide's Timers (Session 50): a stage screen shows their time, live, after its words. */
const timerElements = (slide: RenderSlide) =>
  slide.elements.filter((e): e is TimerElement => e.kind === 'timer');

/** Smaller type for longer text: the size a slide's words start from (and never go above) on the Standard stage. */
function sizeFor(slide: RenderSlide, base: number): number {
  const chars = textElements(slide).reduce((n, e) => n + e.text.length, 0);
  if (chars > 400) return Math.round(base * 0.45);
  if (chars > 240) return Math.round(base * 0.6);
  if (chars > 120) return Math.round(base * 0.78);
  return base;
}

/**
 * A slide's words in their own fonts (legacy fonts included), one box after
 * another, in one size and colour (left out: the size and colour around it,
 * as a stage layout's box sets them); then its Timers' time, live (Session 50).
 */
export function StageText({
  slide,
  size,
  dim = false,
  timers = [],
}: {
  slide: RenderSlide;
  size?: number;
  dim?: boolean;
  /** The state's timers, for the slide's Timers. */
  timers?: readonly TimerState[];
}) {
  // What its transliteration is of (Sessions 31–36, I18N-4), for the words' lang.
  const source = slide.translitOf ?? translitSource(slide.elements);
  return (
    <div
      style={{
        // Times the Standard stage's own fit (StageFit): 1, as before, unless the words would not fit.
        fontSize: size === undefined ? undefined : `calc(${String(size)}px * var(--stage-fit, 1))`,
        lineHeight: 1.25,
        color: size === undefined ? undefined : dim ? '#c9ced8' : '#ffffff',
      }}
    >
      {textElements(slide).map((el) => (
        <p
          key={el.id}
          data-stage-element={el.id}
          lang={el.lang ? htmlLang(el.lang, source) : undefined}
          style={{
            margin: '0 0 0.35em',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            fontFamily: fontFamilyFor(el.style.fontFamily, el.lang),
          }}
        >
          {el.runs && el.runs.length > 0
            ? el.runs.map((run, i) => {
                const lang = run.lang ?? el.lang;
                return (
                  <span
                    key={i}
                    lang={lang ? htmlLang(lang, source) : undefined}
                    style={{ fontFamily: fontFamilyFor(run.font ?? el.style.fontFamily, lang) }}
                  >
                    {run.text}
                  </span>
                );
              })
            : el.text}
        </p>
      ))}
      {timerElements(slide).map((el) => (
        <p
          key={el.id}
          data-stage-element={el.id}
          data-stage-timer={el.timerId}
          style={{ margin: '0 0 0.35em', whiteSpace: 'nowrap' }}
        >
          <TimerText timer={timers.find((t) => t.id === el.timerId)} />
        </p>
      ))}
    </div>
  );
}

/** The smallest the Standard stage makes a slide's words: a fifth of the size they start from. */
const STAGE_MIN_FIT = 0.2;

/**
 * The Standard stage's box for a slide's words, measured to fit (Sessions 31–36, SLD-7): the words start
 * at today's size for their length and only ever get smaller, so a long slide's last line shows. The box
 * says how far (data-stage-fit) for tests; with words that fit, nothing changes.
 */
function StageFit({ testId, children }: { testId: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [fontsAndSize, setFontsAndSize] = useState(0);
  // What it was last measured for: the clock's tick re-draws the stage every second, and must not measure.
  const measured = useRef('');
  // A font arriving, or the screen changing size, changes how far the words reach.
  useEffect(() => {
    const again = () => {
      setFontsAndSize((n) => n + 1);
    };
    document.fonts.addEventListener('loadingdone', again);
    const b = box.current;
    const sized = b ? new ResizeObserver(again) : null;
    if (b) sized?.observe(b);
    return () => {
      document.fonts.removeEventListener('loadingdone', again);
      sized?.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    const words = b.firstElementChild;
    const key = `${String(fontsAndSize)} ${words?.textContent ?? ''}`;
    if (key === measured.current) return;
    measured.current = key;
    if (!(words instanceof HTMLElement)) return;
    const fits = (fit: number) => {
      b.style.setProperty('--stage-fit', String(fit));
      return words.offsetHeight <= b.clientHeight + 0.5;
    };
    // The usual case, words that fit as they are: nothing is written.
    const shrunk = b.style.getPropertyValue('--stage-fit') !== '';
    if (!shrunk && words.offsetHeight <= b.clientHeight + 0.5) return;
    let lo = 1;
    if (!fits(1)) {
      lo = STAGE_MIN_FIT;
      let hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      fits(lo);
    }
    if (lo < 1) b.setAttribute('data-stage-fit', lo.toFixed(3));
    else {
      b.style.removeProperty('--stage-fit');
      b.removeAttribute('data-stage-fit');
    }
  });
  return (
    <div ref={box} data-testid={testId} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {children}
    </div>
  );
}

const label = {
  fontSize: 30,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#8b93a3',
  margin: 0,
} as const;

export function StageView({
  state,
  languages = null,
  clockStyle,
  audienceOff = false,
}: {
  state: EngineState;
  /** The languages the stage screens show of a kirtan's slides, in order; null for all of them. */
  languages?: readonly Lang[] | null;
  /** How to write the time: Drashti's computer's way, on a stage display in another device's browser. */
  clockStyle?: ClockStyle | null;
  /** The hall's screens are off (Audience off, Session 51): said beside NOW. */
  audienceOff?: boolean;
}) {
  const now = useNow();
  const slide = state.layers.slide;
  const next = state.next;
  // Main's way of writing the time (Sessions 31–36, I18N-8): given, or the page's.
  const pageStyle = useContext(ClockStyleContext);
  const clock = formatClock(now, clockStyle ?? pageStyle);
  const background = state.layers.background;
  return (
    <div
      data-testid="stage-view"
      style={{
        position: 'absolute',
        inset: 0,
        background: '#000000',
        color: '#ffffff',
        fontFamily: fontFamilyFor(null, null),
        display: 'flex',
        flexDirection: 'column',
        padding: 48,
        gap: 28,
      }}
    >
      {state.stageMessage !== null && (
        <div
          data-testid="stage-message"
          lang={textLang(state.stageMessage)}
          style={{
            background: '#f5a524',
            color: '#000000',
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.2,
            padding: '16px 32px',
            borderRadius: 16,
            overflowWrap: 'anywhere',
          }}
        >
          {state.stageMessage}
        </div>
      )}
      <div style={{ display: 'flex', gap: 48, flex: 1, minHeight: 0 }}>
        <section style={{ flex: 3, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={label}>
            NOW
            {screensStateNote(state, audienceOff)}
          </p>
          {/* A timer shown alone (Session 50): named, its time in the box. */}
          {slide?.timer && (
            <p data-testid="stage-timer-alone" style={{ fontSize: 40, color: '#8b93a3', margin: 0 }}>
              Timer: {slide.timer.name}
            </p>
          )}
          <StageFit testId="stage-current">
            {slide ? (
              <StageText
                slide={languageView(slide.slide, languages)}
                size={sizeFor(languageView(slide.slide, languages), 92)}
                timers={state.timers}
              />
            ) : (
              <p style={{ fontSize: 56, color: '#6b7280', margin: 0 }}>{backgroundWords(background)}</p>
            )}
          </StageFit>
          {slide && slide.notes.trim() !== '' && (
            <div
              data-testid="stage-notes"
              lang={textLang(slide.notes)}
              style={{
                fontSize: 40,
                lineHeight: 1.3,
                color: '#fde68a',
                borderTop: '3px solid #3f3f46',
                paddingTop: 16,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: '32%',
                overflow: 'hidden',
              }}
            >
              {slide.notes}
            </div>
          )}
        </section>
        <aside style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            data-testid="stage-clock"
            style={{
              fontSize: 120,
              fontWeight: 700,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'right',
            }}
          >
            {clock}
          </div>
          {state.timers
            .filter((t) => t.kind !== 'clock' && (t.startedAt !== null || t.elapsedMs > 0))
            .map((t) => (
              <div
                key={t.id}
                data-testid="stage-timer"
                style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 24 }}
              >
                <span style={{ fontSize: 36, color: '#8b93a3', overflowWrap: 'anywhere' }}>
                  {t.name}
                  {t.startedAt === null ? ' (paused)' : ''}
                </span>
                <span style={{ fontSize: 96, fontWeight: 700, lineHeight: 1, color: '#fde68a' }}>
                  <TimerText timer={t} />
                </span>
              </div>
            ))}
          <p style={label}>NEXT</p>
          <StageFit testId="stage-next">
            {next?.kind === 'slide' ? (
              <StageText
                slide={languageView(next.slide, languages)}
                size={sizeFor(languageView(next.slide, languages), 56)}
                dim
                timers={state.timers}
              />
            ) : next?.kind === 'media' ? (
              <p
                style={{ fontSize: 48, color: '#c9ced8', margin: 0 }}
              >{`${kindName[next.media]}: ${next.label}`}</p>
            ) : next?.kind === 'input' ? (
              // A video input item (Session 51): named, as a stage screen never draws it.
              <p style={{ fontSize: 48, color: '#c9ced8', margin: 0 }}>{`Video input: ${next.name}`}</p>
            ) : (
              <p style={{ fontSize: 48, color: '#6b7280', margin: 0 }}>End</p>
            )}
          </StageFit>
        </aside>
      </div>
    </div>
  );
}
