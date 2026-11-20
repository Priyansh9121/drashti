import { describe, expect, it } from 'vitest';
import { editVideoItems } from './edit-video';
import type { FileTarget } from '../files/file-menu';

describe('Edit Video in the shared file menu', () => {
  it('opens only a ready local video and keeps its library identity', () => {
    const target: FileTarget = { kind: 'video', place: 'media', mediaId: 'video', name: 'Placeholder.mp4' };
    let opened: unknown = null;
    const items = editVideoItems(
      target,
      () => true,
      (file) => {
        opened = file;
      },
    );
    expect(items.map((i) => i.label)).toEqual(['Edit Video…']);
    items[0]?.onSelect();
    expect(opened).toEqual({ id: 'video', name: 'Placeholder.mp4' });
    expect(editVideoItems(target, () => false)).toEqual([]);
    expect(editVideoItems({ ...target, kind: 'picture' }, () => true)).toEqual([]);
    expect(editVideoItems({ ...target, mediaId: undefined }, () => true)).toEqual([]);
  });
});
