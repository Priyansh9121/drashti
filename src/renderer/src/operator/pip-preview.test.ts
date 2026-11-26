import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, PipPlace, SlideLayer } from '../../../shared/engine/state';
import { initialEngineState, PIP_CORNERS, PIP_SIZES } from '../../../shared/engine/state';
import { DEFAULT_LIVE_GROUP_LOOK, type LiveGroupLook } from '../../../shared/looks';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import type { Size } from '../../../shared/scaling';
import { pipRect } from '../render/pip';
import { Scene } from '../render/Scene';
import { previewBehind, previewFrame, type PreviewSource, previewWords } from './pip-preview';
import { PipPreviewView } from './PipPreview';

/*
 * Picture in Picture's preview (QA24-PIPPREVIEW-1, the owner: "in picture in picture, add a preview to see how it
 * looks"): the box over the picture the screens show now, before it goes up, in the dialog and in the section under
 * LIVE. Its place, size, border and corners are the screens' own (checked against the hall's Scene drawing the same
 * box), it follows each choice, it says in words what it shows, and it sends nothing anywhere: no command, no
 * capture. Rendered without a page: nothing loads, only what each draws is read. Placeholder names only.
 */

const HD: Size = { width: 1920, height: 1080 };
/** A screen that is not 16:9 (an LED wall's canvas): the box is as tall as fits. */
const WALL: Size = { width: 1280, height: 1024 };

const SLIDE: SlideLayer = {
  presentationId: 'p',
  slideIndex: 0,
  shownAt: 1,
  notes: '',
  slide: { id: 's', width: 1920, height: 1080, background: null, elements: [] },
};

/** The show now: a picture as the background and a slide over it (or as given). */
function show(over: Partial<EngineState['layers']> = {}, rest: Partial<EngineState> = {}): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    ...rest,
    layers: {
      ...state.layers,
      background: {
        kind: 'media',
        mediaId: 'backdrop',
        media: 'image',
        fit: 'fill',
        loop: false,
        startedAt: 1,
      },
      slide: SLIDE,
      ...over,
    },
  };
}

const place = (over: Partial<PipPlace> = {}): PipPlace => ({ ...DEFAULT_PIP_PLACE, ...over });

const view = (
  p: PipPlace,
  source: PreviewSource = { kind: 'slides' },
  state: EngineState = show(),
  canvas: Size = HD,
  look: LiveGroupLook = DEFAULT_LIVE_GROUP_LOOK,
) =>
  renderToStaticMarkup(
    createElement(PipPreviewView, {
      place: p,
      source,
      behind: previewBehind(state, look, source.kind === 'slides'),
      canvas,
      scaling: 'fit',
      languages: null,
      lead: 'preview',
      testId: 'pip-preview',
    }),
  );

/** The preview's box: its marks and its style, as written. */
function boxOf(html: string) {
  const tag = /<div[^>]*data-testid="pip-preview-box"[^>]*>/u.exec(html)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`${name}="([^"]*)"`, 'u').exec(tag)?.[1] ?? null;
  return {
    found: tag !== '',
    rect: attr('data-pip-rect'),
    corner: attr('data-pip-corner'),
    size: attr('data-pip-size'),
    source: attr('data-pip-source'),
    radius: attr('data-pip-radius'),
    line: attr('data-pip-line'),
    style: attr('style') ?? '',
  };
}

/** The screens' own box, as the hall's Scene draws it (up long ago: still). */
function screensBox(p: PipPlace, canvas: Size) {
  const state = show({ pip: { source: { kind: 'slides' }, place: p, swapped: false, shownAt: 1 } });
  const html = renderToStaticMarkup(createElement(Scene, { state, canvas, scaling: 'fit' }));
  const tag = /<div[^>]*data-testid="pip-box"[^>]*>/u.exec(html)?.[0] ?? '';
  const border = /<div data-pip-border=""[^>]*style="([^"]*)"/u.exec(html)?.[1] ?? null;
  const frame = /<div data-pip-frame=""[^>]*style="([^"]*)"/u.exec(html)?.[1] ?? '';
  return {
    rect: /data-pip-rect="([^"]*)"/u.exec(tag)?.[1] ?? null,
    line: border === null ? 0 : Number(/border:(\d+)px solid/u.exec(border)?.[1] ?? NaN),
    radius: Number(/border-radius:(\d+)px/u.exec(frame)?.[1] ?? 0),
  };
}

