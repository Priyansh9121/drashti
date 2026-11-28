import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEngine } from '../engine/engine-store';
import { useMedia } from '../library/library-store';
import { openMediaInfo } from '../library/media-info';
import { pushRemoval } from '../library/undo';
import { dispatch, useNotice } from '../operator/actions';
import { useMode } from '../operator/mode-store';
import { usePractice } from '../practice/practice-store';
import { engineNow } from '../render/clock';
import { useNow } from '../render/useNow';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/Button';
import { Camera, Info, MoreHorizontal, Pause, Play, Repeat, StepBack, StepForward } from '../ui/icons';
import { MenuButton, type MenuEntry } from '../ui/Menu';
import { cx } from '../ui/cx';
import { TimeBar } from '../ui/TimeBar';
import { VideoCaptionButton } from '../video-captions/VideoCaptionControl';
import type { PlayingRef } from '../../../shared/engine/playing';
import type { EngineState } from '../../../shared/engine/state';
import { playbackAtMs, playbackLeftMs } from '../../../shared/media';
import { inLastSeconds } from '../../../shared/wallpapers';
import { barNow, moveCommand, pauseCommand, playCommand, type PlayingRow, playingRows } from './playing-rows';
import { Scrub } from './scrub';
import { useFrameMs } from './frame-length';

/*
 * The time bar under LIVE (Session 54): one row for each thing playing, the background video, each video on the slide
 * up (a deck's too), the picture-in-picture box's video, and the sound or an audio playlist's track (in Music too). In
 * Pro Mode it sits under Next and Back, beside the skips and the markers, so they stay where they are however many
 * things play (Session 54's review); in Simple Mode, under the LIVE picture.
 * Each row is its short name and its bar, with its time left (and in Pro Mode its elapsed time), its start and end
 * points and its markers as ticks, and Play or Pause before it. A click or a drag moves it, as an ordinary player's
 * does (Session 56, the owner's words of 11 Nov: "Drag LIVE's time bar ... like an ordinary player", in both modes,
 * and "Pause under LIVE" in Simple Mode): a video's picture follows the finger while dragging, waiting paused at the
 * time under it (markers/scrub.ts), and plays on from where it is let go; a sound jumps there as it is let go. The
 * arrow keys move it too. Every screen, node, the stream, key and fill and the audio player land there in step, as a
 * jump to a marker does (the engine's moveTo, pausePlaying and resumePlaying). Until Session 56 Simple Mode showed the
 * bar and moved nothing, with Play only while something was paused. The practice show has none.
 */

/**
 * The room the bars keep while a show control is up under them (alpha.24, lead 2's liverows; a25 list item 43): the
 * cued video's card (Go, Cancel) and the live zoom's + and − sit under the time bars (cuestill), so a bar going (a
 * sound ending, a video taken off) lifted them under the operator's hand, 36 px or more. While anything is drawn under
 * them (`below` holds an element), the bars' place never shrinks: it keeps its tallest height since then, and gives the
 * room back once nothing is under it. A bar coming still makes its room (there is none to keep for it). Read only
 * while something is under them, so a column at rest measures nothing.
 */
function useHeldRoom(
  place: RefObject<HTMLDivElement | null>,
  below: RefObject<HTMLDivElement | null>,
  playing: boolean,
): number {
  // Whether something is under the bars, and the room held since it came (one state, so a room read as it went can
  // never be kept for the next time).
  const [room, setRoom] = useState({ up: false, held: 0 });
  useEffect(() => {
    const el = below.current;
    if (!el) return;
    const look = () => {
      const up = el.childElementCount > 0;
      setRoom((was) => (was.up === up ? was : { up, held: 0 }));
    };
    look();
    const seen = new MutationObserver(look);
    seen.observe(el, { childList: true });
    return () => {
      seen.disconnect();
    };
  }, [below]);
  // The bars' height as drawn (the room kept is its least, so it only grows), read in the frame a bar comes or grows;
  // looked at again as the bars come or all go (the place drawn anew, or kept at its room).
  useLayoutEffect(() => {
    const el = place.current;
    if (!room.up || !el) return;
    const seen = new ResizeObserver(() => {
      const height = el.offsetHeight;
      setRoom((was) => (was.up && height > was.held ? { up: true, held: height } : was));
    });
    seen.observe(el);
    return () => {
      seen.disconnect();
    };
  }, [place, room.up, playing]);
  return room.up ? room.held : 0;
}

/**
 * `className`: its place's own spacing (under Next and Back in Pro Mode; none under Simple Mode's LIVE picture).
 * `under`: what sits under the bars (the cued video's card, the live zoom's buttons), drawn in a place of its own with
 * the same spacing, gone while empty; the bars keep their room while it holds anything (useHeldRoom).
 */
