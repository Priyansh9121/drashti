import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckSlide } from '../../shared/deck';
import { deckAfterEdit } from '../../shared/deck-edit-motion';
import { deckFromJson } from '../../shared/deck-schema';
import { documentPageFromJson } from '../../shared/document-page';
import { IPC } from '../../shared/ipc';
import type { TextElement } from '../../shared/model';
import { editDocSchema, type EditSlidesResult, type SaveSlidesResult } from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import type { SourceReader } from '../documents/source-reader';
import { sourceWrite } from '../documents/source-write';
import * as nativeImport from '../import/deck/native-deck-import';
import { MediaStore } from '../import/media-store';
import { OriginalsStore } from '../import/originals-store';
import { makeTestDeck, placeholderDeckMedia, type TestDeckSlide } from '../import/testing/make-deck';
import { nativeSourceReader } from '../import/testing/native-source-reader';
import { originalWorld } from '../import/testing/original-fixture';
import { Revisions } from './revisions';
import { registerSlidesIpc } from './slides-ipc';
import { themeLook } from './themes';

/*
 * W6's review N4 (Session 57): a PowerPoint deck slide imported before alpha.17 plays the clips of PowerPoint's movie
 * (`deck.steps`) and has no `deck.motion`. Edit slides reads its clicks and transition from the .pptx Drashti kept with
 * the deck, as alpha.17's import reads them, so the edited slide keeps its clicks. A Keynote deck's slide, a slide
 * whose kept file is missing, and one whose clicks don't match its clips keep today's behaviour. Generated
 * placeholder decks only, through the editor's real open and save handlers.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
}));
beforeEach(() => handlers.clear());

type World = ReturnType<typeof originalWorld>;
type Opened = Extract<EditSlidesResult, { ok: true }>;

const INCH = 914_400;
const WORDS = 'Placeholder words before the clicks';
const CLICK_WORDS = 'Placeholder words of the clicks';
const REVISED = 'Placeholder words revised';

type Shape = TestDeckSlide['shapes'][number];
const WORDS_BOX: Shape = {
  id: 2,
  type: 'text',
  name: 'Placeholder words',
  x: INCH,
  y: INCH,
  w: 10 * INCH,
  h: 1.5 * INCH,
  paras: [{ text: WORDS, size: 36, color: 'FFFFFF' }],
};
const CLICK_BOX: Shape = {
  id: 3,
  type: 'text',
  name: 'Placeholder click words',
  x: INCH,
  y: 4 * INCH,
  w: 10 * INCH,
  h: INCH,
  paras: [{ text: CLICK_WORDS, size: 28, color: 'FFFFFF' }],
};

/** One slide: a fade transition, its words, and a box that fades in on the first click and out on the second. */
const DECK: TestDeckSlide[] = [
  {
    key: 'old-clicks',
    bg: '204060',
    transition: { kind: 'fade', dur: 400 },
    notes: 'Placeholder notes',
    shapes: [WORDS_BOX, CLICK_BOX],
    effects: [
      { kind: 'fade', target: 3, dur: 500, start: 'click' },
      { kind: 'exit-fade', target: 3, dur: 300, start: 'click' },
    ],
  },
];

function register(w: World, presentations: PresentationRepo, reader: SourceReader = nativeSourceReader) {
  registerSlidesIpc({
    db: w.db,
    presentations,
    revisions: new Revisions(),
    settings: new SettingsRepo(w.db),
    fromOperator: () => true,
    mayPrepareSource: () => true,
    sourceReader: reader,
    sourceWrite: sourceWrite(w.db),
    lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
    changed: () => undefined,
  });
}

async function open(id: string): Promise<Opened> {
  const handler = handlers.get(IPC.library.slidesForEdit);
  if (!handler) throw new Error('The editor-open handler was not registered.');
  const result = await (handler({}, id) as EditSlidesResult | Promise<EditSlidesResult>);
  if (!result.ok) throw new Error(result.message);
  expect(editDocSchema.safeParse(result.doc).success, 'the prepared document stays valid').toBe(true);
  return result;
}

