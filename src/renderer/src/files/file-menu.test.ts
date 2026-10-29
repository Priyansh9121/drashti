import { describe, expect, it } from 'vitest';
import { addFileMenuItems, type FileTarget, fileMenuEntries, revealLabel } from './file-menu';

/*
 * The one right-click menu (Session 55, Part 14): every file, folder, video, sound and picture gets the same menu,
 * in one order everywhere (what fits only there, Edit, Trim, a later Part's items, Rename, Show in Finder or
 * Explorer, and Delete last, apart), and later Parts add their items to it (Part 5's Save picture…, Part 6's When it
 * ends), never a second menu. Placeholder names only.
 */

const noop = () => undefined;

const video: FileTarget = {
  kind: 'video',
  name: 'Placeholder clip.mp4',
  place: 'playlist',
  mediaId: 'm1',
  playlistId: 'p1',
  itemId: 'i1',
  first: [{ label: 'Timers when it goes up…', onSelect: noop }],
  trim: noop,
  rename: noop,
  reveal: noop,
  remove: { label: 'Remove from playlist', run: noop },
};

const labels = (target: FileTarget, platform = 'darwin') =>
  fileMenuEntries(target, platform).map((e) => `${e.separatorBefore === true ? '— ' : ''}${e.label}`);

describe('the one right-click menu', () => {
  it('holds what fits, in one order: the place’s own, Trim, Rename, Show in Finder, and Delete last, apart', () => {
    expect(labels(video)).toEqual([
      'Timers when it goes up…',
      '— Trim (start, end and markers)…',
      '— Rename…',
      'Show in Finder',
      '— Remove from playlist',
    ]);
  });

  it('says Show in Explorer on Windows', () => {
    expect(revealLabel('win32')).toBe('Show in Explorer');
    expect(revealLabel('darwin')).toBe('Show in Finder');
    expect(labels(video, 'win32')).toContain('Show in Explorer');
  });

  it('offers Edit as fits: the Picture editor for a picture, Edit slides for a presentation; Delete always last', () => {
    const picture: FileTarget = {
      kind: 'picture',
      name: 'Placeholder backdrop.png',
      place: 'media',
      mediaId: 'm2',
      edit: { label: 'Picture editor…', run: noop },
      rename: noop,
      reveal: noop,
      remove: { label: 'Delete…', run: noop },
    };
    expect(labels(picture)).toEqual(['Picture editor…', '— Rename…', 'Show in Finder', '— Delete…']);
    const deck: FileTarget = {
      kind: 'deck',
      name: 'Placeholder katha',
      place: 'library',
      presentationId: 'p2',
      edit: { label: 'Edit slides…', run: noop },
      remove: { label: 'Delete…', run: noop },
    };
    expect(labels(deck)).toEqual(['Edit slides…', '— Delete…']);
    // A folder playlist's folder: Delete alone.
    expect(
      labels({
        kind: 'folder',
        name: 'Placeholder week',
        place: 'playlist',
        remove: { label: 'Remove…', run: noop },
      }),
    ).toEqual(['Remove…']);
  });

  it('takes a later Part’s items (Save picture…, When it ends) for what they fit, in one place, and lets them go', () => {
    const off = addFileMenuItems((t) =>
      t.kind === 'video' && t.place === 'playlist' ? [{ label: 'When it ends', onSelect: noop }] : [],
    );
    const off2 = addFileMenuItems((t) =>
      t.mediaId !== undefined && t.kind !== 'video' ? [{ label: 'Save picture…', onSelect: noop }] : [],
    );
    expect(labels(video)).toEqual([
      'Timers when it goes up…',
      '— Trim (start, end and markers)…',
      'When it ends',
      '— Rename…',
      'Show in Finder',
      '— Remove from playlist',
    ]);
    const pictureRow: FileTarget = {
      kind: 'picture',
      name: 'Placeholder backdrop.png',
      place: 'playlist',
      mediaId: 'm3',
      remove: { label: 'Remove from playlist', run: noop },
    };
    expect(labels(pictureRow)).toEqual(['Save picture…', '— Remove from playlist']);
    off();
    off2();
    expect(labels(video)).not.toContain('When it ends');
  });
});
