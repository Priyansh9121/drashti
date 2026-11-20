import { expect, it, vi } from 'vitest';
import { initialEngineState, type EngineState } from '../../shared/engine/state';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import { prepareVideoProxies } from './proxy-showing';
function showing(at = 1000): EngineState {
  const s = initialEngineState();
  return {
    ...s,
    layers: {
      ...s.layers,
      background: {
        kind: 'media',
        mediaId: 'source',
        media: 'video',
        fit: 'fit',
        loop: false,
        startedAt: at,
        clip: { startMs: 350, endMs: 1750 },
        marks: [{ id: 'own', name: 'Placeholder', atMs: 800 }],
        seek: { toMs: 600, at: 1100 },
      },
    },
  };
}
it('pins the ready smaller file only for a new showing and keeps its exact trim, seek and markers', () => {
  const next = showing();
  const result = prepareVideoProxies(initialEngineState(), next, () => ({ mediaId: 'proxy', message: null }));
  expect(result.state?.layers.background).toEqual({ ...next.layers.background, mediaId: 'proxy' });
  expect(next.layers.background).toMatchObject({ mediaId: 'source' });
});
it('refuses a new showing whose required copy is not ready', () => {
  const result = prepareVideoProxies(initialEngineState(), showing(), () => ({
    mediaId: null,
    message: 'Placeholder copy is preparing. Wait until ready.',
  }));
  expect(result.state).toBeUndefined();
  expect(result.message).toContain('preparing');
});
it('keeps current and restored showings unchanged through later copy readiness', () => {
  const before = showing();
  const after = { ...before, blackout: !before.blackout };
  const ready = vi.fn(() => ({ mediaId: 'new-proxy', message: null }));
  expect(prepareVideoProxies(before, after, ready)).toEqual({ state: after });
  expect(prepareVideoProxies(initialEngineState(), before, ready, true)).toEqual({ state: before });
  expect(ready).not.toHaveBeenCalled();
});
it('does not change an existing background when the same source is newly put in the box', () => {
  const before = showing();
  const next: EngineState = {
    ...before,
    layers: {
      ...before.layers,
      pip: {
        source: { kind: 'media', mediaId: 'source', media: 'video' },
        shownAt: 2000,
        place: DEFAULT_PIP_PLACE,
        swapped: false,
      },
    },
  };
  const result = prepareVideoProxies(before, next, () => ({ mediaId: 'proxy', message: null }));
  expect(result.state?.layers.background).toEqual(before.layers.background);
  expect(result.state?.layers.pip?.source).toMatchObject({ mediaId: 'proxy' });
});
