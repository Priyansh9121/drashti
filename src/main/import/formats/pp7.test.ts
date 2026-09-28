import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MediaElement, ShapeElement, TextElement } from '../../../shared/model';
import { cocoaRtf } from '../testing/pp6-fixtures';
import { pp7Playlists, pp7Presentation, pp7Theme } from '../testing/pp7-fixtures';
import { ProtobufError } from '../protobuf';
import { parsePp7, pp7Color, pp7KindOf, urlPath } from './pp7';
import { TEMPLATES_LIBRARY } from './pp6';

const presentation = (bytes: Uint8Array, path = '/lib/Default/Placeholder Hymn.pro') => {
  const parsed = parsePp7(bytes, path, 'presentation');
  if (parsed.kind !== 'presentation') throw new Error('expected a presentation');
  return parsed.presentation;
};

const doc = () =>
  pp7Presentation({
    uuid: 'P7-1',
    name: 'Placeholder Hymn',
    ccliTitle: 'Placeholder Hymn',
    groups: [
      {
        name: 'Verse 1',
        uuid: 'G-V',
        color: [0, 0, 1, 1],
        slides: [
          {
            id: 'c1',
            label: 'Opening',
            background: { path: '/Media/Loops/Blue Loop.mov', kind: 'video', loop: true },
            text: [
              {
                rtf: cocoaRtf([
                  ['નમૂનાની પહેલી પંક્તિ', 80, [255, 255, 255]],
                  ['Namūnānī pahelī paṅkti', 50, [255, 204, 0]],
                ]),
                fill: [0, 0, 0, 0.5],
                vertical: 2,
              },
            ],
            audio: '/Media/Audio/Placeholder Tune.mp3',
            notesRtf: cocoaRtf([['Placeholder note', 20, [0, 0, 0]]]),
          },
          { id: 'c2', text: [{ rtf: cocoaRtf([['Second slide', 72, [255, 255, 255]]], 'ql') }] },
        ],
      },
      {
        name: 'Chorus',
        uuid: 'G-C',
        color: [1, 0, 0, 1],
        slides: [
          {
            id: 'c3',
            enabled: false,
            image: { path: '/Media/Pictures/Placeholder Logo.png', rect: [1600, 40, 280, 160] },
          },
        ],
      },
    ],
    loose: [{ id: 'c4', label: 'Not in a group' }],
    arrangements: [{ name: 'Usual', groups: ['G-V', 'G-C', 'G-V', 'G-missing'] }],
  });

describe('PP7 values', () => {
  it('reads colours and URLs', () => {
    expect(pp7Color({ red: 1, green: 1, blue: 1, alpha: 1 })).toBe('#ffffff');
    expect(pp7Color({ red: 0, green: 0.5, blue: 1, alpha: 0.5 })).toBe('#0080ff80');
    expect(pp7Color({ red: 1 })).toBeNull();
    expect(urlPath({ absolute_string: 'file:///Media/a.mov' })).toBe('file:///Media/a.mov');
    expect(urlPath({ local: { root: 3, path: 'Lyrics/a.pro' } })).toMatch(
      /Documents[\\/]Lyrics[\\/]a\.pro$/u,
    );
    expect(urlPath({ relative_path: 'Media/a.png' })).toBe('Media/a.png');
    expect(urlPath(undefined)).toBeNull();
  });

  it('knows which files it reads', () => {
    expect(pp7KindOf('/x/Libraries/Default/Song.pro')).toBe('presentation');
    expect(pp7KindOf('/x/Themes/Clouds/Theme')).toBe('template');
    expect(pp7KindOf('/x/Playlists/Library')).toBe('playlist');
    expect(pp7KindOf('/x/Configuration/Screens')).toBeNull();
  });
});

