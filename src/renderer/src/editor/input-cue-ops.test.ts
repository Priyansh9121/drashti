import { describe, expect, it } from 'vitest';
import type { EditSlide } from '../../../shared/slide-edit';
import { cueInputName } from '../../../shared/slide-edit';
import { cueSettings, newSlide, setBackgroundCue } from './ops';

/*
 * The slide editor's background cue choosing a video input (Session 51): the cue keeps its kind and its id, has no
 * file, and holds only the input's own name in its settings; a picture or video chosen again holds none of it.
 */

describe('a video input as the slide’s background, in the slide editor', () => {
  it('takes the background cue’s place by name, and a picture chosen again takes it back', () => {
    const s: EditSlide = {
      ...newSlide(null),
      id: 's',
      cues: [
        { id: 'bg', kind: 'background', label: '', mediaId: 'pic', props: '{"media":"image","fit":"fit"}' },
        { id: 'k', kind: 'clear', label: 'Clear', mediaId: null, props: '{"action":"2"}' },
      ],
    };
    const withInput = setBackgroundCue(s, { input: 'Input 1' });
    expect(withInput.cues).toEqual([
      { id: 'bg', kind: 'background', label: '', mediaId: null, props: '{"input":"Input 1"}' },
      s.cues[1],
    ]);
    const [cue] = withInput.cues;
    if (!cue) throw new Error('no cue');
    expect(cueInputName(cue)).toBe('Input 1');
    // A picture again: its own settings, nothing of the input's.
    const back = setBackgroundCue(withInput, { id: 'pic', kind: 'image', fit: 'fill', loop: false });
    const [picture] = back.cues;
    if (!picture) throw new Error('no cue');
    expect(picture).toMatchObject({ id: 'bg', kind: 'background', mediaId: 'pic' });
    expect(cueSettings(picture)).toEqual({ media: 'image', fit: 'fill', loop: false });
    expect(cueInputName(picture)).toBeNull();
    // Another input, and none.
    expect(cueInputName(setBackgroundCue(withInput, { input: 'Input 2' }).cues[0] ?? cue)).toBe('Input 2');
    expect(setBackgroundCue(withInput, null).cues).toEqual([s.cues[1]]);
  });
});
