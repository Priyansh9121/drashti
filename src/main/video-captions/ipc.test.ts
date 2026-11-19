import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerVideoCaptionIpc } from './ipc';
import type { VideoCaptionChoice, VideoCaptionTrack } from '../../shared/video-captions';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn),
}));
beforeEach(() => handlers.clear());
const TRACK: VideoCaptionTrack = {
  id: 'en-file',
  language: 'en',
  automatic: false,
  name: 'Sample.en.srt',
  cues: [{ startMs: 0, endMs: 1000, text: 'Placeholder words' }],
};

function setup() {
  let allowed = true;
  const view: VideoCaptionChoice = {
    tracks: [{ id: TRACK.id, language: 'en', automatic: false, name: TRACK.name }],
    selected: null,
  };
  const selected = vi.fn((_id: string, choice: string | null) => {
    if (choice !== null && choice !== TRACK.id) return false;
    view.selected = choice;
    return true;
  });
  const put = vi.fn(() => true);
  const pick = vi.fn(async () => '/placeholder/Sample.en.srt' as string | null);
  const read = vi.fn(async () => ({
    track: TRACK as VideoCaptionTrack | null,
    problem: null as string | null,
  }));
  const changed = vi.fn();
  registerVideoCaptionIpc({
    fromOperator: () => allowed,
    repo: { view: () => view, select: selected, put },
    pick,
    reader: { read },
    changed,
    write: async (_guard, run) => run(),
  });
  return {
    call: (name: string, ...args: unknown[]) => handlers.get(`video-captions:${name}`)?.({}, ...args),
    selected,
    put,
    pick,
    read,
    changed,
    revoke: () => {
      allowed = false;
    },
  };
}

describe('operator video caption requests', () => {
  it('rejects other pages, invalid media ids and unknown tracks before changing a show', async () => {
    const t = setup();
    expect(await t.call('select', '../video', TRACK.id)).toMatchObject({ ok: false });
    expect(t.selected).not.toHaveBeenCalled();
    expect(await t.call('select', 'video', 'missing')).toMatchObject({ ok: false });
    expect(t.changed).not.toHaveBeenCalled();
    t.revoke();
    expect(await t.call('add', 'video')).toMatchObject({ ok: false });
    expect(t.pick).not.toHaveBeenCalled();
  });
  it('turns a stored track on and off and tells the engine immediately', async () => {
    const t = setup();
    expect(await t.call('select', 'video', TRACK.id)).toMatchObject({
      ok: true,
      view: { selected: TRACK.id },
    });
    expect(await t.call('select', 'video', null)).toMatchObject({ ok: true, view: { selected: null } });
    expect(t.changed).toHaveBeenCalledTimes(2);
  });
  it('adds only the native chosen file in the background and reports damaged captions without changing the selected track', async () => {
    const t = setup();
    t.read.mockResolvedValueOnce({ track: TRACK, problem: 'Some damaged captions were left out.' });
    expect(await t.call('add', 'video')).toMatchObject({
      ok: true,
      notice: 'Some damaged captions were left out.',
    });
    expect(t.read).toHaveBeenCalledWith('/placeholder/Sample.en.srt');
    expect(t.put).toHaveBeenCalledWith('video', [TRACK]);
    expect(t.selected).not.toHaveBeenCalled();
  });
  it('cancels and rechecks permission after file selection and reading', async () => {
    const t = setup();
    t.pick.mockResolvedValueOnce(null);
    expect(await t.call('add', 'video')).toMatchObject({ ok: true });
    expect(t.read).not.toHaveBeenCalled();
    t.read.mockImplementationOnce(async () => {
      t.revoke();
      return { track: TRACK, problem: null };
    });
    expect(await t.call('add', 'video')).toMatchObject({ ok: false });
    expect(t.put).not.toHaveBeenCalled();
  });
});
