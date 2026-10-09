import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState } from '../../shared/engine/state';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { textSlide } from '../engine/testing';
import type { RecoveryFiles } from './live-state';
import { RECOVERY_MAX_AGE_MS } from '../../shared/recovery';
import { LiveStateWriter, savedFrom, startupRecovery, toRestore } from './live-state';

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
      // 2 since Session 20 (saved from the run's start); 1 is still read.
      version: 2,
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
      masks: null,
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
    // Five minutes after it was saved (the time is the test's own, not the real clock).
    expect(toRestore(files, null, new Date('2026-09-01T10:05:00.000Z'))).toMatchObject({
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
    expect(toRestore(files, null, new Date('2026-09-01T10:05:00.000Z'))).toMatchObject({
      slide: { slideIndex: 1 },
      playlist: null,
    });
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

/*
 * Session 20: how the last run ended, in each order of events, with the time injected. Every run saves the
 * show from its start (start), and a clean quit saves it once more before its mark, so the saved file always
 * names the last run. Before, a run that changed nothing saved nothing: after a clean quit, such a run made
 * the next start put the show of the run before it back, as after a crash (seen on 9 Oct 2026).
 */
describe('how the last run ended', () => {
  const HOUR = 60 * 60 * 1000;
  // A clock of the tests' own: never compared with the real one.
  let clock = 0;
  const now = () => new Date(clock);
  const nothingLive = initialEngineState();
  const startFinds = () => startupRecovery(files, { now: now() });
  const clean = { cleanQuit: true, putBack: null, tooOld: null };
  /** A run of Drashti: it starts (saving the show it starts with), and the tests change, quit or stop it. */
  async function begin(state: EngineState = nothingLive) {
    const writer = new LiveStateWriter(files, { throttleMs: 10, now });
    writer.start(state);
    await pause(30);
    await writer.settle();
    return writer;
  }
  beforeEach(() => {
    clock = new Date(2026, 9, 9, 18, 0).getTime();
  });

  it('a clean quit, then a start that changes nothing and quits, then a start: nothing comes back (the 9 Oct order)', async () => {
    const first = await begin();
    await saved(first, live({ blackout: true }));
    first.markClean();
    clock += 2 * 60_000;
    expect(startFinds()).toEqual(clean);
    const second = await begin();
    clock += 90_000;
    second.markClean();
    expect(startFinds()).toEqual(clean);
  });

  it('a crash, then a start: the show comes back', async () => {
    const first = await begin();
    await saved(first, live({ blackout: true }));
    first.stop();
    clock += 30_000;
    const found = startFinds();
    expect(found.cleanQuit).toBe(false);
    expect(found.tooOld).toBeNull();
    expect(found.putBack).toMatchObject({
      slide: { presentationId: 'p1', slideIndex: 2 },
      background,
      blackout: true,
    });
  });

  it('a clean quit, then a start that changes nothing and crashes, then a start: nothing comes back', async () => {
    const first = await begin();
    await saved(first, live());
    first.markClean();
    clock += 60_000;
    const second = await begin();
    second.stop();
    clock += 60_000;
    // That run stopped unexpectedly (so Drashti comes back in the mode it was in), with nothing live.
    expect(startFinds()).toEqual({ cleanQuit: false, putBack: null, tooOld: null });
  });

  it('a crash, a start that puts the show back and quits cleanly, then a start: nothing comes back', async () => {
    const first = await begin();
    await saved(first, live({ blackout: true }));
    first.stop();
    clock += 60_000;
    expect(startFinds().putBack).not.toBeNull();
    // The second run starts with the show put back, and quits on purpose.
    const second = await begin(live({ blackout: true }));
    clock += 60_000;
    second.markClean();
    expect(startFinds()).toEqual(clean);
  });

  it('a show saved 3 hours or more before the start is named, not put back; just under, it comes back', async () => {
    const first = await begin();
    await saved(first, live({ blackout: true }));
    first.stop();
    const savedAt = clock;
    expect(
      startupRecovery(files, { now: new Date(savedAt + RECOVERY_MAX_AGE_MS - 1) }).putBack,
    ).toMatchObject({
      blackout: true,
    });
    const late = startupRecovery(files, { now: new Date(savedAt + RECOVERY_MAX_AGE_MS) });
    expect(late.cleanQuit).toBe(false);
    expect(late.putBack).toBeNull();
    expect(late.tooOld).toMatchObject({
      slide: { slideIndex: 2 },
      blackout: true,
      savedAt: new Date(savedAt).toISOString(),
    });
    expect(RECOVERY_MAX_AGE_MS).toBe(3 * HOUR);
  });

  it('saves the show again every minute while it runs, so a slide up for hours still comes back after a crash', async () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10, aliveMs: 20, now });
    writer.start(live());
    await pause(40);
    // Four hours on the same slide, then a crash.
    clock += 4 * HOUR;
    await pause(60);
    writer.stop();
    await writer.settle();
    expect(JSON.parse(readFileSync(files.state, 'utf8'))).toMatchObject({ savedAt: now().toISOString() });
    clock += 5 * 60_000;
    expect(startFinds().putBack).toMatchObject({ slide: { slideIndex: 2 } });
  });

  it('a clean quit saves the show as it is, under this run, before its mark: even straight after the start', () => {
    const writer = new LiveStateWriter(files, { throttleMs: 10, now });
    // Quit before the start's own save has landed (it waits 10 ms): the quit saves it.
    writer.start(live());
    writer.markClean();
    const savedNow = JSON.parse(readFileSync(files.state, 'utf8')) as { session: string; version: number };
    const mark = JSON.parse(readFileSync(files.cleanMark, 'utf8')) as { session: string };
    expect(savedNow).toMatchObject({ version: 2, session: writer.session });
    expect(mark.session).toBe(writer.session);
    expect(readdirSync(dir).sort()).toEqual(['live-state.clean', 'live-state.json']);
  });

  it('cannot put back a show whose time it cannot read', async () => {
    const first = await begin();
    await saved(first, live());
    first.stop();
    const raw = JSON.parse(readFileSync(files.state, 'utf8')) as Record<string, unknown>;
    writeFileSync(files.state, JSON.stringify({ ...raw, savedAt: 'not a time' }));
    expect(startFinds()).toMatchObject({
      cleanQuit: false,
      putBack: null,
      tooOld: { slide: { slideIndex: 2 } },
    });
  });

  describe('with files saved before Session 20', () => {
    /** A show saved by that Drashti (version 1), and a clean-quit mark written `markAfterMs` after it. */
    function oldFiles(markSession: string, markAfterMs: number) {
      const show = { ...savedFrom(live({ blackout: true }), 'run-1', now()), version: 1 };
      writeFileSync(files.state, JSON.stringify(show));
      writeFileSync(files.cleanMark, JSON.stringify({ session: markSession }));
      const markAt = (clock + markAfterMs) / 1000;
      utimesSync(files.cleanMark, markAt, markAt);
    }

    it('a clean quit, then a run that changed nothing and quit (the files on the dev Mac): a clean start, nothing comes back', () => {
      oldFiles('run-2', 90_000);
      clock += 60 * 60_000;
      expect(startFinds()).toEqual(clean);
    });

    it('a crash after a clean quit before it: the show comes back, as it always did', () => {
      oldFiles('run-0', -60 * 60_000);
      clock += 60_000;
      expect(startFinds()).toMatchObject({
        cleanQuit: false,
        putBack: { blackout: true, slide: { slideIndex: 2 } },
      });
    });

    it('the run that saved it quit cleanly: a clean start', () => {
      oldFiles('run-1', 1000);
      expect(startFinds()).toEqual(clean);
    });
  });
});
