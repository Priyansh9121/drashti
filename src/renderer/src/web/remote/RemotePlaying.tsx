import { useMemo } from 'react';
import type { PlayingRef } from '../../../../shared/engine/playing';
import type { EngineState } from '../../../../shared/engine/state';
import { barNow, type PlayingRow, playingRows } from '../../markers/playing-rows';
import { useNow } from '../../render/useNow';
import { Button } from '../../ui/Button';
import { Pause, Play } from '../../ui/icons';
import { TimeBar } from '../../ui/TimeBar';
import { api } from '../device';
import { tap } from '../taps';

/*
 * The time bar on a phone or tablet (Session 54, B2), right under the live picture, above what plays' skips and
 * markers (D5's Playing): the same rows as under LIVE in Drashti (markers/playing-rows.ts), each named and with its
 * elapsed time and time left, its start and end points and its markers as ticks, at a finger's size (44 px), with
 * Play or Pause beside it. A tap or a drag moves it (once, as the finger lets go), in step on every screen, as the
 * operator's does; when Drashti is in Simple Mode it says the move is refused.
 */

const send = (path: string, body: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

const move = (playing: PlayingRef, toMs: number) => void tap(send('/api/v1/playing/move', { playing, toMs }));

export function RemotePlaying({ state }: { state: EngineState | null }) {
  const rows = useMemo(() => playingRows(state), [state]);
  if (rows.length === 0) return null;
  // Each row a group named for what it plays; the "Playing" heading is the skips' and markers' below (D5).
  return (
    <div className="space-y-3" data-testid="remote-time-bars">
      {rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </div>
  );
}

function Row({ row }: { row: PlayingRow }) {
  // Where it is, from the engine's time as this phone knows it, a few times a second.
  const now = useNow(250);
  const { playing } = row;
  const bar = barNow(playing, now);
  const known = bar.durationMs !== null;
  const stopped = playing.paused || bar.ended;
  return (
    <div
      role="group"
      aria-label={row.name}
      className="space-y-1"
      data-testid="remote-time-bar-row"
      data-playing={row.key}
      data-paused={playing.paused ? 'true' : undefined}
    >
      <p className="truncate text-base">
        {row.short}
        {playing.paused && <span className="text-muted"> · Paused</span>}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          size="lg"
          icon={stopped ? Play : Pause}
          disabled={!known}
          data-testid={stopped ? 'remote-time-bar-play' : 'remote-time-bar-pause'}
          onClick={() =>
            void tap(
              send(stopped ? '/api/v1/playing/play' : '/api/v1/playing/pause', { playing: playing.ref }),
            )
          }
        >
          {stopped ? 'Play' : 'Pause'}
        </Button>
        <TimeBar
          className="min-w-0 flex-1"
          size="lg"
          label={row.name}
          testId="remote-time-bar"
          atMs={bar.atMs}
          durationMs={bar.durationMs}
          startMs={bar.startMs}
          endMs={bar.endMs}
          markers={playing.marks}
          onMove={(ms) => {
            move(playing.ref, ms);
          }}
        />
      </div>
    </div>
  );
}
