import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLAIN_VIDEO_EDIT, type VideoEditSnapshot } from '../../shared/video-edit';
import type { FitResult } from './convert-service';
import { EditService, type EditCopyOptions, type EditServiceDeps } from './edit-service';

let directory = '';
let service: EditService | null = null;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'drashti-edit-service-'));
});
afterEach(() => {
  service?.close();
  service = null;
  rmSync(directory, { recursive: true, force: true });
});
function setup() {
  const source = join(directory, 'Placeholder.mp4');
  writeFileSync(source, 'generated-placeholder');
  let snapshot: VideoEditSnapshot = {
    mediaId: 'source',
    revision: 1,
    recipe: { ...PLAIN_VIDEO_EDIT, speed: 2 },
    state: 'preparing',
    readyMediaId: null,
    message: null,
  };
  let resolve: (r: FitResult) => void = () => undefined;
  const done = new Promise<FitResult>((r) => {
    resolve = r;
  });
  const gates = { show: false, stream: false, recording: false };
  const repo = {
    read: vi.fn(() => snapshot),
    waiting: vi.fn(() =>
      snapshot.state === 'preparing'
        ? [{ mediaId: 'source', revision: snapshot.revision, recipe: snapshot.recipe }]
        : [],
    ),
    complete: vi.fn(() => {
      snapshot = { ...snapshot, state: 'ready', readyMediaId: 'immutable' };
      return true;
    }),
    failed: vi.fn(),
  };
  let options: EditCopyOptions | null = null;
  let calls = 0;
  const saveCopy = vi.fn<EditServiceDeps['conversions']['saveCopy']>((_s, _d, _i, copy) => {
    options = copy;
    calls++;
    return {
      id: calls === 1 ? 'job' : 'next-job',
      done: calls === 1 ? done : new Promise<FitResult>(() => undefined),
    };
  });
  const cancelFile = vi.fn(() => true);
  const register = vi.fn(() => Promise.resolve('immutable'));
  const deps: EditServiceDeps = {
    repo,
    mediaDir: directory,
    source: () => ({ path: source, name: 'Placeholder' }),
    idle: () => !Object.values(gates).some(Boolean),
    conversions: { saveCopy, cancelFile },
    register,
    changed: vi.fn(),
    write: (guard, run) => {
      if (!guard.allowed() || guard.signal.aborted) throw new Error('Stopped');
      return Promise.resolve(run());
    },
  };
  service = new EditService(deps);
  const queued = () => {
    if (!options) throw new Error('No copy queued');
    return options;
  };
  return {
    gates,
    repo,
    saveCopy,
    cancelFile,
    register,
    source,
    resolve,
    queued,
    setRevision: (revision: number) => {
      snapshot = { ...snapshot, revision };
    },
  };
}
describe('persisted edited copies share the idle worker', () => {
  it.each(['show', 'stream', 'recording'] as const)('does not probe or queue while %s is active', (gate) => {
    const t = setup();
    t.gates[gate] = true;
    service?.wake();
    expect(t.saveCopy).not.toHaveBeenCalled();
    t.gates[gate] = false;
    service?.wake();
    expect(t.saveCopy).toHaveBeenCalledTimes(1);
    expect(t.queued()).toMatchObject({ waitForPlaying: true, strictPriority: true });
    expect(t.queued()).not.toHaveProperty('waitForShow');
    service?.wake();
    service?.wake();
    expect(t.saveCopy).toHaveBeenCalledTimes(1);
  });
  it('checks and registers the prepared file before making the desired revision ready', async () => {
    const t = setup();
    service?.wake();
    const copy = t.queued();
    const info = {
      durationMs: 4000,
      video: { codec: 'h264', pixFmt: 'yuv420p', width: 64, height: 48, still: false },
      audio: null,
    };
    expect(copy.inspect(info)).toBeUndefined();
    expect(copy.lengthMs).toBe(2000);
    expect(copy.args('part')).toContain('libx264');
    expect(copy.validate({ ...info, durationMs: 2000 })).toBeUndefined();
    await copy.preparePublish('part', new AbortController().signal);
    expect(t.register).toHaveBeenCalledTimes(1);
    expect(t.repo.complete).not.toHaveBeenCalled();
    t.resolve({ ok: true, copy: null });
    await vi.waitFor(() => expect(t.repo.complete).toHaveBeenCalledWith('source', 1, 'immutable'));
    expect(readFileSync(t.source, 'utf8')).toBe('generated-placeholder');
  });
  it('cancels an older queued revision and refuses its late result', async () => {
    const t = setup();
    service?.wake();
    t.setRevision(2);
    service?.wake();
    expect(t.cancelFile).toHaveBeenCalledWith('job');
    t.resolve({ ok: false, stopped: true, message: 'Stopped' });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.repo.complete).not.toHaveBeenCalled();
    expect(t.repo.failed).not.toHaveBeenCalled();
  });
});
