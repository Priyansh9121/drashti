import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MediaElement, ShapeElement, TextElement } from '../../../shared/model';
import { cocoaRtf, pp6Playlist, pp6Presentation, pp6Template } from '../testing/pp6-fixtures';
import { XmlError } from '../xml';
import { parsePp6, pp6Color, pp6Rect, TEMPLATES_LIBRARY } from './pp6';

const bytes = (xml: string) => Buffer.from(xml, 'utf8');

const presentation = (xml: string, path = '/lib/Placeholder Hymn.pro6') => {
  const parsed = parsePp6(bytes(xml), path);
  if (parsed.kind !== 'presentation') throw new Error(`expected a presentation, got ${parsed.kind}`);
  return parsed.presentation;
};

describe('PP6 values', () => {
  it('reads colours and rectangles', () => {
    expect(pp6Color('1 1 1 1')).toBe('#ffffff');
    expect(pp6Color('0 0.5 1 0.5')).toBe('#0080ff80');
    expect(pp6Color('0 0 0 0')).toBeNull();
    expect(pp6Color('x y z')).toBeNull();
    expect(pp6Color(undefined)).toBeNull();
    expect(pp6Rect('{24 -12 0 1872 1032}')).toEqual({ x: 24, y: -12, width: 1872, height: 1032 });
    expect(pp6Rect('{1 2 3}')).toBeNull();
  });
});

describe('parsePp6: presentations', () => {
  const xml = pp6Presentation({
    uuid: 'DOC-1',
    ccliTitle: 'Placeholder Hymn',
    groups: [
      {
        name: 'Verse 1',
        color: '0 0 1 1',
        uuid: 'G-V',
        slides: [
          {
            label: 'Opening',
            notes: 'Placeholder note',
            background: { path: '/Media/Loops/Blue Loop.mov', kind: 'video', loop: true, scale: 1 },
            text: [
              {
                rtf: cocoaRtf([
                  ['નમૂનાની પહેલી પંક્તિ', 80, [255, 255, 255]],
                  ['Namūnānī pahelī paṅkti', 50, [255, 204, 0]],
                ]),
                fill: '0 0 0 0.5',
                vertical: 2,
              },
            ],
            audio: '/Media/Audio/Placeholder Tune.mp3',
            transition: true,
          },
          { text: [{ rtf: cocoaRtf([['Second slide', 72, [255, 255, 255]]], 'ql'), outline: true }] },
        ],
      },
      {
        name: 'Chorus',
        color: '1 0 0 1',
        uuid: 'G-C',
        slides: [
          {
            enabled: false,
            image: { path: '/Media/Pictures/Placeholder Logo.png', rect: [1600, 40, 280, 160] },
            shape: { fill: '0.2 0.4 0.6 1', rect: [0, 900, 1920, 180] },
          },
        ],
      },
    ],
    arrangements: [{ name: 'Usual', groups: ['G-V', 'G-C', 'G-V', 'G-missing'] }],
  });

  it('brings groups with colours, slides, arrangements, notes and size', () => {
    const p = presentation(xml);
    expect(p.name).toBe('Placeholder Hymn');
    expect(p.ref).toBe('DOC-1');
    expect([p.width, p.height]).toEqual([1920, 1080]);
    expect(p.library).toBeUndefined();
    expect(p.groups.map((g) => [g.name, g.color, g.slides.length])).toEqual([
      ['Verse 1', '#0000ff', 2],
      ['Chorus', '#ff0000', 1],
    ]);
    expect(p.arrangements).toEqual([{ name: 'Usual', groups: [0, 1, 0] }]);
    const first = p.groups[0]?.slides[0];
    expect([first?.label, first?.notes, first?.enabled]).toEqual(['Opening', 'Placeholder note', true]);
    expect(p.groups[1]?.slides[0]?.enabled).toBe(false);
    expect(p.notes).toBe('CCLI: SongTitle Placeholder Hymn');
  });

  it('turns slide text (RTF) into styled runs with languages, and a filled text box into a shape behind it', () => {
    const [fill, text] = presentation(xml).groups[0]?.slides[0]?.elements ?? [];
    expect(fill).toMatchObject<Partial<ShapeElement>>({
      kind: 'shape',
      fill: '#00000080',
      frame: { x: 100, y: 100, width: 1720, height: 880 },
    });
    const t = text as TextElement;
    expect(t.kind).toBe('text');
    expect(t.text).toBe('નમૂનાની પહેલી પંક્તિ\nNamūnānī pahelī paṅkti');
    expect(t.lang).toBe('gu');
    expect(t.runs).toEqual([
      {
        text: 'નમૂનાની પહેલી પંક્તિ\n',
        font: 'Helvetica',
        size: 80,
        weight: 400,
        color: '#ffffff',
        lang: 'gu',
      },
      {
        text: 'Namūnānī pahelī paṅkti',
        font: 'Helvetica',
        size: 50,
        weight: 400,
        color: '#ffcc00',
        lang: 'translit',
      },
    ]);
    expect(t.style).toMatchObject({
      fontSize: 80,
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'bottom',
      shadow: true,
    });
  });

  it("puts a slide's background image or video on the background layer, as a cue, not into the slide", () => {
    const p = presentation(xml);
    const first = p.groups[0]?.slides[0];
    expect(first?.elements.some((e) => e.kind === 'image' || e.kind === 'video')).toBe(false);
    expect(first?.cues[0]).toEqual({
      kind: 'background',
      label: 'Background 0',
      media: 0,
      props: { media: 'video', fit: 'fill', loop: true },
    });
    // (On Windows the URL also names the drive.)
    expect(p.media[0]).toEqual({
      originalPath: pathToFileURL('/Media/Loops/Blue Loop.mov').href,
      kind: 'video',
    });
  });

  it('keeps images placed on a slide as media elements, shapes as shapes, and audio as a cue', () => {
    const p = presentation(xml);
    const chorus = p.groups[1]?.slides[0]?.elements ?? [];
    expect(chorus[0]).toMatchObject<Partial<MediaElement>>({
      kind: 'image',
      frame: { x: 1600, y: 40, width: 280, height: 160 },
      mediaId: 'media-ref:2',
      fit: 'fit',
    });
    expect(chorus[1]).toMatchObject<Partial<ShapeElement>>({
      kind: 'shape',
      fill: '#336699',
      cornerRadius: 12,
    });
    const audio = p.groups[0]?.slides[0]?.cues[1];
    expect(audio).toMatchObject({
      kind: 'audio',
      label: 'Placeholder audio',
      media: 1,
      props: { volume: 0.8, loop: true },
    });
    expect(p.media.map((m) => m.kind)).toEqual(['video', 'audio', 'image']);
  });

  it('keeps text typed in a legacy Gujarati font as typed, in its font, and names the font in the report', () => {
    const p = presentation(
      pp6Presentation({
        uuid: 'LEGACY',
        groups: [
          {
            name: 'Verse',
            slides: [{ text: [{ rtf: cocoaRtf([['nmUnO pHelI', 80, [255, 255, 255]]], 'qc', 'Gopika') }] }],
          },
        ],
      }),
    );
    const t = p.groups[0]?.slides[0]?.elements[0] as TextElement;
    expect(t.runs).toEqual([
      {
        text: 'nmUnO pHelI',
        font: 'Gopika',
        size: 80,
        weight: 400,
        color: '#ffffff',
        legacy: true,
        lang: null,
      },
    ]);
    expect(t.lang).toBeNull();
    expect(p.issues.find((i) => i.code === 'legacy-font')).toMatchObject({
      severity: 'warning',
      fix: { kind: 'convert-font', font: 'Gopika' },
    });
  });

  it('reports what does not come across, counted', () => {
    const codes = presentation(xml).issues.map((i) => [i.code, i.severity]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ['background-media', 'info'],
        ['slide-cues', 'info'],
        ['transition', 'info'],
        ['text-outline', 'warning'],
      ]),
    );
    // Nothing in a report names the other product.
    expect(JSON.stringify(presentation(xml).issues)).not.toMatch(/propresenter/iu);
  });
});

