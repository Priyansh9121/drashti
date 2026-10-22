import { describe, expect, it } from 'vitest';
import {
  initialEngineState,
  type EngineState,
  type InputBackground,
  type LowerThirdLayer,
  type PipLayer,
} from '../../../shared/engine/state';
import { NEW_LOWER_THIRD } from '../../../shared/lower-thirds';
import { programPicture } from '../../../shared/program';
import { FULL_FRAME_LAYERS, fullFrameState } from './full-frame';

/*
 * The Camera layout's full-frame moments (Session 51): the stream shows the hall's picture instead of the camera,
 * drawn by the hall's own Scene, so the picture-in-picture box shows with it. The props, the Lower Thirds panel's
 * lower third and the messages stay the Camera layout's own, over it; a video input never takes the camera's
 * place. Placeholder names only.
 */

const box: PipLayer = {
  source: { kind: 'media', mediaId: 'placeholder-box', media: 'image' },
  place: {
    corner: 'bottom-right',
    x: 0,
    y: 0,
    size: 'medium',
    border: true,
    rounded: true,
    motion: 'fade',
  },
  swapped: false,
  shownAt: 1,
};

const panelThird: LowerThirdLayer = {
  ...NEW_LOWER_THIRD,
  id: 'placeholder-third',
  lines: ['Placeholder name', '', ''],
  shownAt: 1,
};

const withBox = (over: Partial<EngineState['layers']> = {}): EngineState => {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      background: {
        kind: 'media',
        mediaId: 'placeholder-backdrop',
        media: 'image',
        fit: 'fill',
        loop: false,
        startedAt: 1,
      },
      pip: box,
      ...over,
    },
  };
};

describe('the stream’s Camera layout at full frame', () => {
  it('draws the hall’s background and slide with the picture-in-picture box, as the hall has it', () => {
    const state = withBox();
    // No slide up and a picture behind: the hall's picture instead of the camera.
    expect(programPicture(state, 'camera', null)).toMatchObject({ kind: 'camera', full: 'background' });
    const full = fullFrameState(state);
    expect(full.layers.pip).toBe(box);
    expect(full.layers.background).toBe(state.layers.background);
    expect(FULL_FRAME_LAYERS).toEqual(['background', 'slide', 'pip']);
  });

  it('leaves the Camera layout’s own lower third to it, and a video input to the stream’s camera', () => {
    const state: EngineState = {
      ...withBox({ lowerThird: panelThird }),
      lowerThirdOff: { layer: panelThird, at: 5 },
    };
    const full = fullFrameState(state);
    expect(full.layers.lowerThird).toBeNull();
    expect(full.lowerThirdOff).toBeNull();
    expect(full.layers.pip).toBe(box);
    const input: InputBackground = {
      kind: 'input',
      inputId: 'i1',
      name: 'Placeholder input',
      device: 'fake_device_0',
      fit: 'fit',
      startedAt: 1,
    };
    expect(fullFrameState(withBox({ background: input })).layers.background).toBeNull();
  });
});
