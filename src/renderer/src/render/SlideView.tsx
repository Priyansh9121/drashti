import type { CSSProperties } from 'react';
import { memo } from 'react';
import type { RenderSlide, ShapeElement, SlideElement, TextElement, TextRun } from '../../../shared/model';
import { fontFamilyFor, HTML_LANG } from './fonts';

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

export function ElementView({ el }: { el: SlideElement }) {
  return el.kind === 'text' ? <TextView el={el} /> : <ShapeView el={el} />;
}

/** One slide at its design size. Parents scale it with Placed. */
export const SlideView = memo(function SlideView({ slide }: { slide: RenderSlide }) {
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
        <ElementView key={el.id} el={el} />
      ))}
    </div>
  );
});
