import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MediaElement, ShapeElement, TextElement } from '../../../shared/model';
import { cocoaRtf } from '../testing/pp6-fixtures';
import { pp7Playlists, pp7Presentation, pp7Theme } from '../testing/pp7-fixtures';
import { ProtobufError } from '../protobuf';
import { parsePp7, pp7Color, pp7KindOf, pp7Shadow, urlPath } from './pp7';
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
          { id: 'c2', text: [{ rtf: cocoaRtf([['Second slide', 72, [255, 255, 255]]], 'ql') }], clear: true },
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
    expect(p.arrangements).toEqual([{ name: 'Usual', groups: [0, 1, 0], ref: 'arr-0' }]);
    expect(p.selectedArrangement).toBeNull();
    const chosen = presentation(
      pp7Presentation({
        uuid: 'P7-S',
        name: 'Placeholder chosen',
        groups: [{ name: 'Verse', uuid: 'G-V', slides: [{ id: 's1' }] }],
        arrangements: [
          { name: 'One', groups: ['G-V'] },
          { name: 'Two', groups: ['G-V', 'G-V'] },
        ],
        selectedArrangement: 1,
      }),
    );
    expect(chosen.selectedArrangement).toBe(1);
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
      { kind: 'audio', label: 'Placeholder audio', media: 1, props: { volume: 1, loop: false } },
    ]);
    const logo = p.groups[1]?.slides[0]?.elements[0];
    expect(logo).toMatchObject<Partial<MediaElement>>({ kind: 'image', mediaId: 'media-ref:2', fit: 'fit' });
    const url = (p: string) => pathToFileURL(p).href; // on Windows the URL also names the drive
    expect(p.media.map((m) => [m.kind, m.originalPath])).toEqual([
      ['video', url('/Media/Loops/Blue Loop.mov')],
      ['audio', url('/Media/Audio/Placeholder Tune.mp3')],
      ['image', url('/Media/Pictures/Placeholder Logo.png')],
    ]);
    // Only the clear cue does not run yet.
    expect(p.issues.find((i) => i.code === 'slide-cues')?.message).toBe(
      'A slide cue (a clear, a message, a timer...) came across but does not run yet.',
    );
    expect(p.issues.map((i) => i.code)).not.toContain('background-media');
  });

  it("keeps an audio cue's volume and looping", () => {
    const p = presentation(
      pp7Presentation({
        uuid: 'P7-AUDIO',
        name: 'Placeholder Dhun',
        groups: [
          {
            name: 'Verse',
            uuid: 'G-A',
            slides: [
              { id: 'a1', audio: { path: '/Media/Audio/Placeholder Dhun.mp3', volume: 0.6, loop: true } },
              { id: 'a2', audio: { path: '/Media/Audio/Placeholder Dhun.mp3', volume: 7 } },
            ],
          },
        ],
      }),
    );
    expect(p.groups[0]?.slides.map((s) => s.cues[0]?.props)).toEqual([
      { volume: 0.6, loop: true },
      { volume: 1, loop: false },
    ]);
    expect(p.issues.map((i) => i.code)).not.toContain('slide-cues');
  });

  it('keeps text typed in a legacy Hindi font as typed, and names the font in the report', () => {
    const p = presentation(
      pp7Presentation({
        uuid: 'LEGACY',
        groups: [
          {
            name: 'V',
            uuid: 'g',
            slides: [
              { id: 'a', text: [{ rtf: cocoaRtf([['uewuk', 72, [255, 255, 255]]], 'qc', 'Kruti Dev 010') }] },
            ],
          },
        ],
      }),
    );
    const t = p.groups[0]?.slides[0]?.elements[0] as TextElement;
    expect(t.runs?.[0]).toMatchObject({ text: 'uewuk', font: 'Kruti Dev 010', legacy: true, lang: null });
    expect(p.issues.find((i) => i.code === 'legacy-font')?.message).toMatch(
      /^Text in the legacy Hindi font “Kruti Dev 010”/u,
    );
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
      '2 fields in this file are from a format version the importer does not know; they were not imported.',
    );
  });

  it('refuses a file that is not a presentation', () => {
    expect(() => parsePp7(new TextEncoder().encode('TEMPLATE = app'), '/x/qt.pro', 'presentation')).toThrow(
      ProtobufError,
    );
  });
});

