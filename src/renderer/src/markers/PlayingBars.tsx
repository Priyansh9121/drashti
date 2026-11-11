import { useEffect, useMemo, useState } from 'react';
import { useEngine } from '../engine/engine-store';
import { dispatch } from '../operator/actions';
import { useMode } from '../operator/mode-store';
import { usePractice } from '../practice/practice-store';
import { engineNow } from '../render/clock';
import { useNow } from '../render/useNow';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/Button';
import { Pause, Play } from '../ui/icons';
import { cx } from '../ui/cx';
import { TimeBar } from '../ui/TimeBar';
import { playbackAtMs, playbackLeftMs } from '../../../shared/media';
import { inLastSeconds } from '../../../shared/wallpapers';
import { barNow, moveCommand, pauseCommand, playCommand, type PlayingRow, playingRows } from './playing-rows';
import { Scrub } from './scrub';

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

/** `className`: its place's own spacing (under Next and Back in Pro Mode; none under Simple Mode's LIVE picture). */
export function PlayingBars({ className }: { className?: string } = {}) {
  const state = useEngine((s) => s.state);
  const practising = usePractice((s) => s.on);
  const pro = useMode((s) => s.mode) === 'pro';
  const rows = useMemo(() => playingRows(state), [state]);
  if (practising || rows.length === 0) return null;
  return (
    <div className={cx('space-y-0.5', className)} data-testid="time-bars">
      {rows.map((row) => (
        <Row key={row.key} row={row} pro={pro} />
      ))}
    </div>
  );
}

function Row({ row, pro }: { row: PlayingRow; pro: boolean }) {
  // Where it is, from the engine's time, a few times a second.
  const now = useNow(250);
  const { playing } = row;
  const bar = barNow(playing, now);
  const known = bar.durationMs !== null;
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
      className="flex min-w-0 items-center gap-1.5"
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
          data-testid="time-bar-pause"
          onClick={() => void dispatch(pauseCommand(playing.ref))}
        />
      )}
      <span className="w-[4.5rem] shrink-0 truncate text-xs text-muted" title={row.short}>
        {row.short}
      </span>
      {paused && <Badge data-testid="time-bar-paused">Paused</Badge>}
      <TimeBar
        className="min-w-0 flex-1"
        label={row.name}
        atMs={bar.atMs}
        durationMs={bar.durationMs}
        startMs={bar.startMs}
        endMs={bar.endMs}
        markers={playing.marks}
        elapsed={pro}
        warning={ending}
        onMove={onMove}
        {...(follows ? { onScrub } : {})}
      />
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
