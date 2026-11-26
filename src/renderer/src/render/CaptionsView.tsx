import { useLayoutEffect, useRef, type RefObject } from 'react';
import { CAPTION_TEXT_HEIGHT, type CaptionScreen } from '../../../shared/captions';
import { captionBandFor } from '../../../shared/video-caption-display';
import { useVideoCaptionClock } from './useVideoCaptionClock';
import { fittedCaptionFont, prepareCaptionFont } from './caption-fit';
import { useCaptionAvoidance } from './caption-avoidance';
import type { EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import type { Lang } from '../../../shared/model';
import { fontFamilyFor, HTML_LANG } from './fonts';

/**
 * Live captions (Session 55, Part 10, engine state 26) on a screen of this canvas: the last one or two lines heard,
 * white on a dark band, centred along the bottom (or the top), as big as the admin chose (on a 1080-line screen 45,
 * 56 or 70 pixels). The stream and the stage always draw them; the audience screens only when chosen
 * (shared/captions.ts). `lift` keeps them above a band already along the bottom (the ticker). Translated (alpha.24,
 * QA24-CAPLANG-2): the audience screens and the stream draw the translation, one two-line page at a time and never cut
 * with "…", and nothing while it is not ready; the stage screens draw the speaker's own words (captionsFor).
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
  const textBand = useRef<HTMLDivElement>(null);
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
  const px = Math.round(canvas.height * CAPTION_TEXT_HEIGHT[captions?.size ?? 'medium']);
  const fitEnabled = captions?.fit ?? false;
  const captionText = captions?.lines.join('\n') ?? '';
  useLayoutEffect(() => {
    const element = textBand.current;
    if (!element || !prepareCaptionFont(element.style, px, fitEnabled)) return;
    let live = true;
    const fit = () => {
      // A callback queued before this effect ended (a resize, fonts loading) changes nothing any more.
      if (!live) return;
      prepareCaptionFont(element.style, px, true);
      const lines = [...element.children] as HTMLElement[];
      const widest = Math.max(0, ...lines.map((line) => line.scrollWidth));
      // The band shrinks to its text, so a line that fits is exactly as wide as its room: only a line wider than
      // its room is fitted (to a pixel less, for rounding); one that fits keeps the configured size.
      const room = lines[0]?.clientWidth ?? 0;
      const available = Math.max(0, widest > room ? room - 1 : room);
      element.style.fontSize = `${String(fittedCaptionFont(px, available, widest))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    // Observe the outside width; changing the text's font must not schedule a fitting loop.
    if (band.current) observer.observe(band.current);
    document.fonts.addEventListener('loadingdone', fit);
    return () => {
      live = false;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', fit);
    };
  }, [fitEnabled, captionText, px, canvas.width]);
  if (!captions) return null;
  const baseLanguage = captions.language.split('-')[0];
  const language: Lang =
    captions.language === 'sa-Gujr'
      ? 'sa-gu'
      : ((['en', 'gu', 'hi', 'sa'] as const).find((lang) => lang === baseLanguage) ?? 'en');
  const edge = Math.round(canvas.height * 0.04) + (captions.place === 'bottom' ? lift : 0);
  return (
    <div
      ref={band}
      data-testid="captions"
      data-source={captions.source}
      data-screen={screen}
      // alpha.24 (QA24-CAPLANG-2): a translation, and which of its two-line pages (main shows each in turn).
      data-kind={captions.kind}
      data-page={captions.page ? `${String(captions.page.n)}/${String(captions.page.of)}` : undefined}
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
        ref={textBand}
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
