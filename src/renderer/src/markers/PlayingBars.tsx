import { useMemo } from 'react';
import { useEngine } from '../engine/engine-store';
import { dispatch } from '../operator/actions';
import { useMode } from '../operator/mode-store';
import { usePractice } from '../practice/practice-store';
import { useNow } from '../render/useNow';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/Button';
import { Pause, Play } from '../ui/icons';
import { TimeBar } from '../ui/TimeBar';
import { playingOf } from '../../../shared/engine/playing';
import { barNow, moveCommand, pauseCommand, playCommand, type PlayingRow, playingRows } from './playing-rows';

/*
 * The time bar under LIVE (Session 54): one row for each thing playing, the background video, each video on the slide
 * up (a deck's too), the picture-in-picture box's video, and the sound or an audio playlist's track (in Music too).
 * Each row is its short name and its bar, with its elapsed time and time left, its start and end points and its
 * markers as ticks. In Pro Mode a click or a drag moves it (once, on release) and Play or Pause sits before it; every
 * screen, node, the stream, key and fill and the audio player land there in step, as a jump to a marker does (the
 * engine's moveTo, pausePlaying and resumePlaying). Simple Mode shows the bar and its time left, and moves nothing.
 * The practice show has none.
 */

export function PlayingBars() {
  const state = useEngine((s) => s.state);
  const practising = usePractice((s) => s.on);
  const pro = useMode((s) => s.mode) === 'pro';
  const rows = useMemo(() => playingRows(state), [state]);
  if (practising || rows.length === 0) return null;
  return (
    <div className="space-y-0.5" data-testid="time-bars">
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
  const stopped = playing.paused || bar.ended;
  return (
    <div
      role="group"
      aria-label={row.name}
      className="flex min-w-0 items-center gap-1.5"
      data-testid="time-bar-row"
      data-playing={row.key}
      data-paused={playing.paused ? 'true' : undefined}
    >
      {pro &&
        (stopped ? (
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
        ))}
      <span className="w-[4.5rem] shrink-0 truncate text-xs text-muted" title={row.short}>
        {row.short}
      </span>
      {playing.paused && <Badge data-testid="time-bar-paused">Paused</Badge>}
      <TimeBar
        className="min-w-0 flex-1"
        label={row.name}
        atMs={bar.atMs}
        durationMs={bar.durationMs}
        startMs={bar.startMs}
        endMs={bar.endMs}
        markers={playing.marks}
        elapsed={pro}
        {...(pro ? { onMove: (ms: number) => void dispatch(moveCommand(playing.ref, ms)) } : {})}
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
  const track = useMemo(() => {
    const playing = playingOf(state, { layer: 'audio' });
    return playing?.track ? playing : null;
  }, [state]);
  const now = useNow(250);
  if (!track) return null;
  const bar = barNow(track, now);
  return (
    <TimeBar
      label="Time of the track playing"
      testId="music-time-bar"
      atMs={bar.atMs}
      durationMs={bar.durationMs}
      startMs={bar.startMs}
      endMs={bar.endMs}
      markers={track.marks}
      onMove={(ms) => void dispatch(moveCommand(track.ref, ms))}
    />
  );
}
