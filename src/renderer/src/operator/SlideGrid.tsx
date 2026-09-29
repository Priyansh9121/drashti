import { memo, useEffect, useMemo, useRef } from 'react';
import type { PlaylistCursor } from '../../../shared/engine/state';
import type { BackgroundCue, PresentationDoc, SlideInfo } from '../../../shared/library';
import { type OrderedSlide, playOrder } from '../../../shared/order';
import type { ItemOrder } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import type { ShownItem } from '../library/library-store';
import { useLibrary } from '../library/library-store';
import { mediaKindLabel, mediaProblem } from '../library/MediaList';
import { setItemOrder } from '../playlists/playlist-store';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { chooseArrangement, goLive, playItem } from './actions';

/** The slide's own background (its background cue), behind its thumbnail: the image, or a video's still frame. */
function CueBackground({ cue }: { cue: BackgroundCue }) {
  const { mediaId, media, fit } = cue.background;
  return (
    <span data-testid="thumb-background" data-media-id={mediaId} title={cue.name} className="contents">
      <MediaStill mediaId={mediaId} media={media} fit={fit} />
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
  playlist,
  position,
  info,
  live,
}: {
  presentationId: string;
  /** The order this grid shows, which going live from here plays. */
  arrangementId: string | null;
  /** The playlist item the grid shows, if any: going live from here plays on through the playlist. */
  playlist: PlaylistCursor | null;
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
        onClick={() => void goLive(presentationId, position, arrangementId, playlist)}
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

const orderValue = (order: ItemOrder) =>
  order.mode === 'arrangement' ? `a:${order.arrangementId}` : order.mode;

/** A playlist item's order: the presentation's own, every slide, or one of its arrangements. */
function ItemOrderPicker({
  doc,
  item,
}: {
  doc: PresentationDoc;
  item: ShownItem & { kind: 'presentation' };
}) {
  if (doc.arrangements.length === 0) return null;
  const own = doc.arrangements.find((a) => a.id === doc.selectedArrangementId)?.name ?? 'all slides in order';
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Arrangement
      <select
        aria-label="Arrangement"
        data-testid="arrangement"
        className="rounded-md border border-line bg-panel px-2 py-1 text-sm text-white"
        value={orderValue(item.order)}
        onChange={(e) => {
          const v = e.target.value;
          void setItemOrder(
            item.id,
            v === 'presentation' || v === 'all'
              ? { mode: v }
              : { mode: 'arrangement', arrangementId: v.slice(2) },
          );
        }}
      >
        <option value="presentation">As the presentation plays ({own})</option>
        <option value="all">All slides in order</option>
        {doc.arrangements.map((a) => (
          <option key={a.id} value={`a:${a.id}`}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The order a playlist item plays its presentation in. */
function itemArrangement(item: ShownItem & { kind: 'presentation' }, doc: PresentationDoc): string | null {
  if (item.order.mode === 'all') return null;
  if (item.order.mode === 'arrangement') return item.order.arrangementId;
  return doc.selectedArrangementId;
}

/** A playlist item that is not a presentation: a picture, video or sound to put up, or a note. */
function ItemView({ item }: { item: ShownItem }) {
  const live = useEngine((s) => s.state?.live.playlist);
  const isLive = live?.playlistId === item.playlistId && live.itemId === item.id;
  const note = (text: string) => (
    <section className="flex items-center justify-center p-8 text-center text-muted" data-testid="item-view">
      <p className="max-w-md">{text}</p>
    </section>
  );
  switch (item.kind) {
    case 'header':
      return note(`“${item.label}” is a header. Next steps over it to the item after.`);
    case 'placeholder':
      return note(
        `“${item.label}” was not found when the playlist was imported. Drag a presentation onto it in the playlist to put one there.`,
      );
    case 'presentation':
      return note(`“${item.label}” is no longer in the library. Undo its removal, or remove the item.`);
    case 'media': {
      const problem = mediaProblem(item);
      return (
        <section className="min-h-0 overflow-y-auto p-4" data-testid="item-view" aria-label={item.label}>
          <h2 className="mb-3 text-lg font-semibold">{item.label}</h2>
          <button
            type="button"
            data-testid="item-media"
            aria-current={isLive ? 'true' : undefined}
            aria-label={`${mediaKindLabel[item.media]}: ${item.label}${isLive ? ' (live)' : ''}`}
            onClick={() => void playItem(item.playlistId, item.id)}
            className={`w-full max-w-xl overflow-hidden rounded-md border-2 bg-black text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              isLive ? 'border-live' : 'border-line hover:border-muted'
            }`}
          >
            <span className="pointer-events-none relative flex aspect-video w-full items-center justify-center">
              {item.media === 'audio' ? (
                <span className="text-4xl text-muted" aria-hidden="true">
                  ♪
                </span>
              ) : (
                !item.missing && <MediaStill mediaId={item.mediaId} media={item.media} />
              )}
            </span>
            <span
              className={`flex items-center gap-2 px-2 py-1 text-xs ${isLive ? 'bg-live text-white' : 'bg-panel-2 text-muted'}`}
            >
              {mediaKindLabel[item.media]}
              {problem && <span className="text-amber-300">{problem}</span>}
              {isLive && <span className="ml-auto font-bold tracking-wide">LIVE</span>}
            </span>
          </button>
          <p className="mt-2 text-xs text-muted">
            {item.media === 'audio'
              ? 'Plays on the audio layer; the picture stays as it is.'
              : 'Goes up as the background, and takes the slide off.'}
          </p>
        </section>
      );
    }
  }
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
  const item = useLibrary((s) => s.item);
  if (item && (item.kind !== 'presentation' || item.presentationName === null))
    return <ItemView item={item} />;
  return <PresentationGrid item={item?.kind === 'presentation' ? item : null} />;
}

/** A presentation's slides: picked in the library, or a playlist item (in the item's order). */
function PresentationGrid({ item }: { item: (ShownItem & { kind: 'presentation' }) | null }) {
  const doc = useLibrary((s) => s.doc);
  const selectedId = useLibrary((s) => s.selectedId);
  const live = useEngine((s) => s.state?.live);
  const liveSlideId = useEngine((s) => s.state?.layers.slide?.slide.id ?? null);
  const order = useMemo(
    () =>
      doc
        ? playOrder(
            doc,
            item?.presentationId === doc.id ? itemArrangement(item, doc) : doc.selectedArrangementId,
          )
        : null,
    [doc, item],
  );
  const playlist = useMemo(() => (item ? { playlistId: item.playlistId, itemId: item.id } : null), [item]);
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
  const stale = doc.id !== selectedId || (item !== null && item.presentationId !== doc.id);
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
        {item ? <ItemOrderPicker doc={doc} item={item} /> : <ArrangementPicker doc={doc} />}
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
                playlist={playlist}
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
