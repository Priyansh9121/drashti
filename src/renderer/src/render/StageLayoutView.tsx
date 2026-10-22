import type { ReactNode } from 'react';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { festivalsLine, samvatLine } from '../../../shared/calendar';
import { QUOTE_LANGS } from '../../../shared/idle';
import type { EngineState } from '../../../shared/engine/state';
import { languageView } from '../../../shared/language-view';
import { type PlaybackClock, playbackLeftMs } from '../../../shared/media';
import type { Lang } from '../../../shared/model';
import type { HallPicture, StageBox, StageLayout } from '../../../shared/stage-layouts';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../../shared/stage-layouts';
import { timerDuration } from '../../../shared/timers';
import { AudienceBox } from './AudienceBox';
import { fontFamilyFor, LANG_FONT_STACK } from './fonts';
import { backgroundWords, kindName, StageText } from './StageView';
import { textLang } from './lang';
import { TimerText } from './TimerText';
import { useNow } from './useNow';
import { ClockStyleContext } from './clock-style';
import { type ClockStyle, formatClock } from '../../../shared/format';

/*
 * A stage layout made in Drashti (shared/stage-layouts.ts): its boxes on a
 * 1920 x 1080 canvas, each with what it shows, in its size (or as large as
 * fits), colour and alignment. The stage screens, the stage display in a
 * browser and the layout editor's picture all draw it with this. No
 * pictures or videos, as on the Standard stage screen, but in the audience
 * picture box (Session 50, AudienceBox): the hall's own picture.
 */

/** The largest font size a box tries when it fits its words (canvas pixels). */
const FIT_MAX = 400;
const FIT_MIN = 8;

/**
 * A box's contents at its size, or (size 'fit') as large as fits: the largest
 * font size at which the contents fit the box, found by measuring.
 */
function Sized({ size, children, again }: { size: number | 'fit'; children: ReactNode; again: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    if (size !== 'fit') return;
    const loaded = () => {
      setFonts((n) => n + 1);
    };
    document.fonts.addEventListener('loadingdone', loaded);
    return () => {
      document.fonts.removeEventListener('loadingdone', loaded);
    };
  }, [size]);
  useLayoutEffect(() => {
    const b = box.current;
    const w = inner.current;
    if (!b || !w || size !== 'fit') return;
    const fits = (px: number) => {
      w.style.fontSize = `${px}px`;
      return w.offsetHeight <= b.clientHeight + 0.5 && w.scrollWidth <= b.clientWidth + 0.5;
    };
    let lo = FIT_MIN;
    let hi = Math.min(FIT_MAX, Math.max(FIT_MIN, b.clientHeight));
    if (fits(hi)) lo = hi;
    else
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
    w.style.fontSize = `${Math.floor(lo)}px`;
    b.setAttribute('data-fit-size', String(Math.floor(lo)));
  }, [size, again, fonts]);
  return (
    <div ref={box} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div ref={inner} style={size === 'fit' ? undefined : { fontSize: size }}>
        {children}
      </div>
    </div>
  );
}

/**
 * How long is left on a playing file: its pass, when it loops; held where it is while paused (music). To its
 * end point, and from where it jumped to (a marker, Back 15 s, Forward 15 s or Last 10 s: Session 50).
 */
function leftOn(
  layer: PlaybackClock & { durationMs?: number; pausedAtMs?: number },
  now: number,
): number | null {
  const d = layer.durationMs;
  if (d === undefined || d <= 0) return null;
  return playbackLeftMs(layer, d, now);
}

const muted = '#8b93a3';

/** A small label above a box's contents. */
function BoxLabel({ label }: { label: string }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 30,
        fontWeight: 700,
        letterSpacing: '0.08em',
        lineHeight: 1.25,
        fontFamily: fontFamilyFor(null, null),
        color: muted,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {label}
    </p>
  );
}