async function save(id: string, opened: Opened): Promise<SaveSlidesResult> {
  const handler = handlers.get(IPC.library.saveSlides);
  if (!handler) throw new Error('The editor-save handler was not registered.');
  return await (handler({}, id, opened.doc, opened.stamp, false) as
    SaveSlidesResult | Promise<SaveSlidesResult>);
}

/** The generated deck kept as an original, as an import keeps it, and placeholder media for its clips. */
async function kept(w: World, slides: readonly TestDeckSlide[], name: string) {
  const bytes = makeTestDeck(slides, placeholderDeckMedia());
  const file = join(w.root, `${name}.pptx`);
  writeFileSync(file, bytes);
  const originals = new OriginalsStore(w.db, w.mediaDir, { freeBytes: () => 1024 ** 4 });
  const media = new MediaStore(w.db, { dir: w.mediaDir, freeBytes: () => 1024 ** 4 });
  const staged = await originals.stage(file, 'pptx');
  if (!staged.ok) throw new Error(staged.message);
  originals.register(staged.original);
  const made = (label: string, kind: 'video' | 'image') =>
    media.addMissing(join(w.root, `${name} ${label}.${kind === 'video' ? 'mp4' : 'png'}`), kind, {
      kind: 'drashti',
      path: file,
    });
  // The clips of PowerPoint's movie, one per step (coming in, then each click), each with its last frame.
  const clips = (count: number): DeckSlide['steps'] =>
    Array.from({ length: count }, (_, n) => ({
      clipId: made(`step ${String(n)}`, 'video'),
      clipMs: 600,
      ...(n === 0 ? { transitionMs: 400 } : {}),
      lastId: made(`last ${String(n)}`, 'image'),
    }));
  return { bytes, file, staged, made, clips };
}

const picture = (mediaId: string) => ({
  id: randomUUID(),
  kind: 'image' as const,
  mediaId,
  fit: 'fit' as const,
  frame: { x: 0, y: 0, width: 1280, height: 720 },
});

/**
 * The deck as alpha.16 stored it: its kept .pptx, and its one slide's clips (one per step: coming in, then each
 * click), its last frame as the slide's picture, and no motion of its own.
 */
async function oldDeck(
  w: World,
  options: { steps?: number; keynote?: boolean; withoutFile?: boolean; reader?: SourceReader } = {},
) {
  const { bytes, file, staged, clips } = await kept(w, DECK, 'Placeholder old clicks');
  if (options.withoutFile) rmSync(staged.file);
  const steps = clips(options.steps ?? 3);
  const deck: DeckSlide = { transition: { name: 'p:fade', durationMs: 400 }, steps, media: [] };
  const last = steps.at(-1)?.lastId;
  if (!last) throw new Error('The generated clips are missing.');
  // A Keynote deck imported by alpha.17 keeps the PowerPoint copy Keynote saved of it: its slides name that copy,
  // never the presentation's own file (a .key).
  const keynote = createHash('sha256').update('Placeholder Keynote file').digest('hex');
  const presentations = new PresentationRepo(w.db);
  const id = presentations.insert({
    libraryId: presentations.ensureLibrary('Placeholder old deck tests'),
    name: 'Placeholder old clicks',
    width: 1280,
    height: 720,
    source: {
      kind: 'pictures',
      path: options.keynote ? join(w.root, 'Placeholder old clicks.key') : file,
      ref: null,
      importedAt: null,
    },
    sourceHash: options.keynote ? keynote : staged.original.sha256,
    groups: [
      {
        name: '',
        slides: [
          {
            documentPage: { sha256: staged.original.sha256, ext: 'pptx', page: 0 },
            deck,
            elements: [picture(last)],
          },
        ],
      },
    ],
  });
  register(w, presentations, options.reader);
  return { id, deck, presentations, file, bytes };
}

/** One slide with a video that starts at the first click, with words fading in beside it (W6's review N4, HIGH-1). */
const VIDEO_DECK: TestDeckSlide[] = [
  {
    key: 'old-video',
    bg: '204060',
    transition: { kind: 'fade', dur: 400 },
    notes: 'Placeholder notes',
    shapes: [
      WORDS_BOX,
      CLICK_BOX,
      {
        id: 4,
        type: 'video',
        name: 'Placeholder video',
        x: 7 * INCH,
        y: INCH,
        w: 4 * INCH,
        h: 2.25 * INCH,
        media: 'clip1',
        poster: 'poster1',
      },
    ],
    effects: [
      { kind: 'play', target: 4, dur: 5000, start: 'click' },
      { kind: 'fade', target: 3, dur: 500, start: 'with' },
    ],
  },
];