export function PlayingBars({ className, under }: { className?: string; under?: ReactNode } = {}) {
  const state = useEngine((s) => s.state);
  const practising = usePractice((s) => s.on);
  const pro = useMode((s) => s.mode) === 'pro';
  const rows = useMemo(() => (practising ? [] : playingRows(state)), [state, practising]);
  const place = useRef<HTMLDivElement>(null);
  const below = useRef<HTMLDivElement>(null);
  const held = useHeldRoom(place, below, rows.length > 0);
  const bars =
    rows.length > 0 || held > 0 ? (
      <div
        ref={place}
        className={className}
        style={held > 0 ? { minHeight: `${String(held)}px` } : undefined}
      >
        {rows.length > 0 && (
          <div className="space-y-0.5" data-testid="time-bars">
            {rows.map((row) => (
              <Row key={row.key} row={row} pro={pro} repeating={repeatingOf(state, row.playing.ref)} />
            ))}
          </div>
        )}
      </div>
    ) : null;
  if (under === undefined) return bars;
  return (
    <>
      {bars}
      <div ref={below} className={cx('space-y-2 empty:hidden', className)}>
        {under}
      </div>
    </>
  );
}

/** Whether the background video or the sound goes round from A to B now (alpha.20, the time bar's ⋯). */
function repeatingOf(state: EngineState | null, ref: PlayingRef): boolean {
  if (ref.layer === 'background') {
    const bg = state?.layers.background;
    return bg?.kind === 'media' && bg.ab !== undefined;
  }
  return ref.layer === 'audio' && state?.layers.audio?.ab !== undefined;
}

/** Snapshot (alpha.20): the frame on the screens into Media, with Undo; why not, in the window's notice. */
async function snapshot(ref: PlayingRef): Promise<void> {
  const made = await window.drashti.media.snapshot(ref);
  if (!made.ok) {
    useNotice.setState({ text: made.message });
    return;
  }
  pushRemoval({
    text: `Snapshot “${made.name}” in Media`,
    restore: async () => {
      await window.drashti.media.remove([made.mediaId]);
    },
  });
}

