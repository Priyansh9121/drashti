import { useRef, type RefObject } from 'react';
import { CAPTION_TEXT_HEIGHT, type CaptionScreen } from '../../../shared/captions';
import { captionBandFor } from '../../../shared/video-caption-display';
import { useVideoCaptionClock } from './useVideoCaptionClock';
import { useCaptionAvoidance } from './caption-avoidance';
import type { EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import type { Lang } from '../../../shared/model';
import { fontFamilyFor, HTML_LANG } from './fonts';

/**
 * Live captions (Session 55, Part 10, engine state 26) on a screen of this canvas: the last one or two lines heard,
 * white on a dark band, centred along the bottom (or the top), as big as the admin chose (on a 1080-line screen 45,
 * 56 or 70 pixels). The stream and the stage always draw them; the audience screens only when chosen
 * (shared/captions.ts). `lift` keeps them above a band already along the bottom (the ticker).
 */
export function CaptionsView({
  state,
  canvas,
  screen,
  lift = 0,
  videoRoot,
}: {
  state: EngineState;
  canvas: Size;
  screen: CaptionScreen;
  lift?: number;
  videoRoot?: RefObject<HTMLDivElement | null>;
}) {
  const band = useRef<HTMLDivElement>(null);
  const actual = useVideoCaptionClock(state, screen, videoRoot);
  const captions = captionBandFor(state, screen, actual);
  useCaptionAvoidance(
    videoRoot,
    band,
    canvas,
    captions?.place,
    lift,
    captions?.lines.join('\n') ?? '',
    state.layers,
  );
  if (!captions) return null;
  const baseLanguage = captions.language.split('-')[0];
  const language: Lang =
    captions.language === 'sa-Gujr'
      ? 'sa-gu'
      : ((['en', 'gu', 'hi', 'sa'] as const).find((lang) => lang === baseLanguage) ?? 'en');
  const px = Math.round(canvas.height * CAPTION_TEXT_HEIGHT[captions.size]);
  const edge = Math.round(canvas.height * 0.04) + (captions.place === 'bottom' ? lift : 0);
  return (
    <div
      ref={band}
      data-testid="captions"
      data-source={captions.source}
      data-screen={screen}
      data-size={captions.size}
      data-place={captions.place}
      lang={captions.language === 'und' ? HTML_LANG[language] : captions.language}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: Math.round(canvas.width * 0.05),
        right: Math.round(canvas.width * 0.05),
        ...(captions.place === 'top' ? { top: edge } : { bottom: edge }),
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.75)',
          color: '#ffffff',
          fontFamily: fontFamilyFor(null, language),
          fontSize: px,
          fontWeight: 500,
          lineHeight: 1.3,
          padding: `${String(Math.round(px * 0.15))}px ${String(Math.round(px * 0.45))}px`,
          borderRadius: Math.round(px * 0.18),
          textAlign: 'center',
          maxWidth: '100%',
        }}
      >
        {captions.lines.map((line, i) => (
          <div key={`${String(i)}:${line}`} style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
