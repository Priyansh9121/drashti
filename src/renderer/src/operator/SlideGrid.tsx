import { isPassageId } from '../../../shared/shastra';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
import { editWords } from '../library/words-store';
import { Badge, MissingBadge, UnplayableBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Field, Select, Slider } from '../ui/Field';
import { LayoutGrid, Music, Palette, Pencil, Presentation, SquarePen } from '../ui/icons';
import { openSlideEditor } from '../editor/editor-store';
import { openKirtan } from '../kirtans/kirtan-store';
import { usePersistentState } from '../ui/persist';
import { EmptyState, Loading } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { themeFromPresentation } from '../themes/themes-store';
import { chooseArrangement, goLive, playItem, useNotice } from './actions';

/**
 * Thumbnail widths the operator can choose (px). The default fits three slides
 * a row at 1280 x 720 and six at 1920 x 1080 with the columns at their usual widths.
 */
export const THUMB = { initial: 170, min: 120, max: 400 };
const isThumbSize = (v: unknown): v is number => typeof v === 'number' && v >= THUMB.min && v <= THUMB.max;

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
          className="absolute top-1 left-1"
        >
          <UnplayableBadge />
        </span>
      )}
    </span>
  );
}

const Thumb = memo(function Thumb({
  presentationId,
  presentationName,
  arrangementId,
  playlist,
  position,
  info,
  live,
  found,
  group,
  firstOfRun,
}: {
  presentationId: string;
  presentationName: string;
  /** The order this grid shows, which going live from here plays. */
  arrangementId: string | null;
  /** The playlist item the grid shows, if any: going live from here plays on through the playlist. */
  playlist: PlaylistCursor | null;
  /** Position in that order. */
  position: number;
  info: SlideInfo;
  live: boolean;
  /** A search found this slide: bring it into view and mark it. */
  found: boolean;
  /** Its group: the colour is a strip beside every slide's number, the name is on the first of each run. */
  group: OrderedSlide['group'];
  /** The first slide each time its group comes up (a chorus sung again starts a new run). */
  firstOfRun: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // The live slide comes into view in the same frame it turns live: never a smooth scroll (Session 25).
  useLayoutEffect(() => {
    if (live) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [live]);
  useEffect(() => {
    if (found) ref.current?.scrollIntoView({ block: 'center' });
  }, [found]);
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
        data-found={found ? 'true' : undefined}
        aria-current={live ? 'true' : undefined}
        aria-label={`Slide ${position + 1}${group.name ? `, ${group.name}` : ''}${info.label ? `: ${info.label}` : ''}${live ? ' (live)' : ''}`}
        onClick={() => void goLive(presentationId, position, arrangementId, playlist)}
        // A double-click opens the slide editor at this slide (the first click put it live); a passage's
        // slides are made from its text, so they have no editor.
        onDoubleClick={() => {
          if (!isPassageId(presentationId)) void openSlideEditor(presentationId, presentationName, info.id);
        }}
        className={cx(
          // The border turns live with the caption, in one frame: no fade.
          'group w-full overflow-hidden rounded-lg border-2 bg-black text-left',
          live ? 'border-live' : found ? 'border-accent' : 'border-line hover:border-field',
        )}
      >
        <span className="pointer-events-none relative block aspect-video w-full" data-a11y-picture>
          {background && <CueBackground cue={background} />}
          <PlacedInParent content={info.slide} mode="fit" className="absolute inset-0">
            <SlideView slide={info.slide} media="still" />
          </PlacedInParent>
        </span>
        <span
          className={cx(
            'flex h-7 items-center gap-2 pr-2 text-xs',
            live ? 'bg-live text-white' : 'bg-panel-2 text-muted',
          )}
        >
          <span
            aria-hidden="true"
            data-testid="group-color"
            className="h-full w-2 shrink-0"
            style={{ background: group.color ?? 'transparent' }}
          />
          <span className="font-bold tabular-nums">{position + 1}</span>
          {firstOfRun ? (
            <span
              data-testid="slide-group"
              data-group={group.name}
              className={cx('min-w-0 flex-1 font-bold', live ? 'text-white' : 'text-fg')}
            >
              <Truncate text={[group.name, info.label].filter((t) => t !== '').join(' · ')} />
            </span>
          ) : info.label ? (
            <Truncate text={info.label} className="min-w-0 flex-1" />
          ) : (
            <span className="flex-1" />
          )}
          {sound && (
            <span
              className="flex min-w-0 items-center gap-1"
              data-testid="thumb-audio"
              title={`Plays ${sound.name}`}
            >
              <Music size={12} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{sound.label || sound.name}</span>
            </span>
          )}
          {live && <span className="font-bold tracking-wide">LIVE</span>}
        </span>
      </button>
    </li>
  );
});

/** Choose the order the presentation plays in: one of its arrangements, or every slide. */
function ArrangementPicker({ doc }: { doc: PresentationDoc }) {
  if (doc.arrangements.length === 0) return null;
  return (
    <Field label="Arrangement" layout="inline">
      <Select
        data-testid="arrangement"
        className="max-w-48"
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
      </Select>
    </Field>
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
    <Field label="Arrangement" layout="inline">
      <Select
        data-testid="arrangement"
        className="max-w-52"
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
      </Select>
    </Field>
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
  const note = (title: string, text: string) => (
    <section
      className="flex flex-1 items-center justify-center"
      data-testid="item-view"
      aria-label={item.label}
    >
      <EmptyState icon={Presentation} title={title}>
        {text}
      </EmptyState>
    </section>
  );
  switch (item.kind) {
    case 'header':
      return note(item.label, `“${item.label}” is a header. Next steps over it to the item after.`);
    case 'placeholder':
      return note(
        'Not found at import',
        `“${item.label}” was not found when the playlist was imported. Drag a presentation onto it in the playlist to put one there.`,
      );
    case 'presentation':
      return note(
        'No longer in the library',
        `“${item.label}” is no longer in the library. Undo its removal, or remove the item.`,
      );
    case 'shastra':
      return note(
        'Its text is not loaded',
        `“${item.label}” is a Shastra passage whose text is not loaded. It comes back when the text is loaded again (Shastra, Texts…).`,
      );
    case 'media': {
      const problem = mediaProblem(item);
      return (
        <section
          className="min-h-0 flex-1 overflow-y-auto p-4"
          data-testid="item-view"
          aria-label={item.label}
        >
          <div className="mb-3 flex items-center gap-2">
            <h2 className="min-w-0 text-lg font-bold">
              <Truncate text={item.label} />
            </h2>
            <Badge>{mediaKindLabel[item.media]}</Badge>
            {item.missing ? <MissingBadge /> : problem && <UnplayableBadge />}
          </div>
          <button
            type="button"
            data-testid="item-media"
            aria-current={isLive ? 'true' : undefined}
            aria-label={`${mediaKindLabel[item.media]}: ${item.label}${isLive ? ' (live)' : ''}`}
            onClick={() => void playItem(item.playlistId, item.id)}
            className={cx(
              'w-full max-w-xl overflow-hidden rounded-lg border-2 bg-black text-left transition-colors',
              isLive ? 'border-live' : 'border-line hover:border-field',
            )}
          >
            <span
              className="pointer-events-none relative flex aspect-video w-full items-center justify-center"
              data-a11y-picture
            >
              {item.media === 'audio' ? (
                <Music size={48} aria-hidden="true" className="text-muted" />
              ) : (
                !item.missing && <MediaStill mediaId={item.mediaId} media={item.media} />
              )}
            </span>
            <span
              className={cx(
                'flex h-7 items-center gap-2 px-2 text-xs',
                isLive ? 'bg-live text-white' : 'bg-panel-2 text-muted',
              )}
            >
              {mediaKindLabel[item.media]}
              {problem && <span>{problem}</span>}
              {isLive && <span className="ml-auto font-bold tracking-wide">LIVE</span>}
            </span>
          </button>
          <p className="mt-2 text-sm text-muted">
            {item.media === 'audio'
              ? 'Plays on the audio layer; the picture stays as it is.'
              : 'Goes up as the background, and takes the slide off.'}
          </p>
        </section>
      );
    }
  }
}

/** A playlist item whose slides the grid shows: a presentation's, or a Shastra passage's. */
type SlidesItem = ShownItem & ({ kind: 'presentation' } | { kind: 'shastra' });

export function SlideGrid() {
  const item = useLibrary((s) => s.item);
  if (item?.kind === 'shastra' && !item.missing) return <PresentationGrid item={item} />;
  if (item && (item.kind !== 'presentation' || item.presentationName === null))
    return <ItemView item={item} />;
  return <PresentationGrid item={item?.kind === 'presentation' ? item : null} />;
}

/** A presentation's slides (or a passage's): picked in the library, or a playlist item (in the item's order). */
function PresentationGrid({ item }: { item: SlidesItem | null }) {
  const doc = useLibrary((s) => s.doc);
  const selectedId = useLibrary((s) => s.selectedId);
  const live = useEngine((s) => s.state?.live);
  const liveSlideId = useEngine((s) => s.state?.layers.slide?.slide.id ?? null);
  const focusSlideId = useLibrary((s) => s.focusSlideId);
  const isTemplate = useLibrary(
    (s) => s.presentations.find((p) => p.id === doc?.id)?.libraryName === 'Templates',
  );
  const itemDoc = item ? (item.kind === 'shastra' ? item.passageId : item.presentationId) : null;
  const order = useMemo(
    () =>
      doc
        ? playOrder(
            doc,
            item?.kind === 'presentation' && item.presentationId === doc.id
              ? itemArrangement(item, doc)
              : doc.selectedArrangementId,
          )
        : null,
    [doc, item],
  );
  const playlist = useMemo(() => (item ? { playlistId: item.playlistId, itemId: item.id } : null), [item]);
  const [thumb, setThumb] = usePersistentState('slides.thumb', THUMB.initial, isThumbSize);
  if (!doc || !order)
    return selectedId && !doc ? (
      <Loading label="Opening the presentation…" className="flex-1" />
    ) : (
      <EmptyState icon={Presentation} title="Choose a presentation" className="flex-1">
        Pick one in the library, or an item in a playlist, to see its slides here.
      </EmptyState>
    );
  const liveHere = live?.presentationId === doc.id && liveSlideId !== null;
  // The live slide: by its position when this is the order being played, else wherever that slide appears.
  const isLive = (o: OrderedSlide) =>
    liveHere &&
    (live.arrangementId === order.arrangementId
      ? o.position === live.slideIndex
      : o.slide.id === liveSlideId);
  // The slide a search found (its first place in the order).
  const found = order.slides.find((o) => o.slide.id === focusSlideId)?.position ?? -1;
  // Until the newly selected presentation arrives, the old slides cannot be clicked:
  // a quick click must never put the previous presentation's slide live.
  const stale = doc.id !== selectedId || (item !== null && itemDoc !== doc.id);
  return (
    <section
      aria-label={`Slides of ${doc.name}`}
      aria-busy={stale ? 'true' : undefined}
      inert={stale}
      className={cx('flex min-h-0 flex-1 flex-col transition-opacity', stale && 'opacity-40')}
      data-testid="slide-grid"
      data-presentation-id={doc.id}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-2">
        <h2 className="min-w-48 flex-[1_1_12rem] text-base font-bold">
          <Truncate text={doc.name} />
        </h2>
        {doc.passage ? (
          // A Shastra passage is made from its text: its words and slides are not edited here.
          <span className="text-xs text-muted" data-testid="passage-note">
            Shastra passage{item ? '' : ' · drag it from Shastra onto a playlist to add it'}
          </span>
        ) : item?.kind === 'presentation' ? (
          <ItemOrderPicker doc={doc} item={item} />
        ) : (
          <ArrangementPicker doc={doc} />
        )}
        {isTemplate && (
          <Button
            size="sm"
            icon={Palette}
            title="A theme from this template's first text box"
            onClick={() => {
              void themeFromPresentation(doc.id).then((problem) => {
                useNotice.setState({ text: problem });
              });
            }}
          >
            Make a theme from this
          </Button>
        )}
        {!doc.passage && (
          <>
            <Button size="sm" icon={Pencil} onClick={() => void editWords(doc.id, doc.name)}>
              Edit words
            </Button>
            <Button
              size="sm"
              icon={Music}
              data-testid="kirtan-button"
              aria-label={doc.kirtan ? 'Kirtan: languages and details' : 'Kirtan: make it a kirtan'}
              onClick={() => {
                openKirtan(doc.id, doc.name);
              }}
            >
              Kirtan
            </Button>
            <Button
              size="sm"
              icon={SquarePen}
              data-testid="edit-slides"
              // At the slide on the screens, or the one a search found.
              onClick={() => void openSlideEditor(doc.id, doc.name, liveHere ? liveSlideId : focusSlideId)}
            >
              Edit slides
            </Button>
          </>
        )}
        <LayoutGrid size={15} aria-hidden="true" className="shrink-0 text-muted" />
        <Slider
          aria-label="Thumbnail size"
          value={thumb}
          min={THUMB.min}
          max={THUMB.max}
          step={10}
          format={(v) => `${v}`}
          className="w-28"
          onChange={(e) => {
            setThumb(Number(e.target.value));
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
        {order.slides.length === 0 && (
          <EmptyState icon={Presentation} title="No slides yet">
            Use Edit words to write its words, and each blank line starts a slide.
          </EmptyState>
        )}
        {order.slides.length > 0 && (
          // Every slide in play order, wrapping across the width: a chorus sung again shows again.
          <ul
            data-testid="slide-list"
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumb}px, 1fr))` }}
          >
            {order.slides.map((o, i) => {
              const before = order.slides[i - 1];
              return (
                <Thumb
                  key={o.position}
                  presentationId={doc.id}
                  presentationName={doc.name}
                  arrangementId={order.arrangementId}
                  playlist={playlist}
                  position={o.position}
                  info={o.slide}
                  live={isLive(o)}
                  found={o.position === found}
                  group={o.group}
                  firstOfRun={before?.group.id !== o.group.id || before.occurrence !== o.occurrence}
                />
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