function Row({ row, pro, repeating }: { row: PlayingRow; pro: boolean; repeating: boolean }) {
  // Where it is, from the engine's time, a few times a second.
  const now = useNow(250);
  const { playing } = row;
  const bar = barNow(playing, now);
  const known = bar.durationMs !== null;
  // The time bar's ⋯ (alpha.20, Pro Mode): A waits here for B, for this showing (the row's key) only.
  const [markA, setMarkA] = useState<number | null>(null);
  const video = playing.ref.layer !== 'audio' && playing.sound !== true;
  const frameMs = useFrameMs(pro && video ? playing.mediaId : null);
  const fileName = useMedia((s) => s.media.find((m) => m.id === playing.mediaId)?.name ?? null);
  // The picture following a drag (Session 56, scrub.ts), let go of with the row (another file, another showing).
  const [scrub] = useState(
    () =>
      new Scrub({
        send: dispatch,
        // A steady clock, only to space the moves.
        now: () => performance.now(),
        later: (ms, run) => {
          const wait = setTimeout(run, ms);
          return () => {
            clearTimeout(wait);
          };
        },
      }),
  );
  useEffect(() => {
    scrub.open();
    return () => {
      scrub.dispose();
    };
  }, [scrub]);
  // A drag under way: the row shows Play or Pause as it was when it began, never the drag's own pause.
  const [before, setBefore] = useState<{ paused: boolean; stopped: boolean } | null>(null);
  const paused = before ? before.paused : playing.paused;
  const stopped = before ? before.stopped : playing.paused || bar.ended;
  const stepFrame = (by: 1 | -1) => {
    if (frameMs !== null && playing.paused)
      void dispatch({ type: 'stepFrame', playing: playing.ref, by, frameMs });
  };
  const abHere = playing.ref.layer === 'background' || playing.ref.layer === 'audio';
  const more: MenuEntry[] = [
    ...(abHere
      ? [
          {
            label: 'Repeat from here (A)',
            icon: Repeat,
            disabled: !known,
            onSelect: () => {
              setMarkA(Math.round(bar.atMs));
            },
          },
          {
            label: '…to here (B)',
            disabled: markA === null || !known,
            onSelect: () => {
              if (markA === null) return;
              void dispatch({
                type: 'repeatAb',
                playing: playing.ref,
                fromMs: markA,
                toMs: Math.round(bar.atMs),
              });
              setMarkA(null);
            },
          },
          ...(repeating
            ? [
                {
                  label: 'Stop repeating A-B',
                  onSelect: () => {
                    void dispatch({ type: 'stopAb', playing: playing.ref });
                  },
                },
              ]
            : []),
        ]
      : []),
    ...(video
      ? [
          {
            label: 'One frame back',
            icon: StepBack,
            separatorBefore: abHere,
            disabled: !playing.paused || frameMs === null,
            onSelect: () => {
              stepFrame(-1);
            },
          },
          {
            label: 'One frame on',
            icon: StepForward,
            disabled: !playing.paused || frameMs === null,
            onSelect: () => {
              stepFrame(1);
            },
          },
          {
            label: 'Snapshot',
            icon: Camera,
            disabled: !known,
            onSelect: () => {
              void snapshot(playing.ref);
            },
          },
        ]
      : []),
    {
      label: 'Media information…',
      icon: Info,
      separatorBefore: true,
      onSelect: () => {
        openMediaInfo({ id: playing.mediaId, name: fileName ?? row.short });
      },
    },
  ];
  // A waiting for B, a tick on the bar.
  const marks = markA === null ? playing.marks : [...playing.marks, { id: 'ab-a', name: 'A', atMs: markA }];
  // The background video's last 10 seconds (Session 55, Part 6, E): its time in amber.
  const ending =
    row.which === 'background' &&
    !playing.clock.loop &&
    bar.durationMs !== null &&
    inLastSeconds(playbackLeftMs(playing.clock, bar.durationMs, now));
  // A video's picture follows a drag; a sound's jumps where it is let go (scrub.ts).
  const follows = playing.ref.layer !== 'audio' && playing.sound !== true;
  const onMove = (ms: number) => {
    scrub.letGo(playing.ref, ms);
    setBefore(null);
  };
  const onScrub = (ms: number | null) => {
    if (ms === null) {
      scrub.cancel();
      setBefore(null);
      return;
    }
    if (!scrub.scrubbing) setBefore({ paused: playing.paused, stopped: playing.paused || bar.ended });
    // What plays as the drag begins: Esc puts it back where it would be by then.
    const clock = playing.clock;
    const length = bar.durationMs;
    const startAt = bar.atMs;
    const began = engineNow();
    scrub.hold(
      () => ({
        ref: playing.ref,
        // Held at its end is not paused: let go before its end, it plays on from there, as Play would.
        paused: playing.paused,
        endMs: !clock.loop && length !== null ? (bar.endMs ?? length) : null,
        at: () =>
          length !== null ? playbackAtMs(clock, length, engineNow()) : startAt + engineNow() - began,
      }),
      ms,
    );
  };
  return (
    <div
      role="group"
      aria-label={ending ? `${row.name}, ending` : row.name}
      // Its time bar keeps room for its times: in a narrow column it goes to a line of its own (alpha.21, the owner's
      // "look how cramped up the whole place is").
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
      data-testid="time-bar-row"
      data-playing={row.which}
      data-paused={paused ? 'true' : undefined}
      data-last-seconds={ending ? 'true' : undefined}
    >
      {stopped ? (
        <IconButton
          icon={Play}
          label="Play"
          size="sm"
          variant="secondary"
          disabled={!known}
          // Show controls (alpha.24, QA24-UIMOTION-SKIP): what the hall sees and hears changes at once.
          instant
          data-testid="time-bar-play"
          onClick={() => void dispatch(playCommand(playing.ref))}
        />
      ) : (
        <IconButton
          icon={Pause}
          label="Pause"
          size="sm"
          variant="secondary"
          disabled={!known}
          instant
          data-testid="time-bar-pause"
          onClick={() => void dispatch(pauseCommand(playing.ref))}
        />
      )}
      <span className="w-[4.5rem] shrink-0 truncate text-xs text-muted" title={row.short}>
        {row.short}
      </span>
      {/* Paused: its Play button says so, with no word of its own (alpha.21, the owner's "remove where its written
          paused, it takes up much space"); the row's data-paused says it to the tests. */}
      {repeating && <Badge data-testid="time-bar-ab">A-B</Badge>}
      {playing.ref.layer !== 'audio' && !playing.sound && <VideoCaptionButton mediaId={playing.mediaId} />}
      <TimeBar
        className="min-w-40 flex-1"
        label={row.name}
        atMs={bar.atMs}
        durationMs={bar.durationMs}
        startMs={bar.startMs}
        endMs={bar.endMs}
        markers={marks}
        elapsed={pro}
        warning={ending}
        onMove={onMove}
        {...(follows ? { onScrub } : {})}
        {...(pro && video ? { onFrame: stepFrame } : {})}
      />
      {pro && (
        <MenuButton
          label={`More for ${row.short}`}
          icon={MoreHorizontal}
          entries={more}
          testId="time-bar-more"
        />
      )}
    </div>
  );
}

/**
 * The audio playlist's track's bar in Music (Session 54), under what plays, in Pro Mode: a click or a drag moves it
 * (at its end, on to the next track, as Forward 15 s does); Play and Pause are the row's own, beside it.
 */
export function TrackBar() {
  const state = useEngine((s) => s.state);
  // The track as its row under LIVE has it, keyed alike: the next track is a bar drawn anew (Session 54's review).
  const track = useMemo(() => playingRows(state).find((r) => r.playing.track) ?? null, [state]);
  const now = useNow(250);
  if (!track) return null;
  const bar = barNow(track.playing, now);
  return (
    <TimeBar
      key={track.key}
      label="Time of the track playing"
      testId="music-time-bar"
      atMs={bar.atMs}
      durationMs={bar.durationMs}
      startMs={bar.startMs}
      endMs={bar.endMs}
      markers={track.playing.marks}
      onMove={(ms) => void dispatch(moveCommand(track.playing.ref, ms))}
    />
  );
}