const PLACES: PipPlace[] = [
  ...PIP_CORNERS.flatMap((corner) => PIP_SIZES.map((size) => place({ corner, size }))),
  place({ corner: null, x: 0.4, y: 0.2, size: 'large' }),
  place({ corner: null, x: 0.95, y: 0.95, size: 'small' }),
  place({ border: false }),
  place({ rounded: false }),
  place({ border: false, rounded: false, corner: 'top-left' }),
];

describe('the preview’s box is the screens’ own', () => {
  it('sits where the hall’s screens put it, at the same size, on a 16:9 screen and an LED wall', () => {
    for (const canvas of [HD, WALL])
      for (const p of PLACES) {
        const label = `${JSON.stringify(p)} on ${String(canvas.width)}x${String(canvas.height)}`;
        const r = pipRect(p, canvas);
        const box = boxOf(view(p, { kind: 'slides' }, show(), canvas));
        expect(box.found, label).toBe(true);
        expect(box.rect, label).toBe(`${String(r.x)},${String(r.y)},${String(r.width)},${String(r.height)}`);
        expect(box.rect, label).toBe(screensBox(p, canvas).rect);
        // Placed by shares of the picture, so it is right at whatever size the preview is drawn.
        const pct = (n: number, of: number) => `${String((n / of) * 100)}%`;
        expect(box.style, label).toContain(`left:${pct(r.x, canvas.width)}`);
        expect(box.style, label).toContain(`top:${pct(r.y, canvas.height)}`);
        expect(box.style, label).toContain(`width:${pct(r.width, canvas.width)}`);
        expect(box.style, label).toContain(`height:${pct(r.height, canvas.height)}`);
      }
  });

  it('has the screens’ thin border and rounded corners when chosen, and none when not', () => {
    for (const canvas of [HD, WALL])
      for (const p of PLACES) {
        const label = `${JSON.stringify(p)} on ${String(canvas.width)}x${String(canvas.height)}`;
        const screens = screensBox(p, canvas);
        const frame = previewFrame(p, canvas);
        expect(frame.line, label).toBe(screens.line);
        expect(frame.radius, label).toBe(screens.radius);
        const html = view(p, { kind: 'slides' }, show(), canvas);
        const box = boxOf(html);
        expect(box.line, label).toBe(String(screens.line));
        expect(box.radius, label).toBe(String(screens.radius));
        expect(html.includes('data-pip-border'), label).toBe(p.border);
      }
  });

  it('says its corner and size, and what it holds', () => {
    const top = boxOf(view(place({ corner: 'top-left', size: 'small' })));
    expect(top).toMatchObject({ corner: 'top-left', size: 'small', source: 'slides' });
    const dragged = boxOf(view(place({ corner: null, x: 0.4, y: 0.2 })));
    expect(dragged.corner).toBe('none');
    const sources: PreviewSource[] = [
      { kind: 'media', mediaId: 'boxed', media: 'image', name: 'Placeholder picture.png' },
      { kind: 'input', name: 'Placeholder input' },
      { kind: 'window', name: 'Placeholder meeting' },
      { kind: 'none' },
    ];
    for (const source of sources) expect(boxOf(view(place(), source)).source).toBe(source.kind);
  });
});

