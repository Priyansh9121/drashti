import { describe, expect, it } from 'vitest';
import { initialEngineState, type EngineState } from '../../shared/engine/state';
import { PLAIN_VIDEO_EDIT, type VideoEditSnapshot } from '../../shared/video-edit';
import { prepareVideoEdits } from './video-edit-ready';

const pending: VideoEditSnapshot = {
  mediaId: 'video',
  revision: 1,
  recipe: { ...PLAIN_VIDEO_EDIT, speed: 2 },
  state: 'preparing',
  readyMediaId: null,
  message: null,
};
function showing(at: number): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      background: { kind: 'media', mediaId: 'video', media: 'video', fit: 'fit', loop: false, startedAt: at },
    },
  };
}

describe('video edit preparation at a show change', () => {
  it('refuses a new showing until the desired revision is ready; never substitutes the original', () => {
    const result = prepareVideoEdits(initialEngineState(), showing(1000), () => pending);
    expect(result.message).toContain('preparing');
    expect(result.state).toBeUndefined();
  });
  it('keeps an existing showing through Save and ordinary state changes', () => {
    const before = showing(1000);
    const after = { ...before, revision: 10 };
    expect(prepareVideoEdits(before, after, () => pending)).toEqual({ state: after });
  });
  it('restores the file of the saved showing rather than the library’s newer desired recipe', () => {
    const restored = showing(1000);
    expect(prepareVideoEdits(initialEngineState(), restored, () => pending, true)).toEqual({
      state: restored,
    });
  });
});