function BoxContents({
  box,
  state,
  languages,
  clock,
  now,
}: {
  box: StageBox;
  state: EngineState;
  languages: readonly Lang[] | null;
  clock: string;
  now: number;
}): ReactNode {
  const slide = state.layers.slide;
  switch (box.kind) {
    case 'current':
      if (slide) return <StageText slide={languageView(slide.slide, languages)} timers={state.timers} />;
      return <p style={{ margin: 0, color: muted }}>{backgroundWords(state.layers.background)}</p>;
    case 'next': {
      const next = state.next;
      if (next?.kind === 'slide')
        return <StageText slide={languageView(next.slide, languages)} timers={state.timers} />;
      if (next?.kind === 'media')
        return <p style={{ margin: 0 }}>{`${kindName[next.media]}: ${next.label}`}</p>;
      // A video input item (Session 51): named, as the screens never draw it here.
      if (next?.kind === 'input') return <p style={{ margin: 0 }}>{`Video input: ${next.name}`}</p>;
      return <p style={{ margin: 0, color: muted }}>End</p>;
    }
    case 'notes':
      return slide && slide.notes.trim() !== '' ? (
        <p
          lang={textLang(slide.notes)}
          style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {slide.notes}
        </p>
      ) : null;
    case 'clock': {
      const time = <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{clock}</span>;
      if (!box.calendar || !state.calendar) return time;
      const lang = box.lang ?? 'gu';
      return (
        <div>
          <div>{time}</div>
          <div
            lang={lang}
            data-samvat={lang}
            style={{ fontSize: '0.36em', fontFamily: LANG_FONT_STACK[lang] }}
          >
            {samvatLine(state.calendar, lang)}
          </div>
        </div>
      );
    }
    case 'quote': {
      const quote = state.quote;
      if (!quote) return null;
      return (
        <div data-quote={quote.id}>
          {QUOTE_LANGS.filter((l) => quote.words[l] !== undefined).map((l) => (
            <p key={l} lang={l} style={{ margin: 0, fontFamily: LANG_FONT_STACK[l], whiteSpace: 'pre-wrap' }}>
              {quote.words[l]}
            </p>
          ))}
          {quote.attribution !== '' && (
            <p style={{ margin: 0, fontSize: '0.6em', color: muted }}>— {quote.attribution}</p>
          )}
        </div>
      );
    }
    case 'samvat': {
      const day = state.calendar;
      if (!day) return null;
      const lang = box.lang ?? 'gu';
      const festivals = festivalsLine(day, lang);
      return (
        <div lang={lang} data-samvat={lang} style={{ fontFamily: LANG_FONT_STACK[lang] }}>
          <div>{samvatLine(day, lang)}</div>
          {festivals && <div style={{ fontWeight: 700 }}>{festivals}</div>}
        </div>
      );
    }
    case 'timer': {
      if (box.timerId) {
        const timer = state.timers.find((t) => t.id === box.timerId);
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            <TimerText timer={timer} />
          </span>
        );
      }
      const running = state.timers.filter(
        (t) => t.kind !== 'clock' && (t.startedAt !== null || t.elapsedMs > 0),
      );
      return (
        <div>
          {running.map((t) => (
            <div key={t.id} data-stage-timer={t.id} style={{ whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: '0.4em', color: muted, marginRight: '0.4em' }}>
                {t.name}
                {t.startedAt === null ? ' (paused)' : ''}
              </span>
              <TimerText timer={t} />
            </div>
          ))}
        </div>
      );
    }
    case 'stageMessage':
      return state.stageMessage !== null ? (
        <div
          data-testid="stage-box-message"
          lang={textLang(state.stageMessage)}
          style={{
            background: '#f5a524',
            borderRadius: '0.25em',
            padding: '0.15em 0.4em',
            fontWeight: 700,
            overflowWrap: 'anywhere',
          }}
        >
          {state.stageMessage}
        </div>
      ) : null;
    case 'upcoming':
      return state.upcoming.length > 0 ? (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {state.upcoming.slice(0, box.count ?? 4).map((item) => (
            <li
              key={item.id}
              style={
                item.kind === 'header'
                  ? {
                      color: muted,
                      fontSize: '0.7em',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      marginTop: '0.3em',
                    }
                  : { overflowWrap: 'anywhere' }
              }
            >
              {item.kind === 'header' ? item.label.toUpperCase() : item.label}
            </li>
          ))}
        </ol>
      ) : (
        <p style={{ margin: 0, color: muted }}>End of the playlist</p>
      );
    case 'mediaLeft': {
      const bg = state.layers.background;
      const audio = state.layers.audio;
      const video = bg?.kind === 'media' && bg.media === 'video' ? leftOn(bg, now) : null;
      const sound = audio ? leftOn(audio, now) : null;
      const rows: [string, number][] = [];
      if (video !== null) rows.push(['Video', video]);
      if (sound !== null) rows.push(['Sound', sound]);
      return rows.length > 0 ? (
        <div>
          {rows.map(([what, ms]) => (
            <div key={what} style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontSize: '0.4em', color: muted, marginRight: '0.4em' }}>{what}</span>
              {timerDuration(ms, true)}
            </div>
          ))}
        </div>
      ) : null;
    }
    case 'screensState':
      return (
        <span>
          {state.blackout
            ? 'Audience screens black'
            : state.logo
              ? 'Logo on the audience screens'
              : state.layers.slide || state.layers.background
                ? 'Audience screens showing'
                : 'Nothing on the audience screens'}
        </span>
      );
    case 'audience':
      // Drawn by the box itself (AudienceBox), never as words.
      return null;
    case 'text':
      return (
        <p
          lang={textLang(box.text ?? '')}
          style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {box.text ?? ''}
        </p>
      );
  }
}

