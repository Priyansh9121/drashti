import { describe, expect, it } from 'vitest';
import {
  initialEngineState,
  type EngineState,
  type InputBackground,
  type LowerThirdLayer,
  type PipLayer,
  type PropItem,
} from '../../../shared/engine/state';
import { NEW_LOWER_THIRD } from '../../../shared/lower-thirds';
import { programPicture } from '../../../shared/program';
import { FULL_FRAME_LAYERS, fullFrameState } from './full-frame';

/*
 * The Camera layout's full-frame moments (Session 51): the stream shows the hall's picture instead of the camera,
 * drawn by the hall's own Scene, so the picture-in-picture box shows with it, over the props. The Lower Thirds
 * panel's lower third and the messages stay the Camera layout's own, over it; a video input behind is the hall's
 * picture only while a box is up, and never takes the camera's place otherwise. Placeholder names only.
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

const input: InputBackground = {
  kind: 'input',
  inputId: 'i1',
  name: 'Placeholder input',
  device: 'fake_device_0',
  fit: 'fit',
  startedAt: 1,
};

describe('the stream’s Camera layout at full frame', () => {
  it('draws the hall’s background, slide and props with the picture-in-picture box over them, as the hall has it', () => {
    const prop: PropItem = { id: 'placeholder-prop', name: 'Placeholder prop', elements: [], shownAt: 1 };
    const state = withBox({ props: [prop] });
    // No slide up and a picture behind: the hall's picture instead of the camera.
    expect(programPicture(state, 'camera', null)).toMatchObject({ kind: 'camera', full: 'background' });
    const full = fullFrameState(state);
    expect(full.layers.pip).toBe(box);
    expect(full.layers.background).toBe(state.layers.background);
    // The props in it, under the box as on the hall's screens (the Camera layout draws its own only over the
    // camera).
    expect(full.layers.props).toBe(state.layers.props);
    expect(FULL_FRAME_LAYERS).toEqual(['background', 'slide', 'props', 'pip']);
  });

  it('leaves the Camera layout’s own lower third to it', () => {
    const state: EngineState = {
      ...withBox({ lowerThird: panelThird }),
      lowerThirdOff: { layer: panelThird, at: 5 },
    };
    const full = fullFrameState(state);
    expect(full.layers.lowerThird).toBeNull();
    expect(full.lowerThirdOff).toBeNull();
    expect(full.layers.pip).toBe(box);
  });

  it('keeps a video input behind while a box is up, as the hall has it; with none, the stream’s camera stands for it', () => {
    // A box up: the input is the hall's picture (a box of the slides over it keeps it as the main picture;
    // swapped, the box shows it).
    expect(fullFrameState(withBox({ background: input })).layers.background).toBe(input);
    const slides: PipLayer = { ...box, source: { kind: 'slides' } };
    expect(fullFrameState(withBox({ background: input, pip: slides })).layers.background).toBe(input);
    // No box: a picture slide full frame over black, as before, never the input in the camera's place.
    expect(fullFrameState(withBox({ background: input, pip: null })).layers.background).toBeNull();
  });
});
