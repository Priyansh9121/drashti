import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionReview } from '../../shared/caption-coordinator';
import { IPC } from '../../shared/ipc';
import { SIMPLE_MODE_LOCKED } from '../simple-mode';
import { registerCaptionPrototypeIpc } from './caption-prototype-ipc';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn),
}));
beforeEach(() => handlers.clear());
function setup(allowed = true) {
  const view: CaptionReview = {
    on: true,
    version: 1,
    canCorrect: false,
    sessionId: 'session',
    current: null,
    previous: null,
    busy: false,
    omitted: 0,
  };
  const captions = {
    prototypeView: vi.fn(() => view),
    setPrototypeOn: vi.fn(),
    advancePrototype: vi.fn(),
    restartPrototype: vi.fn(),
    correctPrototype: vi.fn(() => true),
    dismissPrototype: vi.fn(() => true),
  };
  registerCaptionPrototypeIpc({ fromOperator: () => allowed, captions });
  return {
    captions,
    view,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args),
  };
}
const key = { sessionId: 'session', phraseId: 's1', revision: 1 };

describe('private prototype correction bridge', () => {
  it('returns review words only to the operator and refuses every action from another page', () => {
    const { call, captions } = setup(false);
    expect(call(IPC.captions.prototypeView)).toBeNull();
    expect(call(IPC.captions.setPrototypeOn, true)).toBeNull();
    expect(call(IPC.captions.advancePrototype)).toBeNull();
    expect(call(IPC.captions.restartPrototype)).toBeNull();
    expect(call(IPC.captions.correctPrototype, { ...key, text: 'Placeholder' })).toBe(false);
    expect(call(IPC.captions.dismissPrototype, key)).toBe(false);
    for (const fn of Object.values(captions)) expect(fn).not.toHaveBeenCalled();
  });
  it('validates correction envelopes and rejects oversized or malformed data before calling the service', () => {
    const { call, captions, view } = setup();
    expect(call(IPC.captions.prototypeView)).toBe(view);
    for (const wrong of [
      null,
      {},
      { ...key, revision: -1, text: 'Placeholder' },
      { ...key, text: 'x'.repeat(4_097) },
      { ...key, text: '\u0000bad' },
      { ...key, text: '\u0085bad' },
      { ...key, text: '\ud800' },
    ])
      expect(call(IPC.captions.correctPrototype, wrong)).toBe(false);
    expect(captions.correctPrototype).not.toHaveBeenCalled();
    expect(call(IPC.captions.correctPrototype, { ...key, text: 'Placeholder' })).toBe(true);
    expect(captions.correctPrototype).toHaveBeenCalledWith({ ...key, text: 'Placeholder' });
    expect(call(IPC.captions.dismissPrototype, key)).toBe(true);
    expect(call(IPC.captions.setPrototypeOn, 'yes')).toBeNull();
    expect(captions.setPrototypeOn).not.toHaveBeenCalled();
    expect(call(IPC.captions.setPrototypeOn, true)).toBe(view);
    expect(captions.setPrototypeOn).toHaveBeenCalledWith(true);
    expect(call(IPC.captions.advancePrototype)).toBe(view);
    expect(call(IPC.captions.restartPrototype)).toBe(view);
    expect(captions.advancePrototype).toHaveBeenCalledTimes(1);
    expect(captions.restartPrototype).toHaveBeenCalledTimes(1);
  });
  it('locks every prototype request in Simple Mode', () => {
    for (const channel of [
      IPC.captions.prototypeView,
      IPC.captions.setPrototypeOn,
      IPC.captions.advancePrototype,
      IPC.captions.restartPrototype,
      IPC.captions.correctPrototype,
      IPC.captions.dismissPrototype,
    ])
      expect(SIMPLE_MODE_LOCKED).toContain(channel);
  });
});