describe('parsePp7: presentations', () => {
  it('brings groups with colours, slides in group order, arrangements, notes and size', () => {
    const p = presentation(doc());
    expect([p.name, p.ref, p.width, p.height, p.library]).toEqual([
      'Placeholder Hymn',
      'P7-1',
      1920,
      1080,
      undefined,
    ]);
    expect(p.groups.map((g) => [g.name, g.color, g.slides.map((s) => s.label)])).toEqual([
      ['Verse 1', '#0000ff', ['Opening', '']],
      ['Chorus', '#ff0000', ['']],
      ['', null, ['Not in a group']],
    ]);
    expect(p.arrangements).toEqual([{ name: 'Usual', groups: [0, 1, 0] }]);
    expect(p.groups[0]?.slides[0]?.notes).toBe('Placeholder note');
    expect(p.groups[1]?.slides[0]?.enabled).toBe(false);
    expect(p.groups[0]?.slides[0]?.enabled).toBe(true);
    expect(p.notes).toBe('CCLI: SongTitle Placeholder Hymn');
  });

  it('turns text boxes into styled runs, and a filled box into a shape behind the text', () => {
    const [fill, text] = presentation(doc()).groups[0]?.slides[0]?.elements ?? [];
    expect(fill).toMatchObject<Partial<ShapeElement>>({
      kind: 'shape',
      fill: '#00000080',
      frame: { x: 100, y: 100, width: 1720, height: 880 },
    });
    const t = text as TextElement;
    expect([t.text, t.lang, t.style.verticalAlign, t.style.fontSize]).toEqual([
      'નમૂનાની પહેલી પંક્તિ\nNamūnānī pahelī paṅkti',
      'gu',
      'bottom',
      80,
    ]);
    expect(t.runs?.map((r) => [r.lang, r.size, r.color])).toEqual([
      ['gu', 80, '#ffffff'],
      ['translit', 50, '#ffcc00'],
    ]);
  });

  it('puts background media on the background layer as a cue, keeps placed images as media elements and audio as a cue', () => {
    const p = presentation(doc());
    const first = p.groups[0]?.slides[0];
    expect(first?.elements.some((e) => e.kind === 'image' || e.kind === 'video')).toBe(false);
    expect(first?.cues).toEqual([
      {
        kind: 'background',
        label: 'Background',
        media: 0,
        props: { media: 'video', fit: 'fill', loop: true },
      },
      { kind: 'audio', label: 'Placeholder audio', media: 1, props: {} },
    ]);
    const logo = p.groups[1]?.slides[0]?.elements[0];
    expect(logo).toMatchObject<Partial<MediaElement>>({ kind: 'image', mediaId: 'media-ref:2', fit: 'fit' });
    const url = (p: string) => pathToFileURL(p).href; // on Windows the URL also names the drive
    expect(p.media.map((m) => [m.kind, m.originalPath])).toEqual([
      ['video', url('/Media/Loops/Blue Loop.mov')],
      ['audio', url('/Media/Audio/Placeholder Tune.mp3')],
      ['image', url('/Media/Pictures/Placeholder Logo.png')],
    ]);
    expect(p.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['background-media', 'slide-cues']));
  });

  it('treats every slide as enabled in files that never mark slides enabled', () => {
    const p = presentation(
      pp7Presentation({
        uuid: 'X',
        noEnabledFlags: true,
        groups: [{ name: 'V', uuid: 'g', slides: [{ id: 'a' }, { id: 'b' }] }],
      }),
    );
    expect(p.groups[0]?.slides.map((s) => s.enabled)).toEqual([true, true]);
  });

  it('counts fields from a newer format in the report', () => {
    const p = presentation(
      pp7Presentation({
        uuid: 'X',
        groups: [],
        unknown: [
          { field: 999, wireType: 0, value: 1 },
          { field: 998, wireType: 2, value: Uint8Array.from([1]) },
        ],
      }),
    );
    expect(p.issues.find((i) => i.code === 'unknown-fields')?.message).toBe(
      '2 field(s) in this file are from a format version the importer does not know; they were not imported.',
    );
  });

  it('refuses a file that is not a presentation', () => {
    expect(() => parsePp7(new TextEncoder().encode('TEMPLATE = app'), '/x/qt.pro', 'presentation')).toThrow(
      ProtobufError,
    );
  });
});

describe('parsePp7: themes and playlists', () => {
  it('reads a theme into the Templates library, named after its folder', () => {
    const parsed = parsePp7(
      pp7Theme([{ name: 'Title', rtf: cocoaRtf([['Title here', 90, [255, 255, 255]]]) }]),
      '/x/Themes/Clouds/Theme',
      'template',
    );
    if (parsed.kind !== 'presentation') throw new Error('expected a presentation');
    const p = parsed.presentation;
    expect([p.name, p.library, p.ref]).toEqual(['Clouds', TEMPLATES_LIBRARY, null]);
    expect(p.groups.map((g) => [g.name, g.slides.map((s) => s.label)])).toEqual([['Template', ['Title']]]);
  });

  it('reads folders, playlists, presentations by path, headers and media', () => {
    const parsed = parsePp7(
      pp7Playlists([
        {
          name: 'Services',
          playlists: [
            {
              name: 'Sunday',
              entries: [
                { header: 'Opening' },
                {
                  presentation: '/Users/op/Documents/ProPresenter/Libraries/Default/Placeholder Hymn.pro',
                  name: 'Placeholder Hymn',
                },
                { media: '/Media/Loops/Blue Loop.mov', name: 'Loop' },
              ],
            },
          ],
        },
      ]),
      '/x/Playlists/Library',
      'playlist',
    );
    if (parsed.kind !== 'playlist') throw new Error('expected a playlist');
    const d = parsed.playlist;
    expect(d.name).toBe('Library');
    expect(d.playlists.map((p) => [p.name, p.isFolder, p.children.map((c) => c.name)])).toEqual([
      ['Services', true, ['Sunday']],
    ]);
    expect(d.playlists[0]?.children[0]?.items).toEqual([
      { kind: 'header', name: 'Opening', color: '#ff8000' },
      {
        kind: 'presentation',
        name: 'Placeholder Hymn',
        path: pathToFileURL('/Users/op/Documents/ProPresenter/Libraries/Default/Placeholder Hymn.pro').href,
        ref: null,
      },
      { kind: 'media', name: 'Loop', media: 0 },
    ]);
  });
});
