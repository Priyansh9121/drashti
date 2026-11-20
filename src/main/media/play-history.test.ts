import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState, type Layers } from '../../shared/engine/state';
import { PlayHistory } from './play-history';

/*
 * Resume where it stopped, last played and play counts (alpha.20, the owner's Q60-34 item 3 and his "Yes, all A" to
 * Q60-39): the main process follows the engine's state. States made here; the library's writes recorded.
 */

const MIN = 60_000;

function state(layers: Partial<Layers>): EngineState {
  const base = initialEngineState();
  return { ...base, layers: { ...base.layers, ...layers } };
}

const background = (mediaId: string, startedAt: number, durationMs: number | undefined, more = {}) =>
  state({
    background: {
      kind: 'media',
      mediaId,
      media: 'video',
      fit: 'fit',
      loop: false,
      startedAt,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...more,
    },
  });

const sound = (mediaId: string, startedAt: number, durationMs: number) =>
  state({
    audio: { id: mediaId, title: 'Placeholder talk', mediaId, volume: 1, loop: false, startedAt, durationMs },
  });

function follow(initial: EngineState | null = null) {
  let now = 1_000_000;
  const written: string[] = [];
  const history = new PlayHistory(
    {
      later: (_key, run) => {
        run();
      },
      media: {
        countPlay: (id) => written.push(`count ${id}`),
        keepResume: (id, atMs) => written.push(`keep ${id} ${String(Math.round(atMs))}`),
        forgetResume: (id) => written.push(`forget ${id}`),
      },
      now: () => now,
    },
    initial,
  );
  return {
    history,
    written,
    at: (ms: number) => {
      now = ms;
    },
  };
}

describe('the plays the main process keeps', () => {
  it('counts a file once for each time it goes up; a move while it plays is the same showing', () => {
    const t = follow();
    t.history.changed(background('v', 1_000_000, 20 * MIN));
    t.at(1_010_000);
    t.history.changed(background('v', 1_000_000, 20 * MIN, { seek: { at: 1_010_000, toMs: 5 * MIN } }));
    expect(t.written).toEqual(['count v']);
    t.at(1_020_000);
    t.history.changed(background('v', 1_020_000, 20 * MIN));
    expect(t.written.filter((w) => w === 'count v')).toHaveLength(2);
  });

  it('a long background video taken off part-way keeps where it was; in its last 30 s it is forgotten', () => {
    const t = follow();
    t.history.changed(background('v', 1_000_000, 20 * MIN));
    t.at(1_000_000 + 6 * MIN);
    t.history.changed(state({}));
    expect(t.written).toEqual(['count v', `keep v ${String(6 * MIN)}`]);
    t.history.changed(background('v', 2_000_000, 20 * MIN));
    t.at(2_000_000 + 20 * MIN - 10_000);
    t.history.changed(state({}));
    expect(t.written.at(-1)).toBe('forget v');
  });

  it('keeps nothing for a file under 10 minutes, one that goes round, or one whose length is not known', () => {
    const t = follow();
    for (const [id, length, more] of [
      ['short', 9 * MIN, {}],
      ['round', 20 * MIN, { loop: true }],
      ['unknown', undefined, {}],
    ] as const) {
      t.history.changed(background(id, 1_000_000, length, more));
      t.at(1_000_000 + 2 * MIN);
      t.history.changed(state({}));
      t.at(1_000_000);
    }
    expect(t.written).toEqual(['count short', 'count round', 'count unknown']);
  });

  it('a paused one keeps where it waits; the sound alone keeps its place too', () => {
    const t = follow();
    t.history.changed(
      background('v', 1_000_000, 20 * MIN, { seek: { at: 1_000_000 + MIN, toMs: 3 * MIN, paused: true } }),
    );
    t.at(1_000_000 + 9 * MIN);
    t.history.changed(sound('s', 1_000_000 + 9 * MIN, 30 * MIN));
    t.at(1_000_000 + 11 * MIN);
    t.history.changed(state({}));
    // What went up is counted before what came off is kept, in one change.
    expect(t.written).toEqual([
      'count v',
      'count s',
      `keep v ${String(3 * MIN)}`,
      `keep s ${String(2 * MIN)}`,
    ]);
  });

  it('a show brought back at the start is not counted again; what plays at a quit keeps where it is', () => {
    const t = follow(background('v', 1_000_000, 20 * MIN));
    t.at(1_000_000 + 4 * MIN);
    t.history.changed(background('v', 1_000_000, 20 * MIN));
    expect(t.written).toEqual([]);
    t.history.quitting();
    expect(t.written).toEqual([`keep v ${String(4 * MIN)}`]);
  });
});
