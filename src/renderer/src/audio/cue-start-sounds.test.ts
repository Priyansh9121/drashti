import { expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import { retainCueSounds } from './cue-start-sounds';
import { videoSoundGain, type Sound } from './sounds';

it('keeps outgoing slide sound through Go and fences incoming sound until that moment', () => {
  const state = initialEngineState();
  state.videoStart = { id: 'cue', at: 500, mediaIds: ['old', 'new'], soundIds: ['old', 'new'] };
  state.layers.background = {
    kind: 'media',
    media: 'video',
    mediaId: 'new',
    cueId: 'cue',
    fit: 'fit',
    loop: false,
    startedAt: 1,
    seek: { at: 500, toMs: 0 },
  };
  const incoming: Sound = { key: 'new', mediaId: 'new', kind: 'video', startedAt: 1, loop: false, volume: 1 };
  const outgoing: Sound = { ...incoming, key: 'old', mediaId: 'old', kind: 'audio' };
  const wanted = new Map([['new', incoming]]);
  expect(retainCueSounds(wanted, [outgoing], state, 400)).toBe(500);
  const old = wanted.get('old'),
    next = wanted.get('new');
  if (!old || !next) throw new Error('Both sounds must be retained until Go');
  expect(videoSoundGain(old, 400)).toBe(1);
  expect(videoSoundGain(old, 500)).toBe(0);
  expect(videoSoundGain(next, 400)).toBe(0);
  expect(videoSoundGain(next, 500)).toBe(1);
  expect(retainCueSounds(new Map(), [old], state, 500)).toBeNull();
});
