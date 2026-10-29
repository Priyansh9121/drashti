import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import type { MediaBackground } from '../../../shared/engine/state';
import { type AudioCue, backgroundCueOf, type BackgroundCue, soundCueOf } from '../../../shared/library';
import type { OrderedSlide } from '../../../shared/order';
import { CannotPlayBadge } from '../library/MediaList';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { OversetMark, OversetWatch } from '../render/measure';
import { Badge, LiveBadge, MissingBadge } from '../ui/Badge';
import { cx } from '../ui/cx';
import { AlertTriangle, Music, Video } from '../ui/icons';
import { useInputNamed } from '../video-inputs/video-inputs-store';

/*
 * A slide's row (Session 55, Part 4: the bottom slides area went, and a presentation's slides are rows under its name
 * in the playlist, or, with none open, the library's chosen presentation's): its number for jumping to it, its
 * group's colour, a small picture of it (with its background, and what is missing marked as the slide grid marked
 * it), "<name>_N", a text slide's first line, its group's name where the group starts, the video input or sound it
 * brings, and LIVE. One click puts it up; a double click opens Edit slides at it (the first click put it up). In a
 * playlist it can be dragged (Part 4b): within its deck, or out of it into an item of its own.
 */

/**
 * The slide's own background (its background cue), behind its picture: the image, or a video's still frame. Its
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
        className="absolute top-0.5 left-0.5 origin-top-left scale-75"
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
          className="absolute top-0.5 left-0.5 origin-top-left scale-75"
        >
          <CannotPlayBadge mediaId={mediaId} />
        </span>
      )}
    </span>
  );
}

/**
 * The video input behind a slide (Session 51), by the name its cue keeps: marked when this computer has none of that
 * name (the background then stays as it was when the slide goes up).
 */
