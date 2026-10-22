import { describe, expect, it } from 'vitest';
import { initialEngineState, type EngineState, type InputBackground } from '../../../shared/engine/state';
import { programPicture } from '../../../shared/program';

/*
 * A video input up as the background (Session 50), as the stream shows it: in the Slides layout the stream follows
 * the hall, the input with it; in the Camera layout the stream keeps its own camera (which may be the same input),
 * never the input in its place (Session 51: only a full-frame moment with a picture-in-picture box up draws it, as
 * part of the hall's picture: ./full-frame.test.ts).
 */

const input: InputBackground = {
  kind: 'input',
  inputId: 'i1',
  name: 'Placeholder input',
  device: 'fake_device_0',
  fit: 'fit',
  startedAt: 1,
};

const withInput = (): EngineState => {
  const state = initialEngineState();
  return { ...state, layers: { ...state.layers, background: input } };
};

describe('the stream’s picture with a video input up', () => {
  it('is the hall’s scene in the Slides layout', () => {
    expect(programPicture(withInput(), 'slides', null)).toEqual({ kind: 'scene' });
  });

  it('keeps the stream’s own camera in the Camera layout, never the input full frame', () => {
    expect(programPicture(withInput(), 'camera', null)).toEqual({
      kind: 'camera',
      lowerThird: [],
      full: null,
      props: false,
      messages: false,
    });
  });
});
