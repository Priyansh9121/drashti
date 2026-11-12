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
  it.each([
    ['video', 'media'],
    ['sound', 'media'],
    ['sound', 'playlist'],
    ['sound', 'music'],
  ] as const)('labels the %s action in %s as setting points for the whole file', (kind, place) => {
    expect(labels({ kind, place, name: 'Placeholder clip', trim: noop })).toEqual([
      'Start, end and markers…',
    ]);
  });

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

  it('in Simple Mode (Session 56, the owner: Pro Mode’s parts): Edit slides…, Trim, the later Parts’ items that serve Simple Mode, Rename and Delete; nothing else that fits the thing or a later Part adds', () => {
    const off = addFileMenuItems(() => [{ label: 'Save picture…', onSelect: noop }]);
    // Trim black and silence, Even loudness and When it ends (Pro Mode's menu's too) say they serve Simple Mode.
    const offBoth = addFileMenuItems(
      (t) => (t.kind === 'video' ? [{ label: 'When it ends: Wallpaper', onSelect: noop }] : []),
      { simple: true },
    );
    const simple = (target: FileTarget) =>
      fileMenuEntries(target, 'darwin', { simple: true }).map(
        (e) => `${e.separatorBefore === true ? '— ' : ''}${e.label}`,
      );
    // A video's row: Trim and When it ends, Rename, Delete; never the place's own (Timers when it goes up…), Show in
    // Finder or Save picture….
    expect(simple(video)).toEqual([
      'Trim (start, end and markers)…',
      'When it ends: Wallpaper',
      '— Rename…',
      '— Remove from playlist',
    ]);
    // A picture's row: its Picture editor is Pro Mode's.
    expect(
      simple({
        kind: 'picture',
        name: 'Placeholder backdrop.png',
        place: 'playlist',
        mediaId: 'm3',
        edit: { label: 'Picture editor…', run: noop },
        rename: noop,
        reveal: noop,
        remove: video.remove,
      }),
    ).toEqual(['Rename…', '— Remove from playlist']);
    // A deck's row: Edit slides… (Pro's slide editor), Rename and Delete.
    expect(
      simple({
        kind: 'deck',
        name: 'Placeholder katha',
        place: 'playlist',
        presentationId: 'p2',
        edit: { label: 'Edit slides…', run: noop },
        rename: noop,
        reveal: noop,
        remove: video.remove,
      }),
    ).toEqual(['Edit slides…', '— Rename…', '— Remove from playlist']);
    // A slide's row: Edit slides… at it, and Delete (it is no file to rename); a video input's: Delete alone.
    expect(
      simple({
        kind: 'slide',
        name: 'Placeholder deck_2',
        place: 'playlist',
        edit: { label: 'Edit slides…', run: noop },
        remove: video.remove,
      }),
    ).toEqual(['Edit slides…', '— Remove from playlist']);
    expect(
      simple({ kind: 'input', name: 'Placeholder camera', place: 'playlist', remove: video.remove }),
    ).toEqual(['Remove from playlist']);
    // A wallpaper's Edit wallpaper… (its order, seconds and fade) stays Pro Mode's.
    expect(
      simple({
        kind: 'picture',
        name: 'Placeholder wallpaper',
        place: 'wallpapers',
        edit: { label: 'Edit wallpaper…', run: noop },
        rename: noop,
        remove: { label: 'Delete…', run: noop },
      }),
    ).toEqual(['Rename…', '— Delete…']);
    // Pro Mode's menu has them as before, the rest with them.
    expect(labels(video)).toEqual([
      'Timers when it goes up…',
      '— Trim (start, end and markers)…',
      'Save picture…',
      'When it ends: Wallpaper',
      '— Rename…',
      'Show in Finder',
      '— Remove from playlist',
    ]);
    offBoth();
    expect(simple(video)).toEqual(['Trim (start, end and markers)…', '— Rename…', '— Remove from playlist']);
    // A header names a part of the playlist, not a file: Simple Mode never renames it.
    expect(
      simple({
        kind: 'header',
        name: 'Placeholder part',
        place: 'playlist',
        rename: noop,
        remove: video.remove,
      }),
    ).toEqual(['Remove from playlist']);
    off();
  });
});
