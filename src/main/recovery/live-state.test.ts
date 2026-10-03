import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState } from '../../shared/engine/state';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { textSlide } from '../engine/testing';
import type { RecoveryFiles } from './live-state';
import { LiveStateWriter, savedFrom, toRestore } from './live-state';

let dir: string;
let files: RecoveryFiles;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const background = {
  kind: 'media',
  mediaId: 'clouds',
  media: 'video',
  fit: 'fill',
  loop: true,
  startedAt: 1234,
} as const;

function live(
  patch: { slideIndex?: number | null; blackout?: boolean; withBackground?: boolean } = {},
): EngineState {
  const s = initialEngineState();
  const slideIndex = patch.slideIndex === undefined ? 2 : patch.slideIndex;
  return {
    ...s,
    live: { presentationId: 'p1', slideIndex: 2, slideCount: 5, arrangementId: null, playlist: null },
    blackout: patch.blackout ?? false,
    layers: {
      ...s.layers,
      slide:
        slideIndex === null
          ? null
          : { presentationId: 'p1', slideIndex, slide: textSlide('s', 'x'), shownAt: 5, notes: '' },
      background: patch.withBackground === false ? null : background,
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-'));
  files = { state: join(dir, 'live-state.json'), cleanMark: join(dir, 'live-state.clean') };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function saved(writer: LiveStateWriter, state: EngineState) {
  writer.update(state);
  await pause(30);
  await writer.settle();
}

describe('restart recovery', () => {
  it('keeps the slide on screen (not just the cursor), the background and black-out', () => {
    expect(savedFrom(live({ blackout: true }), 'run-1', new Date(0))).toEqual({
      version: 1,
      session: 'run-1',
      engineVersion: ENGINE_STATE_VERSION,
      savedAt: '1970-01-01T00:00:00.000Z',
      slide: { presentationId: 'p1', slideIndex: 2, arrangementId: null },
      playlist: null,
      background,
      blackout: true,
      logo: null,
      audio: null,
      props: [],
      messages: [],
      ticker: null,
      stageMessage: null,
      timers: [],
      autoAdvance: null,
      lookId: null,
    });
    expect(savedFrom(live({ slideIndex: null }), 'run-1').slide).toBeNull();
  });

  it('keeps the live Look; a Look other than the first is worth putting back on its own', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    const nothing = initialEngineState();
    await saved(writer, { ...nothing, look: { id: 'look-first', name: 'Standard', groups: {} } });
    expect(toRestore(files, 'look-first')).toBeNull();
    await saved(writer, { ...nothing, look: { id: 'look-2', name: 'Placeholder', groups: {} } });
    expect(toRestore(files, 'look-first')).toMatchObject({ slide: null, lookId: 'look-2' });
    // With a slide up, the Look comes along whichever it is.
    await saved(writer, { ...live(), look: { id: 'look-first', name: 'Standard', groups: {} } });
    expect(toRestore(files, 'look-first')).toMatchObject({ lookId: 'look-first' });
  });

  it('keeps the time a slide moving on by itself had left, saved again every second while it counts', async () => {
    const counting: EngineState = { ...live(), autoAdvance: { startedAt: 10_000, durationMs: 8000 } };
    expect(savedFrom(counting, 'run-1', new Date(13_000)).autoAdvance).toEqual({
      leftMs: 5000,
      durationMs: 8000,
    });
    expect(savedFrom(counting, 'run-1', new Date(30_000)).autoAdvance).toEqual({
      leftMs: 0,
      durationMs: 8000,
    });
    // With no change at all, the file is written again and again while it counts.
    const running: EngineState = { ...live(), autoAdvance: { startedAt: Date.now(), durationMs: 60_000 } };
    const writer = new LiveStateWriter(files, { throttleMs: 5, heartbeatMs: 40 });
    await saved(writer, running);
    const first = (JSON.parse(readFileSync(files.state, 'utf8')) as { autoAdvance: { leftMs: number } })
      .autoAdvance;
    await pause(150);
    await writer.settle();
    const later = (JSON.parse(readFileSync(files.state, 'utf8')) as { autoAdvance: { leftMs: number } })
      .autoAdvance;
    expect(later.leftMs).toBeLessThan(first.leftMs);
    expect(toRestore(files)?.autoAdvance?.durationMs).toBe(60_000);
    writer.markClean();
    // A save may already be on its way: let it finish before the folder goes.
    await writer.settle();
  });

  it('keeps the playlist item being played, even with nothing else on screen', async () => {
    const playlist = { playlistId: 'sunday', itemId: 'item-3' };
    const state = live({ slideIndex: null, withBackground: false });
    const onItem = { ...state, live: { ...state.live, presentationId: null, slideIndex: null, playlist } };
    expect(savedFrom(onItem, 'run-1').playlist).toEqual(playlist);
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, onItem);
    expect(toRestore(files)).toMatchObject({ slide: null, playlist, background: null });
  });

  it('keeps the sound, props, messages, the stage message and timers that ran', async () => {
    const state = live({ slideIndex: null, withBackground: false });
    const audio = { id: 'a', title: 'Placeholder', mediaId: 'tune', volume: 1, loop: false, startedAt: 99 };
    const show: EngineState = {
      ...state,
      layers: {
        ...state.layers,
        audio,
        props: [{ id: 'p', name: 'Placeholder logo', elements: [] }],
        messages: [{ id: 'm', text: 'Placeholder message', parts: [{ kind: 'timer', timerId: 't1' }] }],
      },
      stageMessage: 'Placeholder stage',
      timers: [
        {
          id: 't1',
          name: 'A',
          kind: 'countdown',
          durationMs: 1000,
          targetTime: null,
          allowsOverrun: false,
          startedAt: 5,
          elapsedMs: 0,
        },
        {
          id: 't2',
          name: 'B',
          kind: 'countup',
          durationMs: 0,
          targetTime: null,
          allowsOverrun: false,
          startedAt: null,
          elapsedMs: 0,
        },
      ],
    };
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, show);
    expect(toRestore(files)).toMatchObject({
      slide: null,
      audio,
      props: [{ id: 'p' }],
      messages: [{ id: 'm' }],
      stageMessage: 'Placeholder stage',
      // Only timers that ran: t2 was never started.
      timers: [{ id: 't1', startedAt: 5, elapsedMs: 0 }],
    });
  });

  it('keeps the announcements ticker, with when it started, so it carries on in step', async () => {
    const state = live({ slideIndex: null, withBackground: false });
    const ticker = { items: [{ id: 'a1', text: 'Placeholder announcement' }], startedAt: 4321 };
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, { ...state, layers: { ...state.layers, ticker } });
    expect(toRestore(files)).toMatchObject({ slide: null, ticker });
    // Nothing else on the screens: the ticker alone is worth putting back.
    await saved(writer, { ...initialEngineState(), layers: { ...initialEngineState().layers, ticker } });
    expect(toRestore(files)?.ticker).toEqual(ticker);
  });

  it('leaves out the layers saved by another engine version', () => {
    writeFileSync(
      files.state,
      JSON.stringify({
        version: 1,
        session: 'other-version',
        engineVersion: ENGINE_STATE_VERSION - 1,
        savedAt: '2026-09-01T10:00:00.000Z',
        slide: { presentationId: 'p1', slideIndex: 1, arrangementId: null },
        background: null,
        blackout: false,
        audio: { id: 'a', title: '', mediaId: 'x', volume: 1, loop: false, startedAt: 1 },
        props: [{ id: 'p', name: '', elements: [] }],
        stageMessage: 'Kept?',
        timers: [{ id: 't', startedAt: 1, elapsedMs: 0 }],
      }),
    );
    expect(toRestore(files)).toMatchObject({
      slide: { slideIndex: 1 },
      audio: null,
      props: [],
      stageMessage: null,
      timers: [],
    });
  });

  it('reads files saved before playlists could be played', () => {
    writeFileSync(
      files.state,
      JSON.stringify({
        version: 1,
        session: 'old-run',
        engineVersion: 3,
        savedAt: '2026-09-01T10:00:00.000Z',
        slide: { presentationId: 'p1', slideIndex: 1, arrangementId: null },
        background: null,
        blackout: false,
      }),
    );
    expect(toRestore(files)).toMatchObject({ slide: { slideIndex: 1 }, playlist: null });
  });

  it('puts back what was live after an unexpected stop', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live({ blackout: true }));
    // No clean-quit mark: the run stopped unexpectedly.
    expect(toRestore(files)).toMatchObject({
      slide: { presentationId: 'p1', slideIndex: 2 },
      background,
      blackout: true,
    });
  });

  it('puts nothing back after a clean quit, even if a save lands after the mark', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live());
    writer.markClean();
    expect(toRestore(files)).toBeNull();
    // A save still in flight at quit rewrites the same run's state: the mark still covers it.
    writer.update(live({ blackout: true }));
    await pause(30);
    await writer.settle();
    expect(toRestore(files)).toBeNull();
    // A later run that stops unexpectedly is not covered by the earlier mark.
    const next = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(next, live({ slideIndex: 4 }));
    expect(toRestore(files)?.slide).toEqual({ presentationId: 'p1', slideIndex: 4, arrangementId: null });
  });

  it('writes a run of changes once, whole, and leaves no partial files', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 40 });
    for (let i = 0; i < 20; i++) writer.update(live({ slideIndex: i }));
    await pause(80);
    await writer.settle();
    expect(JSON.parse(readFileSync(files.state, 'utf8'))).toMatchObject({ slide: { slideIndex: 19 } });
    expect(readdirSync(dir)).toEqual(['live-state.json']);
  });

  it('has nothing to put back when nothing was live, or the files cannot be read', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live({ slideIndex: null, withBackground: false }));
    expect(toRestore(files)).toBeNull();
    writeFileSync(files.state, '{ not json');
    expect(toRestore(files)).toBeNull();
    writeFileSync(files.state, JSON.stringify({ version: 2 }));
    expect(toRestore(files)).toBeNull();
    rmSync(files.state);
    expect(toRestore(files)).toBeNull();
  });

  it('leaves out a background it cannot trust: another engine version, or not a background', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    await saved(writer, live());
    const raw = JSON.parse(readFileSync(files.state, 'utf8')) as Record<string, unknown>;
    writeFileSync(files.state, JSON.stringify({ ...raw, engineVersion: ENGINE_STATE_VERSION - 1 }));
    expect(toRestore(files)).toMatchObject({ slide: { slideIndex: 2 }, background: null });
    writeFileSync(files.state, JSON.stringify({ ...raw, background: { kind: 'media', mediaId: '../x' } }));
    expect(toRestore(files)?.background).toBeNull();
  });
});
