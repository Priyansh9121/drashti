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
import { sourceWrite } from '../documents/source-write';
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

/** One slide: a fade transition, its words, and a box that fades in on the first click and out on the second. */
const DECK: TestDeckSlide[] = [
  {
    key: 'old-clicks',
    bg: '204060',
    transition: { kind: 'fade', dur: 400 },
    notes: 'Placeholder notes',
    shapes: [
      {
        id: 2,
        type: 'text',
        name: 'Placeholder words',
        x: INCH,
        y: INCH,
        w: 10 * INCH,
        h: 1.5 * INCH,
        paras: [{ text: WORDS, size: 36, color: 'FFFFFF' }],
      },
      {
        id: 3,
        type: 'text',
        name: 'Placeholder click words',
        x: INCH,
        y: 4 * INCH,
        w: 10 * INCH,
        h: INCH,
        paras: [{ text: CLICK_WORDS, size: 28, color: 'FFFFFF' }],
      },
    ],
    effects: [
      { kind: 'fade', target: 3, dur: 500, start: 'click' },
      { kind: 'exit-fade', target: 3, dur: 300, start: 'click' },
    ],
  },
];

function register(w: World, presentations: PresentationRepo) {
  registerSlidesIpc({
    db: w.db,
    presentations,
    revisions: new Revisions(),
    settings: new SettingsRepo(w.db),
    fromOperator: () => true,
    mayPrepareSource: () => true,
    sourceReader: nativeSourceReader,
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

/**
 * The deck as alpha.16 stored it: its kept .pptx, and its one slide's clips (one per step: coming in, then each
 * click), its last frame as the slide's picture, and no motion of its own.
 */
async function oldDeck(w: World, options: { steps?: number; keynote?: boolean; withoutFile?: boolean } = {}) {
  const bytes = makeTestDeck(DECK, placeholderDeckMedia());
  const file = join(w.root, 'Placeholder old clicks.pptx');
  writeFileSync(file, bytes);
  const originals = new OriginalsStore(w.db, w.mediaDir, { freeBytes: () => 1024 ** 4 });
  const media = new MediaStore(w.db, { dir: w.mediaDir, freeBytes: () => 1024 ** 4 });
  const staged = await originals.stage(file, 'pptx');
  if (!staged.ok) throw new Error(staged.message);
  originals.register(staged.original);
  if (options.withoutFile) rmSync(staged.file);
  const count = options.steps ?? 3;
  const made = (label: string, kind: 'video' | 'image', n: number) =>
    media.addMissing(
      join(w.root, `Placeholder ${label} ${String(n)}.${kind === 'video' ? 'mp4' : 'png'}`),
      kind,
      {
        kind: 'drashti',
        path: file,
      },
    );
  const steps: DeckSlide['steps'] = Array.from({ length: count }, (_, n) => ({
    clipId: made('step', 'video', n),
    clipMs: 600,
    ...(n === 0 ? { transitionMs: 400 } : {}),
    lastId: made('last', 'image', n),
  }));
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
            elements: [
              {
                id: randomUUID(),
                kind: 'image',
                mediaId: last,
                fit: 'fit',
                frame: { x: 0, y: 0, width: 1280, height: 720 },
              },
            ],
          },
        ],
      },
    ],
  });
  register(w, presentations);
  return { id, deck, presentations, file, bytes };
}

const only = (opened: Opened) => {
  const slide = opened.doc.groups[0]?.slides[0];
  if (!slide) throw new Error('The prepared slide is missing.');
  return slide;
};

/** What the editor window does with the slide's first change of content (renderer/src/editor/source-conversion.ts). */
function editWords(opened: Opened) {
  const slide = only(opened);
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