/**
 * The video deck with two slides on its one page: one as alpha.16 stored it (its video an element of no shape of the
 * deck's), one as alpha.17 stores a slide it keeps as video (its video element names its shape, `sourceShapeId`).
 */
async function videoDeck(w: World) {
  const { file, staged, made, clips } = await kept(w, VIDEO_DECK, 'Placeholder old video');
  const video = made('video', 'video');
  const media: DeckSlide['media'] = [
    {
      kind: 'video',
      mediaId: video,
      box: { x: 0.525, y: 0.1333, w: 0.3, h: 0.3 },
      loop: false,
      volume: 1,
      start: { step: 1, offsetMs: 0 },
    },
  ];
  const element = (own: boolean) => ({
    id: randomUUID(),
    kind: 'video' as const,
    frame: { x: 672, y: 96, width: 384, height: 216 },
    mediaId: video,
    fit: 'stretch' as const,
    ...(own ? { sourceShapeId: '4' } : {}),
  });
  const older: DeckSlide = { transition: { name: 'p:fade', durationMs: 400 }, steps: clips(2), media };
  const newer: DeckSlide = { ...structuredClone(older) };
  const page = { sha256: staged.original.sha256, ext: 'pptx' as const, page: 0 };
  const presentations = new PresentationRepo(w.db);
  const id = presentations.insert({
    libraryId: presentations.ensureLibrary('Placeholder old deck tests'),
    name: 'Placeholder old video',
    width: 1280,
    height: 720,
    source: { kind: 'pictures', path: file, ref: null, importedAt: null },
    sourceHash: staged.original.sha256,
    groups: [
      {
        name: '',
        slides: [older, newer].map((deck, n) => ({
          documentPage: page,
          label: n === 0 ? 'Placeholder alpha.16 row' : 'Placeholder alpha.17 row',
          deck,
          elements: [picture(deck.steps.at(-1)?.lastId ?? video), element(n === 1)],
        })),
      },
    ],
  });
  register(w, presentations);
  const before = presentations.content(id);
  if (!before) throw new Error('The generated video deck was not stored.');
  return { id, older, newer, video, presentations, before };
}

/** A reader that adds keys of its own at every level of a page's clicks, and a sound it made up (MEDIUM-1). */
const JUNK = { placeholderExtra: 'Placeholder key of the reader’s own' };
const dirtyReader: SourceReader = async (request) => {
  const read = await nativeSourceReader(request);
  if (!read.ok) return read;
  return {
    ...read,
    pages: read.pages.map((page) => {
      const deck = page.deck;
      if (!deck?.motion) return page;
      const transition = deck.transition ?? { name: 'p:fade', durationMs: 400 };
      const dirty: DeckSlide = {
        ...deck,
        ...JUNK,
        motion: {
          ...deck.motion,
          ...JUNK,
          effects: deck.motion.effects.map((effect) => ({ ...effect, ...JUNK })),
        },
        transition: {
          ...transition,
          ...JUNK,
          soundId: 'placeholder-made-up-sound',
          ...(transition.nativeTransition
            ? { nativeTransition: { ...transition.nativeTransition, ...JUNK } }
            : {}),
        },
      };
      return { ...page, deck: dirty };
    }),
  };
};

const only = (opened: Opened) => {
  const slide = opened.doc.groups[0]?.slides[0];
  if (!slide) throw new Error('The prepared slide is missing.');
  return slide;
};