describe('what the preview draws, from stills only', () => {
  it('the picture the screens show now behind the box: the background and the slide, as a group shows them', () => {
    const behind = previewBehind(show(), DEFAULT_LIVE_GROUP_LOOK, false);
    expect(behind.background?.kind).toBe('media');
    expect(behind.slide).toBe(SLIDE);
    expect(behind.boxSlide).toBeNull();
    expect(behind.nothing).toBeNull();
    const html = view(place(), { kind: 'input', name: 'Placeholder input' });
    expect(html).toContain('data-preview-behind="media"');
    expect(html).toContain('data-preview-behind="slide"');
    // A group that leaves the background out: none behind the box.
    const noBackground = {
      ...DEFAULT_LIVE_GROUP_LOOK,
      layers: DEFAULT_LIVE_GROUP_LOOK.layers.filter((l) => l !== 'background'),
    };
    expect(previewBehind(show(), noBackground, false).background).toBeNull();
  });

  it('the slides in the box: the slide goes in the box, the main picture keeps the background', () => {
    const behind = previewBehind(show(), DEFAULT_LIVE_GROUP_LOOK, true);
    expect(behind.slide).toBeNull();
    expect(behind.boxSlide).toBe(SLIDE);
    const html = view(place(), { kind: 'slides' });
    expect(html).toContain('data-preview-behind="media"');
    expect(html).not.toContain('data-preview-behind="slide"');
    expect(html).toContain('data-preview-in-box="slide"');
    // No slide up: the box of the slides is empty on the screens, and the preview says so in it.
    const none = view(place(), { kind: 'slides' }, show({ slide: null }));
    expect(none).toContain('data-preview-in-box="no-slide"');
  });

  it('with nothing up, the wallpaper chosen, else black; black-out and the Wallpaper are said', () => {
    const empty = show({ background: null, slide: null });
    expect(previewBehind(empty, DEFAULT_LIVE_GROUP_LOOK, false).nothing).toBe('black');
    const papered: EngineState = {
      ...empty,
      chosenWallpaper: {
        id: 'w',
        name: 'Placeholder wallpaper',
        pictures: ['paper'],
        secondsEach: 10,
        fadeMs: 1000,
        since: 1,
      },
    };
    expect(previewBehind(papered, DEFAULT_LIVE_GROUP_LOOK, false).nothing).toBe('wallpaper');
    expect(previewBehind(show({}, { blackout: true }), DEFAULT_LIVE_GROUP_LOOK, false).covered).toBe(
      'blackout',
    );
    expect(previewBehind(show({}, { wallpaper: true }), DEFAULT_LIVE_GROUP_LOOK, false).covered).toBe(
      'wallpaper',
    );
  });

  it('a video input, a window or a stream link is named, never opened: no camera, no capture, no video', () => {
    const input = view(place(), { kind: 'input', name: 'Placeholder input' });
    expect(input).toContain('Placeholder input');
    expect(input).not.toContain('<video');
    const window = view(place(), { kind: 'window', name: 'Placeholder meeting' });
    expect(window).toContain('Placeholder meeting');
    expect(window).not.toContain('<video');
    const camera = show({
      background: {
        kind: 'input',
        inputId: 'i',
        name: 'Placeholder camera',
        device: 'Placeholder device',
        fit: 'fit',
        startedAt: 1,
      },
    });
    const behind = view(place(), { kind: 'slides' }, camera);
    expect(behind).toContain('data-preview-behind="named"');
    expect(behind).toContain('Placeholder camera');
    expect(behind).not.toContain('<video');
  });

  it('is a picture for the eyes, its words beside it for everyone', () => {
    const html = view(place());
    expect(html).toMatch(
      /data-testid="pip-preview-picture"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-testid="pip-preview-picture"/u,
    );
    expect(html).toContain('data-a11y-picture');
    expect(html).toContain('data-testid="pip-preview-words"');
    expect(html).toContain(
      previewWords(
        'preview',
        place(),
        { kind: 'slides' },
        previewBehind(show(), DEFAULT_LIVE_GROUP_LOOK, true),
      ),
    );
  });
});