describe('parsePp7: the look and timing of slides', () => {
  it('reads shadows: an angle the mathematical way, an offset, a blur and an opacity', () => {
    const shadow = (sh: Record<string, unknown>) => pp7Shadow({ enable: true, ...sh });
    expect(
      shadow({
        angle: 315,
        offset: 10,
        radius: 3,
        opacity: 0.75,
        color: { red: 0, green: 0, blue: 0, alpha: 1 },
      }),
    ).toEqual({ color: '#000000bf', blur: 3, x: 7.07, y: 7.07 });
    // Straight up; no opacity stored means fully there; no colour means black.
    expect(shadow({ angle: 90, offset: 4 })).toEqual({ color: '#000000', blur: 0, x: 0, y: -4 });
    expect(pp7Shadow({ enable: false, angle: 0, offset: 4 })).toBeNull();
    expect(pp7Shadow(undefined)).toBeNull();
  });

  const red = [1, 0, 0, 1];
  const look = presentation(
    pp7Presentation({
      uuid: 'LOOK',
      transition: { seconds: 0.8, effect: 'Dissolve' },
      groups: [
        {
          name: 'Verse',
          uuid: 'G',
          slides: [
            {
              id: 'a',
              text: [
                {
                  rtf: cocoaRtf([['Placeholder turned', 72, [255, 255, 255]]]),
                  rect: [100, 200, 800, 100],
                  rotation: 30,
                  shadow: { angle: 315, offset: 10, radius: 3, opacity: 0.75 },
                  stroke: { width: 3, color: red },
                  scale: 2,
                  path: { type: 11, roundness: 0.25 },
                },
              ],
              shapes: [
                { rect: [10, 10, 100, 50], path: { type: 2 }, fill: [0, 0, 1, 1], rotation: 352 },
                {
                  rect: [200, 10, 100, 40],
                  path: { type: 11, roundness: 0.5 },
                  stroke: { width: 4, color: red },
                },
                {
                  rect: [400, 400, 200, 100],
                  path: {
                    type: 8,
                    points: [
                      [0, 0],
                      [1, 1],
                    ],
                    closed: false,
                  },
                  stroke: { width: 6, color: [0, 1, 0, 1] },
                },
                { rect: [600, 10, 100, 50], path: { type: 4 }, fill: [1, 1, 1, 1] },
                { rect: [800, 10, 100, 50], path: { type: 1 }, gradient: true },
                { rect: [900, 10, 100, 50], path: { type: 1 }, fill: [1, 1, 1, 1], shadow: true },
              ],
              transition: { seconds: 1.5 },
              completion: { target: 1, action: 3, seconds: 4 },
            },
            {
              id: 'b',
              transition: { seconds: 0.5, effect: 'Push' },
              completion: { target: 1, action: 2, seconds: 0 },
            },
            { id: 'c', transition: { seconds: 1, effect: 'Cut' } },
            { id: 'd', completion: { target: 4, action: 3, seconds: 6 } },
          ],
        },
      ],
    }),
  );

  it('keeps rotation, outlines, shadows, shrink-to-fit and the shapes Drashti can draw', () => {
    const [box, words, oval, rounded, line, ...rest] = look.groups[0]?.slides[0]?.elements ?? [];
    // The box's outline is a rounded shape behind the words, turned with them.
    expect(box).toEqual({
      id: 's0-e0-fill',
      kind: 'shape',
      frame: { x: 100, y: 200, width: 800, height: 100 },
      fill: null,
      cornerRadius: 25,
      opacity: 1,
      outline: { color: '#ff0000', width: 3 },
      rotation: 30,
    });
    expect(words).toMatchObject({
      kind: 'text',
      rotation: 30,
      style: { shadow: { color: '#000000bf', blur: 3, x: 7.07, y: 7.07 }, shrinkToFit: true },
    });
    expect(oval).toMatchObject({ kind: 'shape', shape: 'ellipse', fill: '#0000ff', rotation: 352 });
    expect(rounded).toMatchObject({ kind: 'shape', fill: null, cornerRadius: 20, outline: { width: 4 } });
    // A path of two points is a line from one to the other: across 200 x 100, turned down to the right.
    expect(line).toEqual({
      id: 's0-e3',
      kind: 'shape',
      shape: 'line',
      frame: { x: 388.2, y: 440, width: 223.61, height: 20 },
      rotation: 26.57,
      fill: null,
      cornerRadius: 0,
      opacity: 1,
      outline: { color: '#00ff00', width: 6 },
    });
    // The triangle and the gradient are left out; the shadowed rectangle stays, without its shadow.
    expect(rest).toEqual([expect.objectContaining({ kind: 'shape', fill: '#ffffff' })]);
    const codes = look.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['custom-shape', 'gradient-fill', 'shape-shadow']));
    expect(codes).not.toContain('rotation');
    expect(codes).not.toContain('outline');
  });

  it('keeps transitions, the presentation’s too, and auto-advance, with a loop from the last slide', () => {
    expect(look.transition).toEqual({ kind: 'dissolve', durationMs: 800 });
    expect(look.groups[0]?.slides.map((sl) => [sl.transition, sl.autoAdvanceMs])).toEqual([
      [{ kind: 'dissolve', durationMs: 1500 }, 4000],
      // A push dissolves; moving on after a video ends waits for the operator.
      [{ kind: 'dissolve', durationMs: 500 }, null],
      [{ kind: 'cut', durationMs: 0 }, null],
      [null, 6000],
    ]);
    expect(look.loop).toBe(true);
    const codes = look.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['transition-kind', 'auto-advance-other']));
    expect(codes).not.toContain('transition');
    expect(codes).not.toContain('timer-to-first');
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
                  arrangement: 0,
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
        arrangementRef: 'arr-0',
      },
      { kind: 'media', name: 'Loop', media: 0 },
    ]);
  });
});