describe('parsePp6: templates and playlists', () => {
  it('puts templates in the Templates library, not with the presentations', () => {
    const p = presentation(
      pp6Template([{ text: [{ rtf: cocoaRtf([['Title here', 90, [255, 255, 255]]]) }] }]),
      '/t/Blue Style.pro6Template',
    );
    expect(p.library).toBe(TEMPLATES_LIBRARY);
    expect(p.ref).toBeNull();
    expect(p.groups.map((g) => [g.name, g.slides.length])).toEqual([['Template', 1]]);
    expect(p.issues[0]).toMatchObject({ code: 'template', severity: 'info' });
  });

  it('reads folders, playlists, presentations by path, headers, media and other items', () => {
    const parsed = parsePp6(
      bytes(
        pp6Playlist([
          {
            name: 'Sunday',
            entries: [
              { header: 'Opening' },
              {
                document: '/Users/op/Documents/ProPresenter6/Placeholder Hymn.pro6',
                name: 'Placeholder Hymn',
              },
              { media: '/Media/Loops/Blue Loop.mov', name: 'Loop' },
              { other: 'RVTimerCue' },
            ],
          },
          { name: 'Empty', entries: [] },
        ]),
      ),
      '/pl/Default.pro6pl',
    );
    if (parsed.kind !== 'playlist') throw new Error('expected a playlist');
    const doc = parsed.playlist;
    expect(doc.name).toBe('Default');
    const folder = doc.playlists[0];
    expect([folder?.name, folder?.isFolder, folder?.children.map((c) => c.name)]).toEqual([
      'Services',
      true,
      ['Sunday', 'Empty'],
    ]);
    const sunday = folder?.children[0];
    expect(sunday?.isFolder).toBe(false);
    expect(sunday?.items).toEqual([
      { kind: 'header', name: 'Opening', color: '#ff8000' },
      {
        kind: 'presentation',
        name: 'Placeholder Hymn',
        path: '/Users/op/Documents/ProPresenter6/Placeholder Hymn.pro6',
        ref: null,
      },
      { kind: 'media', name: 'Loop', media: 0 },
      { kind: 'placeholder', name: 'Something else', hint: 'RVTimerCue' },
    ]);
    expect(doc.issues.map((i) => i.code)).toEqual(['playlist-RVTimerCue']);
  });

  it('says what a file holds when it is not a presentation or playlist, and refuses what is not XML', () => {
    expect(parsePp6(bytes('<?xml version="1.0"?><array rvXMLIvarName="x"/>'), '/x/Messages.pro6')).toEqual({
      kind: 'other',
      root: 'array',
    });
    expect(() => parsePp6(bytes('not xml at all'), '/x/Broken.pro6')).toThrow(XmlError);
  });
});