describe('the preview’s words', () => {
  const behind = previewBehind(show(), DEFAULT_LIVE_GROUP_LOOK, false);
  it('say where the box sits, its size and look, what it holds and what is behind it', () => {
    expect(
      previewWords(
        'preview',
        place(),
        { kind: 'slides' },
        previewBehind(show(), DEFAULT_LIVE_GROUP_LOOK, true),
      ),
    ).toBe(
      'Preview: in the bottom right, Medium, with a thin border and rounded corners, holding the slides, over what the screens show now (a picture).',
    );
    expect(
      previewWords(
        'preview',
        place({ corner: 'top-left', size: 'small', border: false, rounded: false }),
        { kind: 'media', mediaId: 'm', media: 'video', name: 'Placeholder clip.webm' },
        behind,
      ),
    ).toBe(
      'Preview: in the top left, Small, with no border and square corners, holding “Placeholder clip.webm”, over what the screens show now (a picture and a slide).',
    );
    expect(
      previewWords('preview', place({ corner: null, x: 0.4, y: 0.2 }), { kind: 'none' }, behind),
    ).toContain('where it was dragged (40% across, 20% down)');
  });

  it('say a camera or a window shows by its name, and when black-out or the Wallpaper covers the box', () => {
    expect(previewWords('preview', place(), { kind: 'input', name: 'Placeholder input' }, behind)).toContain(
      'holding the video input “Placeholder input”',
    );
    expect(
      previewWords('preview', place(), { kind: 'window', name: 'Placeholder meeting' }, behind),
    ).toContain('The preview opens no camera and captures no window: they show here by name.');
    const covered = previewBehind(show({}, { blackout: true }), DEFAULT_LIVE_GROUP_LOOK, false);
    expect(previewWords('preview', place(), { kind: 'slides' }, covered)).toContain(
      'Black-out is on now: the screens show the box once it is off.',
    );
  });

  it('in the section: where the next box goes, or the box up now', () => {
    expect(previewWords('next', place(), { kind: 'none' }, behind)).toMatch(
      /^The next box: in the bottom right, Medium/u,
    );
    expect(previewWords('now', place(), { kind: 'slides' }, behind)).toMatch(
      /^The box now: in the bottom right/u,
    );
  });
});

describe('the preview sends nothing to the screens or the stream', () => {
  const calls: string[] = [];
  const recorder = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_t, key) => recorder(`${path}.${String(key)}`),
      apply: () => {
        calls.push(path);
        return Promise.resolve(null);
      },
    });
  const g = globalThis as { window?: unknown };
  let before: unknown;
  beforeEach(() => {
    calls.length = 0;
    before = g.window;
    g.window = { drashti: recorder('drashti') };
  });
  afterEach(() => {
    g.window = before;
  });

  it('drawing it and changing its choices asks Drashti for nothing', () => {
    for (const p of PLACES) for (const kind of ['slides', 'none'] as const) view(p, { kind });
    view(place(), { kind: 'input', name: 'Placeholder input' });
    view(place(), { kind: 'window', name: 'Placeholder meeting' });
    expect(calls).toEqual([]);
  });

  it('its parts use no command, no camera and no window capture', () => {
    const files = import.meta.glob<string>(['./PipPreview.tsx', './pip-preview.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(files).sort()).toEqual(['./PipPreview.tsx', './pip-preview.ts']);
    for (const [file, raw] of Object.entries(files)) {
      // Its code, not its comments (which say what it does not use, and why).
      const source = raw.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
      for (const banned of [
        /engine\.dispatch/u,
        /from '\.\/actions'/u,
        /placeBox|savePlace/u,
        /getUserMedia|getDisplayMedia/u,
        /render\/video-input'/u,
        /LiveWindowView|live-window'/u,
        /InputPicture/u,
        /PipBox|PipSourcePicture/u,
      ])
        expect(source, `${file} ${String(banned)}`).not.toMatch(banned);
    }
  });
});
