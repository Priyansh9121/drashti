import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import { deckSlideAt } from '../../../shared/deck-show';
import type { PipPlace, SlideLayer } from '../../../shared/engine/state';
import { languageView } from '../../../shared/language-view';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import type { Lang } from '../../../shared/model';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { useEngine } from '../engine/engine-store';
import { useMedia } from '../library/library-store';
import { MediaStill } from '../render/MediaStill';
import { namedBackground } from '../render/named-background';
import { ScreenPictures } from '../render/picture-looks';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { WallpaperView } from '../render/WallpaperView';
import { useFirstGroupLook, useScreens } from '../screens/screens-store';
import { cx } from '../ui/cx';
import {
  type PreviewBehind,
  previewBehind,
  previewFrame,
  type PreviewLead,
  type PreviewSource,
  previewWords,
} from './pip-preview';
import { boxName, rememberedPlace, usePipPlace } from './pip-store';

/*
 * Picture in Picture's preview (QA24-PIPPREVIEW-1, the owner, 26 Nov 2026: "in picture in picture, add a preview to see
 * how it looks"), in the Lower Thirds studio's way (lower-thirds/studio/StudioPreview.tsx): a picture of the screens at
 * their shape, the box over what they show now, before it goes up, with its words beside it. In Picture in Picture…
 * it follows the choices as they are made (what goes in the box, where, the size, the border and corners); in the
 * section under LIVE it shows where the next box goes and how it looks, or the box up now.
 *
 * It sends nothing anywhere, and adds nothing to the show's computer: it draws stills only, as Next up's picture does
 * (operator/NextPreview.tsx): a picture with its look, a video's still frame, the slide with its videos as stills, the
 * wallpaper. A video input, another app's window and a stream link are named in their place, never opened: opening a
 * camera here would be a second capture of it on this computer whenever LIVE does not hold it already (practice, or the
 * box's input before it goes up), and a window or a link a new capture or stream, all for a small picture LIVE shows
 * live once it is up. The box is placed by shares of the picture and drawn with the screens' own border and corners
 * (pip-preview.ts previewFrame, the same as render/PipLayerView.tsx PipBox), at whatever size the preview is drawn.
 * A picture for the eyes (hidden from screen readers): its words say what it shows.
 */

const FULL: CSSProperties = { position: 'absolute', inset: 0 };

/** The box's thin border's colour, as the screens draw it. */
const BORDER = 'rgba(255, 255, 255, 0.85)';
/** A stand-in's colours, as the Lower Thirds studio's plain backdrop and a still with none have them. */
const STAND_IN: CSSProperties = { ...FULL, background: '#1f2937', color: '#d1d5db' };

const pct = (n: number, of: number) => `${String((n / of) * 100)}%`;
/** Canvas pixels as a share of the picture's width (cqw: its container is the picture). */
const cq = (n: number, canvas: Size) => `calc(100cqw * ${String(n / canvas.width)})`;

/** Something named in its place: its kind's words and its name, on plain dark. */
function StandIn({ label, name, kind }: { label: string; name: string; kind: string }) {
  return (
    <div
      data-preview-named={kind}
      className="flex flex-col items-center justify-center gap-0.5 overflow-hidden px-[4%] text-center leading-tight"
      style={STAND_IN}
    >
      <span className="max-w-full truncate" style={{ fontSize: 'max(9px, 2.2cqw)' }}>
        {label}
      </span>
      {name !== '' && (
        <span className="max-w-full truncate font-bold" style={{ fontSize: 'max(9px, 2.2cqw)' }}>
          {name}
        </span>
      )}
    </div>
  );
}

/** A slide as a still, in its languages, placed in its box as the screens place it. */
function SlideStill({
  layer,
  scaling,
  languages,
}: {
  layer: SlideLayer;
  scaling: ScalingMode;
  languages: readonly Lang[] | null;
}) {
  const slide = layer.slide;
  return (
    <PlacedInParent content={slide} mode={scaling} className="absolute inset-0">
      <SlideView slide={languageView(deckSlideAt(slide, layer.step ?? 0), languages)} media="still" />
    </PlacedInParent>
  );
}

