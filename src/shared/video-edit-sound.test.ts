import { expect, it } from 'vitest';
import { soundForEditedVideo } from './video-edit-sound';

it('does not mute an alternate audio track using the source first track’s silence flag', () => {
  expect(soundForEditedVideo({ gain: 1.2, silent: true }, { audioTrack: 1 })).toEqual({
    gain: 1.2,
    silent: false,
  });
});
it('keeps source gain and default-track silence, and leaves unknown measurements unknown', () => {
  const sound = { gain: 0.8, silent: true };
  expect(soundForEditedVideo(sound, { audioTrack: null })).toEqual(sound);
  expect(soundForEditedVideo(sound, { audioTrack: 0 })).toEqual(sound);
  expect(soundForEditedVideo(null, { audioTrack: 2 })).toBeNull();
});
