import { expect, it } from 'vitest';
import { audioOnlyTracks } from './audio-only-tracks';

it('disables a sound-only file’s video track while preserving its sound track', () => {
  const videoTracks = [{ selected: true }, { selected: false }];
  const audioTracks = [{ enabled: true }];
  const element = { tagName: 'AUDIO', videoTracks, audioTracks } as unknown as HTMLMediaElement;
  expect(audioOnlyTracks(element)).toBe(true);
  expect(videoTracks.every((track) => !track.selected)).toBe(true);
  expect(audioTracks[0]?.enabled).toBe(true);
});

it('leaves an actual picture player’s selected video track alone', () => {
  const videoTracks = [{ selected: true }];
  const element = { tagName: 'VIDEO', videoTracks } as unknown as HTMLMediaElement;
  expect(audioOnlyTracks(element)).toBe(true);
  expect(videoTracks[0]?.selected).toBe(true);
});

it('reports when track selection is unavailable instead of claiming the decoding cost is removed', () => {
  expect(audioOnlyTracks({ tagName: 'AUDIO' } as HTMLMediaElement)).toBe(false);
});