/** The chosen wallpaper, with its pictures' looks as the screens have them (as the studio's backdrop draws it). */
function WallpaperStill({ behind }: { behind: PreviewBehind }) {
  const state = behind.state;
  const looks = useMemo(() => ({ pictures: state?.pictures ?? {}, liveZoom: null }), [state?.pictures]);
  const chosen = state?.chosenWallpaper;
  if (!chosen || chosen.pictures.length === 0) return null;
  return (
    <div data-preview-behind="wallpaper" style={FULL}>
      <ScreenPictures.Provider value={looks}>
        <WallpaperView wallpaper={chosen} />
      </ScreenPictures.Provider>
    </div>
  );
}

/** What the screens show now behind the box: the background and the slide, or what shows with nothing up. */
function Behind({
  behind,
  scaling,
  languages,
}: {
  behind: PreviewBehind;
  scaling: ScalingMode;
  languages: readonly Lang[] | null;
}) {
  const { background, slide } = behind;
  const named = namedBackground(background);
  let back: ReactNode = null;
  if (named) back = <StandIn kind={named.kind} label={named.label} name={named.name} />;
  else if (background?.kind === 'color')
    back = <div data-preview-behind="color" style={{ ...FULL, background: background.color }} />;
  else if (background?.kind === 'media')
    back = (
      <div data-preview-behind="media" style={FULL}>
        <MediaStill mediaId={background.mediaId} media={background.media} fit={background.fit} />
      </div>
    );
  return (
    <>
      {named ? (
        <div data-preview-behind="named" style={FULL}>
          {back}
        </div>
      ) : (
        back
      )}
      {behind.nothing === 'wallpaper' && <WallpaperStill behind={behind} />}
      {slide && (
        <div data-preview-behind="slide" style={FULL}>
          <SlideStill layer={slide} scaling={scaling} languages={languages} />
        </div>
      )}
    </>
  );
}

/** What is in the box: a still of it, or its name. */
function InBox({
  source,
  behind,
  languages,
}: {
  source: PreviewSource;
  behind: PreviewBehind;
  languages: readonly Lang[] | null;
}) {
  switch (source.kind) {
    case 'slides':
      return behind.boxSlide ? (
        <div data-preview-in-box="slide" style={FULL}>
          {/* The slide as designed, made small: placed whole in the box. */}
          <SlideStill layer={behind.boxSlide} scaling="fit" languages={languages} />
        </div>
      ) : (
        <div data-preview-in-box="no-slide" style={FULL}>
          <StandIn kind="slides" label="The slides" name="No slide is up" />
        </div>
      );
    case 'media':
      return (
        <div data-preview-in-box="media" style={FULL}>
          <MediaStill mediaId={source.mediaId} media={source.media} fit="fit" />
        </div>
      );
    case 'input':
      return <StandIn kind="input" label="Video input:" name={source.name} />;
    case 'window':
      return <StandIn kind="window" label="A window:" name={source.name} />;
    case 'none':
      // Only the section's, with no box up: where the next one goes.
      return <StandIn kind="none" label="Picture in picture" name="" />;
  }
}

export interface PipPreviewViewProps {
  place: PipPlace;
  source: PreviewSource;
  behind: PreviewBehind;
  /** The first screen's canvas (LIVE's), the preview's shape. */
  canvas: Size;
  scaling: ScalingMode;
  /** A kirtan's languages, as the first audience group shows them (LIVE's). */
  languages: readonly Lang[] | null;
  lead: PreviewLead;
  testId: string;
  className?: string;
}

