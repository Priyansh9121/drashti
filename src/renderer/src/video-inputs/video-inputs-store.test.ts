import { describe, expect, it } from 'vitest';
import type { VideoInput, VideoInputsView } from '../../../shared/video-inputs';
import { connectVideoInputs, useVideoInputs } from './video-inputs-store';
import { inputOfName } from './words';

/*
 * The operator window's list of this computer's video inputs (Session 51): not read until the main process has
 * said, so a playlist item's or a slide's input never reads as "not on this computer" for the moment the window
 * takes to open. The main process is stood in for by a fake; placeholder names only.
 */

describe('the operator window’s video inputs', () => {
  it('are not read until the main process has said; until then no input counts as missing', async () => {
    let answer: (view: VideoInputsView) => void = () => undefined;
    const listed = new Promise<VideoInputsView>((resolve) => {
      answer = resolve;
    });
    (globalThis as { window?: unknown }).window = {
      drashti: {
        videoInputs: {
          onChanged: () => undefined,
          onStatus: () => undefined,
          list: () => listed,
          status: () => new Promise(() => undefined),
        },
      },
    };
    expect(useVideoInputs.getState().inputs).toBeNull();
    connectVideoInputs();
    const named = (name: string) => inputOfName(useVideoInputs.getState().inputs, name);
    expect(named('Input 1')).toBe('unread');
    const one: VideoInput = { id: 'a', name: 'Input 1', device: 'Placeholder camera', fit: 'fit' };
    answer({ inputs: [one] });
    await expect.poll(() => useVideoInputs.getState().inputs).toEqual([one]);
    expect(named('Input 1')).toEqual(one);
    expect(named('Input 2')).toBeNull();
  });
});
