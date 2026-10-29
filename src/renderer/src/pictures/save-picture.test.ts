import { describe, expect, it } from 'vitest';
import { addFileMenuItems, type FileTarget, fileMenuEntries } from '../files/file-menu';
import { savePictureItems } from './save-picture';

/* Save picture… (Session 55, Part 5) in the one right-click menu: on a picture and on a deck's slide, nowhere else. */

const noop = () => undefined;
const picture: FileTarget = {
  kind: 'picture',
  name: 'Placeholder darshan.jpg',
  place: 'media',
  mediaId: 'm1',
  edit: { label: 'Picture editor…', run: noop },
  rename: noop,
  reveal: noop,
  remove: { label: 'Delete…', run: noop },
};
const slide: FileTarget = { kind: 'slide', name: 'Placeholder deck_3', place: 'playlist', mediaId: 'p3' };

describe('Save picture… in the one right-click menu (Session 55, Part 5)', () => {
  it('is on a picture and on a slide with a picture, after Edit and before Rename; saving it by its name', () => {
    const saved: [string, string][] = [];
    const off = addFileMenuItems((t) => savePictureItems(t, (id, name) => saved.push([id, name])));
    const labels = (t: FileTarget) => fileMenuEntries(t, 'darwin').map((e) => e.label);
    expect(labels(picture)).toEqual([
      'Picture editor…',
      'Save picture…',
      'Rename…',
      'Show in Finder',
      'Delete…',
    ]);
    expect(labels(slide)).toEqual(['Save picture…']);
    // A slide of words (no picture), a video, a sound: none.
    expect(savePictureItems({ kind: 'slide', name: 'Placeholder_1', place: 'library' }, noop)).toEqual([]);
    for (const kind of ['video', 'sound', 'presentation', 'deck'] as const)
      expect(savePictureItems({ ...picture, kind }, noop), kind).toEqual([]);
    fileMenuEntries(slide, 'win32')
      .find((e) => e.label === 'Save picture…')
      ?.onSelect();
    expect(saved).toEqual([['p3', 'Placeholder deck_3']]);
    off();
    expect(labels(picture)).not.toContain('Save picture…');
  });
});
