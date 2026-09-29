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
    live: { presentationId: 'p1', slideIndex: 2, slideCount: 5, arrangementId: null },
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
      background,
      blackout: true,
    });
    expect(savedFrom(live({ slideIndex: null }), 'run-1').slide).toBeNull();
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
