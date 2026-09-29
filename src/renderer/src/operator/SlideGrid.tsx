import { memo, useEffect, useMemo, useRef } from 'react';
import type { BackgroundCue, PresentationDoc, SlideInfo } from '../../../shared/library';
import { type OrderedSlide, playOrder } from '../../../shared/order';
import { mediaUrl } from '../../../shared/media';
import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { OBJECT_FIT } from '../render/media-style';
import { PlacedInParent } from '../render/Placed';
import { SlideView, VideoStill } from '../render/SlideView';
import { chooseArrangement, goLive } from './actions';

/** The slide's own background (its background cue), behind its thumbnail: the image, or a video's still frame. */
function CueBackground({ cue }: { cue: BackgroundCue }) {
  const { mediaId, media, fit } = cue.background;
  const style = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: OBJECT_FIT[fit],
  } as const;
  return (
    <span data-testid="thumb-background" data-media-id={mediaId} title={cue.name} className="contents">
      {media === 'image' ? (
        <img src={mediaUrl(mediaId)} alt="" draggable={false} style={style} />
      ) : (
        <VideoStill mediaId={mediaId} style={style} />
      )}
      {cue.unplayable !== null && (
        <span
          data-testid="thumb-unplayable"
          title={`${cue.name}: ${cue.unplayable}. Drashti cannot play it yet; see the import report.`}
          className="absolute top-1 left-1 rounded bg-amber-700/90 px-1.5 py-0.5 text-[10px] font-semibold text-white"
        >
          Can&apos;t play
        </span>
      )}
    </span>
  );
}

const Thumb = memo(function Thumb({
  presentationId,
  arrangementId,
  position,
  info,
  live,
}: {
  presentationId: string;
  /** The order this grid shows, which going live from here plays. */
  arrangementId: string | null;
  /** Position in that order. */
  position: number;
  info: SlideInfo;
  live: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (live) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [live]);
  const background = info.cues.find((c): c is BackgroundCue => c.kind === 'background');
  const sound = info.cues.find((c) => c.kind === 'audio');
  return (
    <li>
      <button
        ref={ref}
        type="button"
        data-testid="slide-thumb"
        data-index={position}
        data-slide-id={info.id}
        aria-current={live ? 'true' : undefined}
        aria-label={`Slide ${position + 1}${info.label ? `: ${info.label}` : ''}${live ? ' (live)' : ''}`}
        onClick={() => void goLive(presentationId, position, arrangementId)}
        className={`group w-full overflow-hidden rounded-md border-2 bg-black text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          live ? 'border-live' : 'border-line hover:border-muted'
        }`}
      >
        <span className="pointer-events-none relative block aspect-video w-full">
          {background && <CueBackground cue={background} />}
          <PlacedInParent content={info.slide} mode="fit" className="absolute inset-0">
            <SlideView slide={info.slide} media="still" />
          </PlacedInParent>
        </span>
        <span
          className={`flex items-center gap-2 px-2 py-1 text-xs ${live ? 'bg-live text-white' : 'bg-panel-2 text-muted'}`}
        >
          <span className="font-semibold">{position + 1}</span>
          <span className="truncate">{info.label}</span>
          {sound && (
            <span className="truncate" data-testid="thumb-audio" title={`Plays ${sound.name}`}>
              {`♪ ${sound.label || sound.name}`}
            </span>
          )}
          {live && <span className="ml-auto font-bold tracking-wide">LIVE</span>}
        </span>
      </button>
    </li>
  );
});

/** Choose the order the presentation plays in: one of its arrangements, or every slide. */
function ArrangementPicker({ doc }: { doc: PresentationDoc }) {
  if (doc.arrangements.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Arrangement
      <select
        aria-label="Arrangement"
        data-testid="arrangement"
        className="rounded-md border border-line bg-panel px-2 py-1 text-sm text-white"
        value={doc.selectedArrangementId ?? ''}
        onChange={(e) => {
          void chooseArrangement(doc.id, e.target.value === '' ? null : e.target.value);
        }}
      >
        <option value="">All slides in order</option>
        {doc.arrangements.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The slides in playing order, in one section each time a group comes up (a repeated chorus appears again). */
function sectionsOf(
  order: readonly OrderedSlide[],
): { key: string; first: OrderedSlide; slides: OrderedSlide[] }[] {
  const sections: { key: string; first: OrderedSlide; slides: OrderedSlide[] }[] = [];
  for (const o of order) {
    const key = `${o.group.id}:${o.occurrence}`;
    const last = sections.at(-1);
    if (last?.key === key) last.slides.push(o);
    else sections.push({ key, first: o, slides: [o] });
  }
  return sections;
}

export function SlideGrid() {
  const doc = useLibrary((s) => s.doc);
  const selectedId = useLibrary((s) => s.selectedId);
  const live = useEngine((s) => s.state?.live);
  const liveSlideId = useEngine((s) => s.state?.layers.slide?.slide.id ?? null);
  const order = useMemo(() => (doc ? playOrder(doc, doc.selectedArrangementId) : null), [doc]);
  if (!doc || !order)
    return <div className="flex items-center justify-center text-muted">Choose a presentation</div>;
  const liveHere = live?.presentationId === doc.id && liveSlideId !== null;
  // The live slide: by its position when this is the order being played, else wherever that slide appears.
  const isLive = (o: OrderedSlide) =>
    liveHere &&
    (live.arrangementId === order.arrangementId
      ? o.position === live.slideIndex
      : o.slide.id === liveSlideId);
  // Until the newly selected presentation arrives, the old slides cannot be clicked:
  // a quick click must never put the previous presentation's slide live.
  const stale = doc.id !== selectedId;
  return (
    <section
      aria-label={`Slides of ${doc.name}`}
      aria-busy={stale ? 'true' : undefined}
      inert={stale}
      className={`min-h-0 overflow-y-auto p-4 transition-opacity ${stale ? 'opacity-40' : ''}`}
      data-testid="slide-grid"
      data-presentation-id={doc.id}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-lg font-semibold">{doc.name}</h2>
        <ArrangementPicker doc={doc} />
      </div>
      {sectionsOf(order.slides).map(({ key, first, slides }) => (
        <div key={key} className="mb-5" data-testid="slide-group" data-group={first.group.name}>
          {first.group.name !== '' && (
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
              <span
                className="h-3 w-3 rounded-sm"
                style={{ background: first.group.color ?? '#4b5563' }}
                aria-hidden="true"
              />
              {first.group.name}
            </h3>
          )}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {slides.map((o) => (
              <Thumb
                key={o.position}
                presentationId={doc.id}
                arrangementId={order.arrangementId}
                position={o.position}
                info={o.slide}
                live={isLive(o)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
