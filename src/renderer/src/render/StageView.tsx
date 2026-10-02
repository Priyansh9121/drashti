import type { EngineState } from '../../../shared/engine/state';
import { languageView } from '../../../shared/language-view';
import type { Lang, RenderSlide, TextElement } from '../../../shared/model';
import { fontFamilyFor, HTML_LANG } from './fonts';
import { TimerText } from './TimerText';
import { useNow } from './useNow';

/*
 * The stage screen (PLAN.md 4.3): what the performers need, in large text
 * on black. The slide on the screens and the one after it, the slide's
 * notes, the clock, and a message from the operator that the audience never
 * sees. No backgrounds, pictures or videos. One layout for now; layouts of
 * one's own are Phase 3.
 */

const kindName = { image: 'Picture', video: 'Video', audio: 'Sound' } as const;

const textElements = (slide: RenderSlide) =>
  slide.elements.filter((e): e is TextElement => e.kind === 'text' && e.text.trim() !== '');

/** Smaller type for longer text, so a slide always fits its box. */
function sizeFor(slide: RenderSlide, base: number): number {
  const chars = textElements(slide).reduce((n, e) => n + e.text.length, 0);
  if (chars > 400) return Math.round(base * 0.45);
  if (chars > 240) return Math.round(base * 0.6);
  if (chars > 120) return Math.round(base * 0.78);
  return base;
}

/** A slide's words in their own fonts (legacy fonts included), one box after another, in one size and colour. */
function StageText({ slide, size, dim = false }: { slide: RenderSlide; size: number; dim?: boolean }) {
  return (
    <div style={{ fontSize: size, lineHeight: 1.25, color: dim ? '#c9ced8' : '#ffffff' }}>
      {textElements(slide).map((el) => (
        <p
          key={el.id}
          data-stage-element={el.id}
          lang={el.lang ? HTML_LANG[el.lang] : undefined}
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
                    lang={lang ? HTML_LANG[lang] : undefined}
                    style={{ fontFamily: fontFamilyFor(run.font ?? el.style.fontFamily, lang) }}
                  >
                    {run.text}
                  </span>
                );
              })
            : el.text}
        </p>
      ))}
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
}: {
  state: EngineState;
  /** The languages the stage screens show of a kirtan's slides, in order; null for all of them. */
  languages?: readonly Lang[] | null;
}) {
  const now = useNow();
  const slide = state.layers.slide;
  const next = state.next;
  const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
            {state.blackout
              ? ' · AUDIENCE SCREENS BLACK'
              : state.logo
                ? ' · LOGO ON THE AUDIENCE SCREENS'
                : ''}
          </p>
          <div data-testid="stage-current" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {slide ? (
              <StageText
                slide={languageView(slide.slide, languages)}
                size={sizeFor(languageView(slide.slide, languages), 92)}
              />
            ) : (
              <p style={{ fontSize: 56, color: '#6b7280', margin: 0 }}>
                {background?.kind === 'media'
                  ? `${background.media === 'image' ? 'Picture' : 'Video'} on the screens`
                  : 'Nothing on the screens'}
              </p>
            )}
          </div>
          {slide && slide.notes.trim() !== '' && (
            <div
              data-testid="stage-notes"
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
          <div data-testid="stage-next" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {next?.kind === 'slide' ? (
              <StageText
                slide={languageView(next.slide, languages)}
                size={sizeFor(languageView(next.slide, languages), 56)}
                dim
              />
            ) : next?.kind === 'media' ? (
              <p
                style={{ fontSize: 48, color: '#c9ced8', margin: 0 }}
              >{`${kindName[next.media]}: ${next.label}`}</p>
            ) : (
              <p style={{ fontSize: 48, color: '#6b7280', margin: 0 }}>End</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