/** What the editor window does with the slide's first change of content (renderer/src/editor/source-conversion.ts). */
function editWords(opened: Opened, index = 0) {
  const slide = opened.doc.groups[0]?.slides[index];
  if (!slide) throw new Error('The prepared slide is missing.');
  const box = slide.elements.find(
    (element): element is TextElement => element.kind === 'text' && element.text.includes(WORDS),
  );
  if (!box) throw new Error('The prepared slide lost the deck’s own words.');
  box.text = REVISED;
  box.runs = [{ ...(box.runs?.[0] ?? {}), text: REVISED }];
  if (!slide.documentPage) throw new Error('The prepared slide lost its page of the original.');
  slide.documentPage = { ...slide.documentPage, edited: true };
  const deck = deckAfterEdit(slide.deck);
  if (deck) slide.deck = deck;
  else delete slide.deck;
}

describe('a deck slide imported before alpha.17 keeps its clicks through an edit', () => {
  it('reads the clicks and the transition from the kept PowerPoint file, and keeps them when the slide is edited', async () => {
    const w = originalWorld();
    try {
      const old = await oldDeck(w);
      const opened = await open(old.id);
      const prepared = only(opened);
      // Opening changes nothing that plays: its clips stay until an edit.
      expect(prepared.deck?.steps).toEqual(old.deck.steps);
      // Its clicks, as alpha.17's import reads them: exact, so the editor asks nothing before the first change.
      expect(prepared.deck?.motion?.approximate).toBe(false);
      expect(prepared.deck?.motion?.stepsMs).toHaveLength(3);
      expect(
        prepared.deck?.motion?.effects.map(({ shapeId, step, phase, kind }) => ({
          shapeId,
          step,
          phase,
          kind,
        })),
      ).toEqual([
        { shapeId: '3', step: 1, phase: 'in', kind: 'fade' },
        { shapeId: '3', step: 2, phase: 'out', kind: 'fade' },
      ]);
      expect(prepared.deck?.transition).toMatchObject({
        name: 'p:fade',
        durationMs: 400,
        nativeTransition: { kind: 'dissolve', durationMs: 400 },
      });
      const motion = structuredClone(prepared.deck?.motion);

      editWords(opened);
      expect(await save(old.id, opened)).toMatchObject({ ok: true });
      const row = old.presentations.content(old.id)?.slides[0];
      expect(documentPageFromJson(row?.document_page)?.edited).toBe(true);
      const saved = deckFromJson(row?.deck);
      // Drashti plays it from its shapes now, click by click, with the deck's own transition.
      expect(saved?.steps).toEqual([]);
      expect(saved?.motion).toEqual(motion);
      expect(saved?.transition).toMatchObject({ nativeTransition: { kind: 'dissolve', durationMs: 400 } });
      const elements = old.presentations.get(old.id)?.groups[0]?.slides[0]?.slide.elements ?? [];
      expect(
        elements.some((element) => element.kind === 'text' && element.text.includes(REVISED)),
        'the edit is saved',
      ).toBe(true);
      expect(
        elements.some((element) => element.sourceShapeId === '3' && element.kind === 'text'),
        'the box its clicks bring in and take out is on the saved slide',
      ).toBe(true);
      expect(readFileSync(old.file)).toEqual(old.bytes);
    } finally {
      w.clean();
    }
  });

  it('keeps the saved clips on a page that needs its still', async () => {
    const w = originalWorld();
    const prepare = nativeImport.prepareNativePptx;
    const prepareWithMissingMedia = vi
      .spyOn(nativeImport, 'prepareNativePptx')
      .mockImplementationOnce(async (...args) => {
        const result = await prepare(...args);
        const page = result?.pages.get(0);
        if (!page) throw new Error('The placeholder page was not prepared');
        page.needsStill = true;
        return result;
      });
    try {
      const old = await oldDeck(w);
      const prepared = only(await open(old.id));
      expect(
        prepared.elements.some((element) => element.kind === 'text' && element.text.includes(WORDS)),
      ).toBe(true);
      expect(prepared.deck).toEqual(old.deck);
    } finally {
      prepareWithMissingMedia.mockRestore();
      w.clean();
    }
  });

  it('keeps today’s behaviour when the kept file is missing', async () => {
    const w = originalWorld();
    try {
      const old = await oldDeck(w, { withoutFile: true });
      const opened = await open(old.id);
      expect(only(opened).deck).toEqual(old.deck);
      expect((opened.sourceIssues ?? []).join(' ')).toMatch(/original file of these slides is missing/u);
    } finally {
      w.clean();
    }
  });

  it('keeps today’s behaviour for a Keynote deck’s slide (its PowerPoint copy is not the deck itself)', async () => {
    const w = originalWorld();
    try {
      const old = await oldDeck(w, { keynote: true });
      const prepared = only(await open(old.id));
      expect(
        prepared.elements.some((element) => element.kind === 'text' && element.text.includes(WORDS)),
        'its words and shapes are still editable',
      ).toBe(true);
      expect(prepared.deck).toEqual(old.deck);
    } finally {
      w.clean();
    }
  });

  it('keeps today’s behaviour for a slide whose video alpha.16 stored, and keeps the clicks of one whose video is its own shape', async () => {
    const w = originalWorld();
    try {
      const old = await videoDeck(w);
      const opened = await open(old.id);
      const [older, newer] = opened.doc.groups[0]?.slides ?? [];
      // Its video names no shape of the deck's, so it couldn't take its poster's place after an edit: the slide keeps
      // its clips and no clicks of its own, and the editor asks first, as before (HIGH-1).
      expect(older?.deck).toEqual(old.older);
      // The same page's other slide, whose video is its own shape, has its clicks read, its video in place.
      expect(newer?.deck?.motion?.approximate).toBe(false);
      expect(
        newer?.deck?.motion?.effects.map(({ shapeId, step, phase, kind }) => ({
          shapeId,
          step,
          phase,
          kind,
        })),
      ).toEqual([{ shapeId: '3', step: 1, phase: 'in', kind: 'fade' }]);
      expect(newer?.elements.find((element) => element.kind === 'video')).toMatchObject({
        sourceShapeId: '4',
        mediaId: old.video,
      });

      editWords(opened, 1);
      expect(await save(old.id, opened)).toMatchObject({ ok: true });
      const after = old.presentations.content(old.id);
      const [olderRow, newerRow] = after?.slides ?? [];
      // The alpha.16 slide stays exactly as it was, its video too.
      expect(olderRow).toEqual(old.before.slides[0]);
      expect(after?.elements.filter((row) => row.slide_id === olderRow?.id)).toEqual(
        old.before.elements.filter((row) => row.slide_id === olderRow?.id),
      );
      // The edited one plays from its shapes with its clicks, and its video, which starts at the first click.
      const saved = deckFromJson(newerRow?.deck);
      expect(saved?.steps).toEqual([]);
      expect(saved?.motion?.effects).toHaveLength(1);
      expect(saved?.media).toEqual(old.newer.media);
      const elements = old.presentations.get(old.id)?.groups[0]?.slides[1]?.slide.elements ?? [];
      expect(elements.find((element) => element.kind === 'video')).toMatchObject({
        sourceShapeId: '4',
        mediaId: old.video,
      });
    } finally {
      w.clean();
    }
  });

  it('takes only a slide’s clicks from the reader: no keys of its own and no sound it made up', async () => {
    const w = originalWorld();
    try {
      const old = await oldDeck(w, { reader: dirtyReader });
      const opened = await open(old.id);
      const prepared = only(opened);
      expect(prepared.deck?.motion?.effects).toHaveLength(2);
      expect(JSON.stringify(prepared.deck)).not.toMatch(/placeholderExtra|placeholder-made-up-sound/u);
      expect(prepared.deck?.transition?.soundId).toBeUndefined();
      editWords(opened);
      expect(await save(old.id, opened)).toMatchObject({ ok: true });
      const row = old.presentations.content(old.id)?.slides[0];
      expect(deckFromJson(row?.deck)?.motion?.effects).toHaveLength(2);
      expect(row?.deck ?? '').not.toMatch(/placeholderExtra|placeholder-made-up-sound/u);
    } finally {
      w.clean();
    }
  });

  it('keeps today’s behaviour when the file’s clicks don’t match the slide’s clips', async () => {
    const w = originalWorld();
    try {
      const old = await oldDeck(w, { steps: 2 });
      const prepared = only(await open(old.id));
      expect(prepared.deck).toEqual(old.deck);
    } finally {
      w.clean();
    }
  });
});
