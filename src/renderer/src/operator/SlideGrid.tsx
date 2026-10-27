import { isPassageId } from '../../../shared/shastra';
import { isRepeatId } from '../../../shared/repeat';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MenuEntry, MenuPlace } from '../ui/Menu';
import { Menu, MenuButton, menuPlace } from '../ui/Menu';
import type { MediaBackground, PlaylistCursor } from '../../../shared/engine/state';
import {
  type AudioCue,
  backgroundCueOf,
  type BackgroundCue,
  type PresentationDoc,
  type SlideInfo,
  soundCueOf,
} from '../../../shared/library';
import { type OrderedSlide, playOrder } from '../../../shared/order';
import type { ItemOrder } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { deleteOpenLabel, requestRemovalOfOpen } from '../library/import-store';
import type { ShownItem } from '../library/library-store';
import { selectPresentation, useLibrary } from '../library/library-store';
import { CannotPlayBadge, mediaKindLabel, mediaProblem } from '../library/MediaList';
import { setItemOrder } from '../playlists/playlist-store';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { OversetMark, OversetWatch } from '../render/measure';
import { editWords } from '../library/words-store';
import { Badge, MissingBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Field, Select, Slider } from '../ui/Field';
import {
  AlertTriangle,
  Bookmark,
  LayoutGrid,
  MoreHorizontal,
  Music,
  Palette,
  Pencil,
  Presentation,
  RotateCcw,
  SlidersHorizontal,
  SquarePen,
  Timer,
  Trash2,
  Video,
} from '../ui/icons';
import { NewTimerSlideInLibrary } from '../editor/NewTimerSlide';
import { InputPicture, useSmallPicture } from '../video-inputs/InputPicture';
import { useInputNamed } from '../video-inputs/video-inputs-store';
import { inputRowNote } from '../video-inputs/words';
import { openPictureEditor } from '../pictures/PictureEditor';
import { markersMedia, openMarkers } from '../markers/MarkersDialog';
import { openSlideEditor } from '../editor/editor-store';
import { openKirtan } from '../kirtans/kirtan-store';
import { usePersistentState } from '../ui/persist';
import { CentredPlace, EmptyState, ErrorState, Loading } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { themeFromPresentation } from '../themes/themes-store';
import { chooseArrangement, goLive, playItem, useNotice } from './actions';
import { useWhatIsThis } from '../help/WhatIsThis';
import { StartHere } from './StartHere';

/**
 * Thumbnail widths the operator can choose (px). The default fits three slides
 * a row at 1280 x 720 and six at 1920 x 1080 with the columns at their usual widths.
 */
export const THUMB = { initial: 170, min: 120, max: 400 };
const isThumbSize = (v: unknown): v is number => typeof v === 'number' && v >= THUMB.min && v <= THUMB.max;

/**
 * The slide's own background (its background cue), behind its thumbnail: the image, or a video's still frame. Its
 * file missing (Session 52), the library's Missing in its corner instead: the background stays as it was when the
 * slide goes up.
 */
function CueBackground({ cue, background }: { cue: BackgroundCue; background: MediaBackground }) {
  const { mediaId, media, fit } = background;
  if (cue.missing)
    return (
      <span
        data-testid="thumb-missing"
        data-media-id={mediaId}
        title={`“${cue.name}” is missing: the background stays as it was when this slide goes up`}
        className="absolute top-1 left-1"
      >
        <MissingBadge />
      </span>
    );
  return (
    <span data-testid="thumb-background" data-media-id={mediaId} title={cue.name} className="contents">
      <MediaStill mediaId={mediaId} media={media} fit={fit} />
      {cue.unplayable !== null && (
        <span
          data-testid="thumb-unplayable"
          title={`${cue.name}: ${cue.unplayable}. Drashti cannot play it yet; see the import report.`}
          className="absolute top-1 left-1"
        >
          <CannotPlayBadge mediaId={mediaId} />
        </span>
      )}
    </span>
  );
}