export function StageLayoutView({
  layout,
  state,
  languages = null,
  clockStyle,
  hall,
}: {
  layout: StageLayout;
  state: EngineState;
  /** The languages the group shows of a kirtan's slides, in order; null for all of them. */
  languages?: readonly Lang[] | null;
  /** How to write the time: Drashti's computer's way, on a stage display in another device's browser. */
  clockStyle?: ClockStyle | null;
  /**
   * The hall's group and canvas, for an audience picture box (Session 50); unknown: every layer and
   * language at 1920 x 1080.
   */
  hall?: HallPicture | null;
}) {
  const now = useNow(250);
  // Main's way of writing the time (Sessions 31–36, I18N-8): given, or the page's.
  const pageStyle = useContext(ClockStyleContext);
  const clock = formatClock(now, clockStyle ?? pageStyle);
  return (
    <div
      data-testid="stage-layout"
      data-layout={layout.id}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        overflow: 'hidden',
        background: layout.background,
      }}
    >
      {layout.boxes.map((box) => (
        <div
          key={box.id}
          data-stage-box={box.kind}
          data-box-id={box.id}
          style={{
            position: 'absolute',
            left: box.frame.x,
            top: box.frame.y,
            width: box.frame.width,
            height: box.frame.height,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            // The hall's picture (Session 50) takes on nothing from around it (a colour, a font, a line
            // height, an alignment), so it draws exactly as on the hall's own screens.
            ...(box.kind === 'audience'
              ? {}
              : {
                  color: box.color,
                  fontFamily: fontFamilyFor(null, null),
                  textAlign: box.align,
                  lineHeight: 1.25,
                }),
          }}
        >
          {box.label !== '' && <BoxLabel label={box.label} />}
          {box.kind === 'audience' ? (
            <AudienceBox state={state} hall={hall} />
          ) : (
            <Sized size={box.size} again={`${box.kind}|${clock}|${JSON.stringify(contentKey(box, state))}`}>
              <BoxContents box={box} state={state} languages={languages} clock={clock} now={now} />
            </Sized>
          )}
        </div>
      ))}
    </div>
  );
}

/** What a box shows, so a box that fits its words measures again when they change. */
function contentKey(box: StageBox, state: EngineState): unknown {
  switch (box.kind) {
    case 'current':
      return [state.layers.slide?.slide.id, state.layers.slide?.shownAt, state.layers.background?.kind];
    case 'next':
      return state.next;
    case 'notes':
      return state.layers.slide?.notes;
    case 'timer':
      return state.timers.map((t) => [t.id, t.startedAt, t.elapsedMs]);
    case 'stageMessage':
      return state.stageMessage;
    case 'upcoming':
      return state.upcoming;
    case 'mediaLeft':
      return [state.layers.background, state.layers.audio];
    case 'screensState':
      return [state.blackout, state.logo?.id, state.layers.slide?.slide.id, state.layers.background?.kind];
    case 'clock':
    case 'samvat':
      return [box.calendar, box.lang, state.calendar];
    case 'quote':
      return state.quote;
    case 'audience':
      return null;
    case 'text':
      return box.text;
  }
}
