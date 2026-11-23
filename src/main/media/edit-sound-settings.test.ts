import { expect, it, vi } from 'vitest';
import { editedSoundSettings } from './edit-sound-settings';

it('reads and changes loudness on the library source when a prepared copy is selected', () => {
  const sound = { even: false, loudness: null, gain: 1, silent: false };
  const repo = { soundOf: vi.fn(() => sound), setEven: vi.fn(() => true) };
  const settings = editedSoundSettings(repo, (id) => (id === 'copy' ? 'source' : id));
  expect(settings.read('copy')).toEqual(sound);
  expect(repo.soundOf).toHaveBeenCalledWith('source');
  expect(settings.set('copy', false)).toEqual({ sourceId: 'source', ok: true });
  expect(repo.setEven).toHaveBeenCalledWith('source', false);
});
