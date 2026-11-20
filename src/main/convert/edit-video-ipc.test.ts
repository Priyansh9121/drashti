import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerEditVideoIpc } from './edit-video-ipc';
import { PLAIN_VIDEO_EDIT, type VideoEditSnapshot } from '../../shared/video-edit';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn),
}));
beforeEach(() => handlers.clear());

function fixture() {
  let operator = true;
  let available = true;
  let failingWrite = false;
  const edit: VideoEditSnapshot = {
    mediaId: 'video',
    revision: 0,
    recipe: PLAIN_VIDEO_EDIT,
    state: 'ready',
    readyMediaId: 'video',
    message: null,
  };
  const save = vi.fn(() => ({ ok: true as const, edit: { ...edit, revision: 1 } }));
  const changed = vi.fn();
  registerEditVideoIpc({
    fromOperator: () => operator,
    available: () => available,
    repo: { sourceId: (id) => id, read: () => edit, save },
    changed,
    write: (guard, run) => {
      if (failingWrite || !guard.allowed()) return Promise.reject(new Error('Library unavailable.'));
      return Promise.resolve(run());
    },
  });
  return {
    save,
    changed,
    request: { mediaId: 'video', revision: 0, recipe: PLAIN_VIDEO_EDIT },
    call: (name: string, ...args: unknown[]) => handlers.get(`media:${name}`)?.({}, ...args),
    revoke: () => {
      operator = false;
    },
    missing: () => {
      available = false;
    },
    fail: () => {
      failingWrite = true;
    },
  };
}

describe('Edit Video operator boundary', () => {
  it('refuses other pages, arbitrary paths, unknown fields and missing files before any write', async () => {
    const f = fixture();
    expect(await f.call('set-video-edit', { ...f.request, path: '/placeholder/file' })).toMatchObject({
      ok: false,
    });
    expect(await f.call('video-edit', '../video')).toMatchObject({ ok: false });
    f.missing();
    expect(await f.call('set-video-edit', f.request)).toMatchObject({ ok: false });
    f.revoke();
    expect(await f.call('video-edit', 'video')).toMatchObject({ ok: false });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
  });
  it('publishes a stored revision only after the guarded write succeeds', async () => {
    const f = fixture();
    expect(await f.call('set-video-edit', f.request)).toMatchObject({ ok: true, edit: { revision: 1 } });
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.changed).toHaveBeenCalledTimes(1);
  });
  it('a busy or failed library reports failure and never announces Saved', async () => {
    const f = fixture();
    f.fail();
    const result = await f.call('set-video-edit', f.request);
    expect(result).toMatchObject({ ok: false });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
  });
});