/**
 * The video input behind a slide (Session 51), in its caption, by the name its cue keeps: marked when this
 * computer has none of that name (the background then stays as it was when the slide goes up).
 */
function ThumbInput({ name, live }: { name: string; live: boolean }) {
  const here = useInputNamed(name) !== null;
  const Mark = here ? Video : AlertTriangle;
  return (
    <span
      className={cx('flex min-w-0 items-center gap-1', !here && !live && 'text-warning-fg')}
      data-testid="thumb-input"
      data-input={name}
      data-missing={here ? undefined : 'true'}
      title={
        here
          ? `The video input “${name}” behind it`
          : `No video input called “${name}” is on this computer: the background stays as it was when this slide goes up`
      }
    >
      <Mark size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * The sound a slide plays, in its caption. Its file missing (Session 54), marked as a video input not here is (the
 * sound then stays as it was when the slide goes up, as LIVE says), and named so, as a missing background is.
 */
function ThumbSound({ cue, live }: { cue: AudioCue; live: boolean }) {
  const Mark = cue.missing ? AlertTriangle : Music;
  return (
    <span
      className={cx('flex min-w-0 items-center gap-1', cue.missing && !live && 'text-warning-fg')}
      data-testid="thumb-audio"
      data-media-id={cue.mediaId}
      data-missing={cue.missing ? 'true' : undefined}
      title={
        cue.missing
          ? `“${cue.name}” is missing: the sound stays as it was when this slide goes up`
          : `Plays ${cue.name}`
      }
    >
      <Mark size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{cue.label || cue.name}</span>
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
  onNewTimerSlide,
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
  /** New Timer Slide… after this slide (Session 50); left out where slides are made elsewhere. */
  onNewTimerSlide?: (slideId: string, position: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // The live slide comes into view in the same frame it turns live: never a smooth scroll (Session 25).
  useLayoutEffect(() => {
    if (live) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [live]);
  useEffect(() => {
    if (found) ref.current?.scrollIntoView({ block: 'center' });
  }, [found]);
  // The background cue it plays: its last, when it has more than one (Session 52), as the slide going up does.
  const background = backgroundCueOf(info.cues);
  // Its picture or video behind it, or a video input by name (Session 51), named in its caption.
  const behind = background?.background;
  const inputName = behind?.kind === 'input' ? behind.name : null;
  // The sound cue it plays: its last, when it has more than one (Session 54), as the slide going up does.
  const sound = soundCueOf(info.cues);
  // A slide with a picture on it (a deck's page, say): its right-click offers the Picture editor (Session 26e).
  const picture = info.slide.elements.find((e) => e.kind === 'image');
  const [menu, setMenu] = useState<MenuPlace | null>(null);
  // Its right-click menu: the Picture editor for a picture, New Timer Slide… where slides are made here.
  const entries: MenuEntry[] = [
    ...(picture?.kind === 'image'
      ? [
          {
            label: 'Picture editor…',
            icon: SlidersHorizontal,
            onSelect: () => {
              openPictureEditor({
                id: picture.mediaId,
                name: `${presentationName}, slide ${String(position + 1)}`,
              });
            },
          },
        ]
      : []),
    ...(onNewTimerSlide
      ? [
          {
            label: 'New Timer Slide…',
            icon: Timer,
            onSelect: () => {
              onNewTimerSlide(info.id, position);
            },
          },
        ]
      : []),
  ];
  // Words past a box on this slide (Sessions 31–36, SLD-1): marked in its corner, and said with its name.
  const [over, setOver] = useState(false);
  return (
    <li>
      <button
        ref={ref}
        type="button"
        data-testid="slide-thumb"
        data-show-control
        data-index={position}
        data-slide-id={info.id}
        data-found={found ? 'true' : undefined}
        aria-current={live ? 'true' : undefined}
        aria-label={`Slide ${position + 1}${group.name ? `, ${group.name}` : ''}${info.label ? `: ${info.label}` : ''}${live ? ' (live)' : ''}${over ? ', words run past a box' : ''}`}
        onClick={() => void goLive(presentationId, position, arrangementId, playlist)}
        // A double-click opens the slide editor at this slide (the first click put it live); a passage's
        // slides are made from its text, so they have no editor.
        onDoubleClick={() => {
          // A passage's and a Repeat Slides playlist's slides are made from elsewhere: no editor.
          if (!isPassageId(presentationId) && !isRepeatId(presentationId))
            void openSlideEditor(presentationId, presentationName, info.id);
        }}
        onContextMenu={(e) => {
          if (entries.length === 0) return;
          e.preventDefault();
          setMenu(menuPlace(e));
        }}
        className={cx(
          // The border and the red underglow turn live with the caption, in one frame: no fade.
          'group w-full overflow-hidden rounded-lg border-2 bg-black text-left',
          live
            ? 'border-live shadow-live-thumb'
            : found
              ? 'border-accent shadow-thumb'
              : 'border-line shadow-thumb hover:border-field',
        )}
      >
        <span className="pointer-events-none relative block aspect-video w-full" data-a11y-picture>
          {background && behind?.kind === 'media' && <CueBackground cue={background} background={behind} />}
          <PlacedInParent content={info.slide} mode="fit" className="absolute inset-0">
            <OversetWatch onChange={setOver}>
              <SlideView slide={info.slide} media="still" />
            </OversetWatch>
          </PlacedInParent>
          {over && <OversetMark />}
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
          {inputName !== null && <ThumbInput name={inputName} live={live} />}
          {sound && <ThumbSound cue={sound} live={live} />}
          {live && <span className="font-bold tracking-wide">LIVE</span>}
        </span>
      </button>
      {menu && entries.length > 0 && (
        <Menu
          at={menu}
          label={`Slide ${String(position + 1)}`}
          entries={entries}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
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

/**
 * A video input item (Session 51): its live picture, a click putting it up as the background (the slide taken
 * off), or, where this computer has no input of its name, why not: Next goes past it. Centred while it fits, from
 * its top when it does not, as the middle's other places are: never under the bars below, its picture always in
 * reach (a 1024 × 645 window leaves the middle little room under the open playlist). Its line says why the
 * picture is black when it is (unplugged, the camera refused), as Media's row does; while the window has not yet
 * heard which inputs this computer has, it is shown as there, without its picture.
 */
function InputItemView({ item, isLive }: { item: ShownItem & { kind: 'input' }; isLive: boolean }) {
  const found = useInputNamed(item.name);
  const input = found === 'unread' ? null : found;
  const capture = useSmallPicture(input?.device ?? null);
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      data-testid="item-view"
      data-missing={found === null ? 'true' : undefined}
      aria-label={item.label}
    >
      <CentredPlace data-testid="input-item-place">
        {found !== null ? (
          <div className="mx-auto w-full max-w-xl p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="min-w-0 text-lg font-bold">
                <Truncate text={item.label} />
              </h2>
              <Badge>Video input</Badge>
            </div>
            <button
              type="button"
              data-testid="item-input"
              data-show-control
              aria-current={isLive ? 'true' : undefined}
              aria-label={`Video input: ${input?.name ?? item.name}${isLive ? ' (live)' : ''}`}
              onClick={() => void playItem(item.playlistId, item.id)}
              className={cx(
                // A thumbnail: live at once, with no fade (Session 26g).
                'w-full overflow-hidden rounded-lg border-2 bg-black text-left',
                isLive ? 'border-live shadow-live-thumb' : 'border-line shadow-thumb hover:border-field',
              )}
            >
              <InputPicture capture={capture} className="pointer-events-none w-full" />
              <span
                className={cx(
                  'flex h-7 items-center gap-2 px-2 text-xs',
                  isLive ? 'bg-live text-white' : 'bg-panel-2 text-muted',
                )}
                data-testid="item-input-note"
              >
                {input ? inputRowNote(capture, input.fit) : 'Video input'}
                {isLive && <span className="ml-auto font-bold tracking-wide">LIVE</span>}
              </span>
            </button>
            <p className="mt-2 text-sm text-muted">
              Goes up as the background, coming on over 1 second, and takes the slide off.
            </p>
          </div>
        ) : (
          <EmptyState icon={Video} title="Not on this computer">
            No video input called “{item.name}” is on this computer, so Next goes past it. Add a Video Input…
            in Media can name one “{item.name}”: then it goes up from here.
          </EmptyState>
        )}
      </CentredPlace>
    </section>
  );
}

/** A playlist item that is not a presentation: a picture, video or sound to put up, or a note. */
function ItemView({ item }: { item: ShownItem }) {
  const live = useEngine((s) => s.state?.live.playlist);
  const isLive = live?.playlistId === item.playlistId && live.itemId === item.id;
  // Centred while it fits, from its top when it does not (Session 51): never under the bars below.
  const note = (title: string, text: string) => (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="item-view" aria-label={item.label}>
      <CentredPlace>
        <EmptyState icon={Presentation} title={title}>
          {text}
        </EmptyState>
      </CentredPlace>
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
    case 'input':
      return <InputItemView item={item} isLive={isLive} />;
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
            {item.missing ? <MissingBadge /> : problem && <CannotPlayBadge mediaId={item.mediaId} />}
          </div>
          <button
            type="button"
            data-testid="item-media"
            data-show-control
            aria-current={isLive ? 'true' : undefined}
            aria-label={`${mediaKindLabel[item.media]}: ${item.label}${isLive ? ' (live)' : ''}`}
            onClick={() => void playItem(item.playlistId, item.id)}
            className={cx(
              // A thumbnail: live at once, with no fade (Session 26g).
              'w-full max-w-xl overflow-hidden rounded-lg border-2 bg-black text-left',
              isLive ? 'border-live shadow-live-thumb' : 'border-line shadow-thumb hover:border-field',
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
          {/* A picture's zoom and enhancements (Session 26e). */}
          {item.media === 'image' && !item.missing && item.unplayable === null && (
            <Button
              size="sm"
              icon={SlidersHorizontal}
              className="mt-2"
              data-testid="item-picture"
              onClick={() => {
                openPictureEditor({ id: item.mediaId, name: item.label });
              }}
            >
              Picture editor…
            </Button>
          )}
          {/* A video's or sound's start, end and markers, on its timeline (Session 26e). */}
          {item.media !== 'image' && !item.missing && item.unplayable === null && (
            <Button
              size="sm"
              icon={Bookmark}
              className="mt-2"
              data-testid="item-markers"
              onClick={() => {
                openMarkers(markersMedia(item));
              }}
            >
              Start, end and markers…
            </Button>
          )}
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
/**
 * The chosen presentation's slides could not be read (Session 39): said, with Try again, never
 * "Opening the presentation…" for good. The screens keep what they show; the log says why.
 */
function PresentationUnread({ id }: { id: string }) {
  const name = useLibrary((s) => s.presentations.find((p) => p.id === id)?.name ?? null);
  const [trying, setTrying] = useState(false);
  return (
    // Centred while it fits, from its top when it does not (Session 51): never under the bars below.
    <CentredPlace>
      <ErrorState
        title={name ? `Drashti couldn’t open “${name}”` : 'Drashti couldn’t open the presentation'}
        action={
          <Button
            variant="primary"
            icon={RotateCcw}
            disabled={trying}
            data-testid="presentation-try-again"
            onClick={() => {
              setTrying(true);
              void selectPresentation(id).finally(() => {
                setTrying(false);
              });
            }}
          >
            Try again
          </Button>
        }
      >
        The screens keep what they show. If Try again doesn’t open it, tell the admin.
      </ErrorState>
    </CentredPlace>
  );
}

function PresentationGrid({ item }: { item: SlidesItem | null }) {
  const doc = useLibrary((s) => s.doc);
  const selectedId = useLibrary((s) => s.selectedId);
  const unreadId = useLibrary((s) => s.unreadId);
  const live = useEngine((s) => s.state?.live);
  // A timer shown alone (Session 50) is in the slide's place but no slide of this presentation.
  const liveSlideId = useEngine((s) => {
    const shown = s.state?.layers.slide;
    return shown && !shown.timer ? shown.slide.id : null;
  });
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
  const help = useWhatIsThis('slides');
  // New Timer Slide… (Session 50): after which slide, while its dialog is open.
  const [timerSlide, setTimerSlide] = useState<{ slideId: string; position: number } | null>(null);
  const newTimerSlide = useCallback((slideId: string, position: number) => {
    setTimerSlide({ slideId, position });
  }, []);
  if (!doc || !order)
    return selectedId && !doc ? (
      unreadId === selectedId ? (
        <PresentationUnread id={selectedId} />
      ) : (
        <Loading label="Opening the presentation…" className="flex-1" />
      )
    ) : (
      <StartHere />
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
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-2"
        data-strip=""
      >
        <h2 className="min-w-48 flex-[1_1_12rem] text-base font-bold">
          <Truncate text={doc.name} />
        </h2>
        {help.button}
        {doc.passage ? (
          // A Shastra passage is made from its text: its words and slides are not edited here.
          <span className="text-xs text-muted" data-testid="passage-note">
            Shastra passage{item ? '' : ' · drag it from Shastra onto a playlist to add it'}
          </span>
        ) : doc.repeat ? (
          // Repeat Slides (Session 26d): made from its playlist, changed there.
          <span className="text-xs text-muted" data-testid="repeat-note">
            Repeat Slides · a slide put up goes round from there
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
            title="A theme from this template’s first text box"
            onClick={() => {
              void themeFromPresentation(doc.id).then((problem) => {
                useNotice.setState({ text: problem });
              });
            }}
          >
            Make a theme from this
          </Button>
        )}
        {!doc.passage && !doc.repeat && (
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
            {/* Session 50: Delete… for the presentation open here, asked first and with Undo, as the library's
                trash. Pro Mode only, as the whole grid is: Simple Mode never deletes. Session 51: Delete from the
                library… while a playlist item is open, as it deletes the presentation, not only this card. */}
            <MenuButton
              label="Presentation"
              title="Presentation actions"
              icon={MoreHorizontal}
              testId="presentation-menu"
              entries={[
                {
                  label: deleteOpenLabel(item),
                  icon: Trash2,
                  danger: true,
                  onSelect: () => {
                    requestRemovalOfOpen(doc.id, doc.name);
                  },
                },
              ]}
            />
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
          // Room for its track (96 px at least) and its value (40 px): narrower, the value stuck out.
          className="w-40"
          onChange={(e) => {
            setThumb(Number(e.target.value));
          }}
        />
      </div>
      {/* Its words shrink and scroll in a short place (Session 51: with a playlist open in a 1024 × 645 window, Read
          more and Got it had run under the layer bar). */}
      {help.card && <div className="min-h-0 overflow-y-auto pt-2">{help.card}</div>}
      {order.slides.length === 0 ? (
        // Centred while it fits, from its top when it does not (Session 51), as the middle's other places are.
        <CentredPlace>
          <EmptyState icon={Presentation} title="No slides yet">
            Use Edit words to write its words, and each blank line starts a slide.
          </EmptyState>
        </CentredPlace>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
          {/* Every slide in play order, wrapping across the width: a chorus sung again shows again. */}
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
                  // A passage's and a Repeat Slides playlist's slides are made elsewhere.
                  onNewTimerSlide={doc.passage || doc.repeat ? undefined : newTimerSlide}
                />
              );
            })}
          </ul>
        </div>
      )}
      {timerSlide && (
        <NewTimerSlideInLibrary
          presentationId={doc.id}
          name={doc.name}
          afterSlideId={timerSlide.slideId}
          position={timerSlide.position}
          onClose={() => {
            setTimerSlide(null);
          }}
        />
      )}
    </section>
  );
}
