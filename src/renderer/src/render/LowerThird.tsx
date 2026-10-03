import type { LowerThirdLine } from '../../../shared/program';
import type { Size } from '../../../shared/scaling';
import { fontFamilyFor, HTML_LANG } from './fonts';

/*
 * A slide's words as a lower third: the stream's Camera and words layout
 * draws it over the camera, and a screen group whose Look draws slides as a
 * lower third draws it over its own picture (a key and fill pair keys it over
 * a camera in a video switcher).
 */

/** The slide's words along the bottom of the picture, in a dark box; `lift` canvas pixels higher (above the ticker). */
export function LowerThird({
  lines,
  canvas,
  lift = 0,
}: {
  lines: LowerThirdLine[];
  canvas: Size;
  lift?: number;
}) {
  const size = canvas.height * (lines.length <= 2 ? 0.05 : lines.length === 3 ? 0.044 : 0.037);
  return (
    <div
      data-testid="lower-third"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: canvas.height * 0.06 + lift,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          maxWidth: canvas.width * 0.88,
          padding: `${size * 0.35}px ${size * 0.9}px`,
          borderRadius: size * 0.3,
          background: 'rgba(0, 0, 0, 0.62)',
          color: '#ffffff',
          textAlign: 'center',
          fontSize: size,
          fontWeight: 600,
          lineHeight: 1.3,
          textShadow: '0 2px 6px rgba(0, 0, 0, 0.6)',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            data-lang={line.lang ?? ''}
            lang={line.lang ? HTML_LANG[line.lang] : undefined}
            style={{ fontFamily: fontFamilyFor(null, line.lang) }}
          >
            {line.runs.map((run, j) => (
              // Words typed in a legacy font keep their font; everything else takes the lower third's look.
              <span
                key={j}
                style={
                  run.legacy ? { fontFamily: fontFamilyFor(run.font ?? line.boxFont, line.lang) } : undefined
                }
              >
                {run.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
