import { expect, it, vi } from 'vitest';
import { PLAIN_VIDEO_EDIT } from '../../shared/video-edit';
import { editedPlayHistory } from './edit-play-history';

function fixture() {
  const recipe = { ...PLAIN_VIDEO_EDIT, trim: { startMs: 1000, endMs: 9000 }, speed: 2 };
  const media = {
    countPlay: vi.fn(),
    keepResume: vi.fn(),
    forgetResume: vi.fn(),
    resumeOf: vi.fn(() => ({ atMs: 5000, at: 'placeholder-time' })),
  };
  const edits = {
    sourceId: (id: string) => (id === 'copy' ? 'source' : id),
    renditionOf: (id: string) => (id === 'copy' ? { sourceId: 'source', revision: 1, recipe } : null),
  };
  return { media, history: editedPlayHistory(media, edits) };
}
it('counts and stores resume against the library source, using the immutable copy’s source times', () => {
  const { media, history } = fixture();
  history.countPlay('copy', 'placeholder-time');
  history.keepResume('copy', 2000, 'placeholder-time');
  history.forgetResume('copy');
  expect(media.countPlay).toHaveBeenCalledWith('source', 'placeholder-time');
  expect(media.keepResume).toHaveBeenCalledWith('source', 5000, 'placeholder-time');
  expect(media.forgetResume).toHaveBeenCalledWith('source');
});
it('offers the source resume at the corresponding prepared time, without changing the stored point', () => {
  const { media, history } = fixture();
  expect(history.resumeOf('copy')).toEqual({ atMs: 2000, at: 'placeholder-time' });
  expect(history.resumeOf('source')).toEqual({ atMs: 5000, at: 'placeholder-time' });
  expect(media.resumeOf).toHaveBeenCalledWith('source');
  media.resumeOf.mockReturnValue({ atMs: 9500, at: 'placeholder-time' });
  expect(history.resumeOf('copy')).toBeNull();
});