function RowInput({ name, live }: { name: string; live: boolean }) {
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
 * The sound a slide plays. Its file missing (Session 54), marked as a video input not here is (the sound then stays
 * as it was when the slide goes up), and named so, as a missing background is.
 */
function RowSound({ cue, live }: { cue: AudioCue; live: boolean }) {
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

/** A slide's sound whose file is missing (Session 54 review), in its picture's bottom left corner. */
function SoundMissingBadge({ cue }: { cue: AudioCue }) {
  return (
    <span
      data-testid="thumb-sound-missing"
      data-media-id={cue.mediaId}
      title={`“${cue.name}” is missing: the sound stays as it was when this slide goes up`}
      className="absolute bottom-0.5 left-0.5 origin-bottom-left scale-75"
    >
      <Badge tone="warning" icon={Music}>
        Missing
      </Badge>
    </span>
  );
}

export interface SlideRowProps {
  /** Its number, for jumping to it. */
  number: number;
  /** "<name>_N". */
  label: string;
  /** A text slide's first line ('' for none). */
  line: string;
  at: OrderedSlide;
  /** Its group's name is shown here: the first slide each time its group comes up. */
  firstOfRun: boolean;
  live: boolean;
  /** A search found this slide: bring it into view and mark it. */
  found?: boolean;
  /** Under a folded name: not shown (it keeps its number). */
  hidden?: boolean;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  /** The playlist item it plays from, for its menu and the jump (left out for the library's). */
  itemId?: string;
  /** It can be dragged (Session 55, Part 4b: a presentation's slide in a playlist), from this. */
  onDragStart?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  /** A dragged slide's row would land just above it, or (the last row) just below it. */
  dropLine?: 'before' | 'after' | null;
}

export const SlideRow = memo(function SlideRow({
  number,
  label,
  line,
  at,
  firstOfRun,
  live,
  found = false,
  hidden = false,
  onClick,
  onDoubleClick,
  onContextMenu,
  onKeyDown,
  itemId,
  onDragStart,
  dropLine = null,
}: SlideRowProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const info = at.slide;
  const { group } = at;
  // The live slide comes into view in the same frame it turns live: never a smooth scroll (Session 25).
  useLayoutEffect(() => {
    if (live) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [live]);
  useEffect(() => {
    if (found) ref.current?.scrollIntoView({ block: 'center' });
  }, [found]);
  // The background cue it plays: its last, when it has more than one (Session 52), as the slide going up does.
  const background = backgroundCueOf(info.cues);
  const behind = background?.background;
  const inputName = behind?.kind === 'input' ? behind.name : null;
  const sound = soundCueOf(info.cues);
  // Its background's file or its sound's missing, said in its name too (Session 54 review), as its marks show them.
  const fileGone = background?.missing === true && behind?.kind === 'media' ? background.name : null;
  const soundGone = sound?.missing === true ? sound.name : null;
  // Words past a box on this slide (Sessions 31–36, SLD-1): marked in its corner, and said with its name.
  const [over, setOver] = useState(false);
  const groupName = firstOfRun && group.name !== '' ? group.name : '';
  return (
    <li
      hidden={hidden}
      data-slide-row={itemId}
      data-drop={dropLine ?? undefined}
      className={cx(
        'rounded-md',
        dropLine === 'before' && 'shadow-[0_-2px_0_0_var(--color-accent)]',
        dropLine === 'after' && 'shadow-[0_2px_0_0_var(--color-accent)]',
      )}
    >
      <button
        ref={ref}
        type="button"
        draggable={onDragStart !== undefined}
        onDragStart={onDragStart}
        data-testid="slide-thumb"
        data-show-control
        data-index={at.position}
        data-slide-id={info.id}
        data-row-number={number}
        data-found={found ? 'true' : undefined}
        aria-current={live ? 'true' : undefined}
        aria-label={`${label}${line !== '' ? `: ${line}` : ''}${groupName !== '' ? `, ${groupName}` : ''}${live ? ' (live)' : ''}${over ? ', words run past a box' : ''}${fileGone !== null ? `, its background file “${fileGone}” is missing` : ''}${soundGone !== null ? `, its sound file “${soundGone}” is missing` : ''}`}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        className={cx(
          // Live at once, with no fade (Session 26g): the border and the red edge in one frame.
          'group flex min-h-12 w-full items-center gap-2 overflow-hidden rounded-md border-2 py-1 pr-2 text-left',
          live
            ? 'border-live bg-panel-3 shadow-live-thumb'
            : found
              ? 'border-accent bg-panel-2'
              : 'border-transparent hover:border-field hover:bg-panel-2',
        )}
      >
        <span
          className={cx(
            'w-8 shrink-0 text-right text-xs tabular-nums',
            live ? 'font-bold text-fg' : 'text-muted',
          )}
          data-testid="row-number"
          aria-hidden="true"
        >
          {number}
        </span>
        <span
          aria-hidden="true"
          data-testid="group-color"
          className="h-9 w-1 shrink-0 rounded-sm"
          style={{ background: group.color ?? 'transparent' }}
        />
        <span
          className="pointer-events-none relative block aspect-video w-20 shrink-0 overflow-hidden rounded-sm border border-line bg-black"
          data-a11y-picture
        >
          {background && behind?.kind === 'media' && <CueBackground cue={background} background={behind} />}
          <PlacedInParent content={info.slide} mode="fit" className="absolute inset-0">
            <OversetWatch onChange={setOver}>
              <SlideView slide={info.slide} media="still" />
            </OversetWatch>
          </PlacedInParent>
          {over && <OversetMark />}
          {sound?.missing === true && <SoundMissingBadge cue={sound} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium" data-testid="slide-label">
              {label}
            </span>
            {groupName !== '' && (
              <span
                data-testid="slide-group"
                data-group={group.name}
                className="max-w-[40%] shrink-0 truncate rounded-sm bg-panel-3 px-1 text-2xs font-bold text-muted"
              >
                {group.name}
              </span>
            )}
          </span>
          {line !== '' && (
            <span className="block truncate text-xs text-muted" data-testid="slide-line">
              {line}
            </span>
          )}
          {(inputName !== null || sound) && (
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
              {inputName !== null && <RowInput name={inputName} live={live} />}
              {sound && <RowSound cue={sound} live={live} />}
            </span>
          )}
        </span>
        {live && <LiveBadge />}
      </button>
    </li>
  );
});