/** The preview itself, from what it is given: no store, no bridge. */
export function PipPreviewView({
  place,
  source,
  behind,
  canvas,
  scaling,
  languages,
  lead,
  testId,
  className,
}: PipPreviewViewProps) {
  const { rect, radius, line } = previewFrame(place, canvas);
  const rounded = radius > 0 ? cq(radius, canvas) : undefined;
  return (
    <div data-testid={testId} className={cx('space-y-1.5', className)}>
      <div
        aria-hidden="true"
        data-a11y-picture
        data-testid={`${testId}-picture`}
        className="relative w-full overflow-hidden rounded-md border border-line"
        style={{
          aspectRatio: `${String(canvas.width)} / ${String(canvas.height)}`,
          background: '#000000',
          containerType: 'inline-size',
        }}
      >
        <Behind behind={behind} scaling={scaling} languages={languages} />
        <div
          data-testid={`${testId}-box`}
          data-pip-source={source.kind}
          data-pip-corner={place.corner ?? 'none'}
          data-pip-size={place.size}
          data-pip-rect={`${String(rect.x)},${String(rect.y)},${String(rect.width)},${String(rect.height)}`}
          data-pip-radius={radius}
          data-pip-line={line}
          style={{
            position: 'absolute',
            left: pct(rect.x, canvas.width),
            top: pct(rect.y, canvas.height),
            width: pct(rect.width, canvas.width),
            height: pct(rect.height, canvas.height),
          }}
        >
          <div style={{ ...FULL, background: '#000000', overflow: 'hidden', borderRadius: rounded }}>
            <InBox source={source} behind={behind} languages={languages} />
          </div>
          {line > 0 && (
            <div
              data-pip-border=""
              style={{
                ...FULL,
                borderRadius: rounded,
                // Never thinner than a pixel, however small the preview is drawn.
                border: `max(1px, ${cq(line, canvas)}) solid ${BORDER}`,
              }}
            />
          )}
        </div>
      </div>
      <p data-testid={`${testId}-words`} className="text-xs text-muted">
        {previewWords(lead, place, source, behind)}
      </p>
    </div>
  );
}

/** The screens' shape and the first audience group's look and languages, as LIVE draws them. */
function useShown() {
  const state = useEngine((s) => s.state);
  const first = useScreens((s) => s.snapshot?.groups.flatMap((g) => g.screens)[0]);
  const audience = useFirstGroupLook('audience');
  const look = audience?.look ?? DEFAULT_LIVE_GROUP_LOOK;
  return {
    state,
    look,
    canvas: { width: first?.canvasWidth ?? 1920, height: first?.canvasHeight ?? 1080 },
    scaling: first?.scaling ?? 'fit',
    languages: look.languages,
  };
}

/** Picture in Picture…'s preview: the box as chosen, over what the screens show now. */
export function PipPreview({
  place,
  source,
  className,
}: {
  place: PipPlace;
  source: PreviewSource;
  className?: string;
}) {
  const { state, look, canvas, scaling, languages } = useShown();
  return (
    <PipPreviewView
      place={place}
      source={source}
      behind={previewBehind(state, look, source.kind === 'slides')}
      canvas={canvas}
      scaling={scaling}
      languages={languages}
      lead="preview"
      testId="pip-preview"
      {...(className ? { className } : {})}
    />
  );
}

/**
 * The section's preview, under LIVE: the box up now where the screens have it, with what is in it; with none up,
 * where the next box goes and how it looks, as the library remembers it (read as the section opens, and kept as the
 * dialog or a drag in LIVE changes it: pip-store.ts).
 */
export function PipSectionPreview() {
  const { state, look, canvas, scaling, languages } = useShown();
  const media = useMedia((s) => s.media);
  const remembered = usePipPlace((s) => s.place);
  useEffect(() => {
    void rememberedPlace();
  }, []);
  const box = state?.layers.pip ?? null;
  let source: PreviewSource = { kind: 'none' };
  if (box?.source.kind === 'slides') source = { kind: 'slides' };
  else if (box?.source.kind === 'media') source = { ...box.source, name: boxName(box.source, media) };
  else if (box?.source.kind === 'input' || box?.source.kind === 'window')
    source = { kind: box.source.kind, name: box.source.name };
  return (
    <PipPreviewView
      place={box?.place ?? remembered ?? DEFAULT_PIP_PLACE}
      source={source}
      behind={previewBehind(state, look, source.kind === 'slides')}
      canvas={canvas}
      scaling={scaling}
      languages={languages}
      lead={box ? 'now' : 'next'}
      testId="pip-section-preview"
      className="max-w-72"
    />
  );
}
