import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { documentPageFromJson } from '../../shared/document-page';
import type { DeckSlide } from '../../shared/deck';
import { IPC } from '../../shared/ipc';
import type { TextElement } from '../../shared/model';
import {
  editDocSchema,
  type EditSlide,
  type EditSlidesResult,
  type SaveSlidesResult,
  type SlidesSaved,
} from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { sourceWrite } from '../documents/source-write';
import { MediaStore } from '../import/media-store';
import { OriginalsStore } from '../import/originals-store';
import { originalWorld, PLACEHOLDER_WORDS } from '../import/testing/original-fixture';
import { nativeSourceReader } from '../import/testing/native-source-reader';
import { makeTestPptx } from '../import/testing/make-pptx';
import { Revisions } from './revisions';
import { editDocOf, rowOf } from './slides';
import { registerSlidesIpc } from './slides-ipc';
import { themeLook } from './themes';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
}));
beforeEach(() => handlers.clear());

type World = ReturnType<typeof originalWorld>;
type Opened = Extract<EditSlidesResult, { ok: true }>;

function register(w: World, presentations: PresentationRepo) {
  const published: string[][] = [];
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
    changed: (ids) => {
      published.push(ids);
    },
  });
  return published;
}

async function open(id: string): Promise<Opened> {
  const handler = handlers.get(IPC.library.slidesForEdit);
  if (!handler) throw new Error('The existing editor-open handler was not registered.');
  const result = await (handler({}, id) as EditSlidesResult | Promise<EditSlidesResult>);
  expect(result.ok, 'the real source editor opened successfully').toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(editDocSchema.safeParse(result.doc).success, 'preparation returns an existing valid EditDoc').toBe(
    true,
  );
  return result;
}

async function save(id: string, opened: Opened): Promise<SaveSlidesResult> {
  const handler = handlers.get(IPC.library.saveSlides);
  if (!handler) throw new Error('The existing editor-save handler was not registered.');
  return await (handler({}, id, opened.doc, opened.stamp, false) as
    SaveSlidesResult | Promise<SaveSlidesResult>);
}

function nativeSource(opened: Opened): TextElement {
  const boxes = opened.doc.groups
    .flatMap((group) => group.slides)
    .flatMap((slide) => slide.elements)
    .filter((element) => element.kind === 'text');
  const box = boxes.find((element) => element.text.includes(PLACEHOLDER_WORDS));
  expect(box, 'native words must come from real PDF preparation, never a seeded replacement').toBeDefined();
  if (!box) throw new Error('The real PDF preparation did not expose the generated source words.');
  return box;
}

function originalsUnchanged(w: World) {
  expect(readFileSync(w.source)).toEqual(w.bytes);
  expect(readFileSync(w.owned)).toEqual(w.bytes);
}

/** A genuine retained source and realistic stored baking metadata, with no clip playback. */
async function bakedSource(w: World, editedFirst = false) {
  const words = 'Placeholder copied animated source';
  const bytes = makeTestPptx([{ text: words, color: '204060', animated: true }]);
  const file = join(w.root, 'Placeholder copied animated source.pptx');
  writeFileSync(file, bytes);
  const originals = new OriginalsStore(w.db, w.mediaDir, { freeBytes: () => 1024 ** 4 });
  const media = new MediaStore(w.db, { dir: w.mediaDir, freeBytes: () => 1024 ** 4 });
  const staged = await originals.stage(file, 'pptx');
  if (!staged.ok) throw new Error(staged.message);
  originals.register(staged.original);
  const clips = [0, 1].map((index) =>
    media.addMissing(join(w.root, `Placeholder step ${String(index)}.mp4`), 'video', {
      kind: 'drashti',
      path: file,
    }),
  );
  const lasts = [0, 1].map((index) =>
    media.addMissing(join(w.root, `Placeholder final ${String(index)}.png`), 'image', {
      kind: 'drashti',
      path: file,
    }),
  );
  const firstClip = clips[0],
    nextClip = clips[1],
    firstLast = lasts[0],
    nextLast = lasts[1];
  if (!firstClip || !nextClip || !firstLast || !nextLast)
    throw new Error('The generated baked media ids are missing.');
  const deck: DeckSlide & { placeholderFuture: { label: string; version: number } } = {
    transition: { name: 'Placeholder source fade', durationMs: 100 },
    steps: [
      { clipId: firstClip, clipMs: 250, lastId: firstLast },
      { clipId: nextClip, clipMs: 350, lastId: nextLast },
    ],
    media: [
      {
        kind: 'video',
        mediaId: nextClip,
        box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        loop: false,
        volume: 0,
        start: { step: 1, offsetMs: 0 },
      },
    ],
    placeholderFuture: { label: 'Placeholder source metadata', version: 1 },
  };
  const presentations = new PresentationRepo(w.db);
  const ref = { sha256: staged.original.sha256, ext: 'pptx' as const, page: 0 };
  const look = themeLook({ ...DEFAULT_THEME }, 1280, 720);
  const operatorText: TextElement = {
    id: randomUUID(),
    kind: 'text',
    text: 'Placeholder operator edit of the first occurrence',
    lang: 'en',
    frame: { x: 80, y: 80, width: 900, height: 160 },
    style: look.style,
  };
  const id = presentations.insert({
    libraryId: presentations.ensureLibrary('Placeholder retained deck tests'),
    name: 'Placeholder copied animated source',
    width: 1280,
    height: 720,
    source: { kind: 'pictures', path: file, ref: null, importedAt: null },
    sourceHash: staged.original.sha256,
    groups: [
      {
        name: '',
        slides: [
          ...(editedFirst
            ? [
                {
                  documentPage: { ...ref, edited: true, width: 1280, height: 720 },
                  label: 'Placeholder edited occurrence',
                  elements: [operatorText],
                },
              ]
            : []),
          {
            documentPage: ref,
            label: 'Placeholder baked occurrence',
            deck,
            elements: [
              {
                id: randomUUID(),
                kind: 'image',
                mediaId: nextLast,
                fit: 'fit',
                frame: { x: 0, y: 0, width: 1280, height: 720 },
              },
            ],
          },
        ],
      },
    ],
  });
  const before = presentations.content(id);
  if (!before) throw new Error('The generated retained deck was not stored.');
  return { words, bytes, file, owned: staged.file, ref, deck, presentations, id, before };
}

const copiedSlide = (slide: Opened['doc']['groups'][number]['slides'][number]) => ({
  ...structuredClone(slide),
  id: randomUUID(),
  elements: slide.elements.map((element) => ({ ...structuredClone(element), id: randomUUID() })),
  cues: slide.cues.map((cue) => ({ ...cue, id: randomUUID() })),
});

describe('imported editor provenance and legacy safety', () => {
  for (const excluded of [false, true]) {
    it(`saves a ${excluded ? 'skipped visible' : 'new empty'} master without converting source playback`, async () => {
      const w = originalWorld();
      try {
        const source = await bakedSource(w);
        if (excluded) {
          const savedPage = source.before.slides[0];
          if (!savedPage) throw new Error('Missing generated baked page.');
          savedPage.editor_design = JSON.stringify({ skipMaster: true });
          source.presentations.setContent(source.before);
        }
        const before = source.presentations.content(source.id);
        register(w, source.presentations);
        const opened = await open(source.id);
        opened.doc.master = {
          id: randomUUID(),
          label: 'Placeholder master',
          notes: '',
          background: excluded ? '#123456' : null,
          darken: null,
          enabled: true,
          transition: null,
          autoAdvanceMs: null,
          macroId: null,
          elements: [],
          cues: [],
        };
        expect(
          await save(source.id, opened),
          'noncontributing master must preserve baked playback',
        ).toMatchObject({ ok: true });
        const after = source.presentations.content(source.id);
        expect(after?.slides).toEqual(before?.slides);
        expect(after?.elements).toEqual(before?.elements);
        expect(readFileSync(source.file)).toEqual(source.bytes);
        expect(readFileSync(source.owned)).toEqual(source.bytes);
      } finally {
        w.clean();
      }
    });
  }
  it('keeps an untouched PDF playback canvas when only the document default changes', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      const presentations = new PresentationRepo(w.db);
      const before = presentations.get(imported.id)?.groups[0]?.slides[0]?.slide;
      register(w, presentations);
      const opened = await open(imported.id);
      nativeSource(opened);
      opened.doc.width = 1600;
      opened.doc.height = 900;
      expect(await save(imported.id, opened)).toMatchObject({ ok: true });
      const after = presentations.get(imported.id)?.groups[0]?.slides[0]?.slide;
      expect(after, 'default dimensions cannot stretch unchanged source playback').toEqual(before);
      const stored = presentations.content(imported.id)?.slides[0];
      expect(documentPageFromJson(stored?.document_page)?.edited).not.toBe(true);
      originalsUnchanged(w);
    } finally {
      w.clean();
    }
  });

  it('saves master notes and guides without converting an animated source or changing its exact deck and Undo snapshot', async () => {
    const w = originalWorld();
    try {
      const source = await bakedSource(w);
      const look = themeLook({ ...DEFAULT_THEME }, 1280, 720);
      const master: EditSlide = {
        id: randomUUID(),
        label: 'Placeholder master',
        notes: 'Placeholder master notes',
        background: '#182430',
        darken: null,
        enabled: true,
        transition: null,
        autoAdvanceMs: null,
        macroId: null,
        elements: [
          {
            id: randomUUID(),
            kind: 'text',
            text: 'Placeholder master words',
            lang: 'en',
            frame: { x: 40, y: 20, width: 320, height: 80 },
            style: look.style,
          },
        ],
        cues: [],
        guides: { x: [80], y: [60] },
      };
      source.presentations.setContent({ ...source.before, editorMaster: JSON.stringify(master) });
      const before = source.presentations.content(source.id);
      if (!before) throw new Error('The generated source with its master is missing.');
      const sourceBefore = w.db
        .prepare('SELECT source_kind, source_path, source_hash FROM presentations WHERE id = ?')
        .get(source.id);
      const revisions = new Revisions();
      const keep = vi.spyOn(revisions, 'keep');
      const published: string[][] = [];
      const saved: SlidesSaved[] = [];
      registerSlidesIpc({
        db: w.db,
        presentations: source.presentations,
        revisions,
        settings: new SettingsRepo(w.db),
        fromOperator: () => true,
        mayPrepareSource: () => true,
        sourceReader: nativeSourceReader,
        sourceWrite: sourceWrite(w.db),
        lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
        changed: (ids) => {
          published.push(ids);
        },
        saved: (event) => {
          saved.push(event);
        },
      });
      const opened = await open(source.id);
      const original = opened.doc.groups[0]?.slides[0];
      expect(
        original?.deck,
        'the real prepared page must retain its baked source before this metadata save',
      ).toBeDefined();
      expect(
        original?.elements
          .filter((element) => element.kind === 'text')
          .map((element) => element.text)
          .join('\n'),
      ).toContain(source.words);
      const openedMaster = opened.doc.master;
      if (!openedMaster) throw new Error('The actual registered open did not expose the stored master.');
      const expectedMaster = {
        ...structuredClone(openedMaster),
        notes: 'Placeholder revised master notes',
        guides: { x: [160], y: [120] },
      };
      // Metadata only: the master background, elements, styles, cues and every
      // source-page object stay as opened; no conversion approval is requested.
      openedMaster.notes = expectedMaster.notes;
      openedMaster.guides = expectedMaster.guides;
      expect(editDocSchema.safeParse(opened.doc).success).toBe(true);
      const result = await save(source.id, opened);
      expect(
        result,
        'master notes/guides do not change rendered source content or require conversion',
      ).toMatchObject({ ok: true });
      if (!result.ok) throw new Error(result.message);
      const after = source.presentations.content(source.id);
      if (!after) throw new Error('The saved source presentation is missing.');
      expect({ ...after, editorMaster: before.editorMaster }).toEqual(before);
      expect(after.slides[0]?.deck).toBe(before.slides[0]?.deck);
      expect(documentPageFromJson(after.slides[0]?.document_page)?.edited).not.toBe(true);
      expect(editDocOf(after, opened.doc.name).doc.master).toEqual(expectedMaster);
      expect(
        w.db
          .prepare('SELECT source_kind, source_path, source_hash FROM presentations WHERE id = ?')
          .get(source.id),
      ).toEqual(sourceBefore);
      expect(keep).toHaveBeenCalledTimes(1);
      expect(published).toEqual([[source.id]]);
      expect(saved).toEqual([
        { presentationId: source.id, name: opened.doc.name, revisionId: result.revisionId },
      ]);
      const undo = revisions.take(result.revisionId);
      expect(undo).toEqual([before]);
      expect(revisions.take(result.revisionId)).toBeNull();
      const restore = undo?.[0];
      if (!restore) throw new Error('The normal save did not keep its Undo snapshot.');
      source.presentations.setContent(restore);
      expect(source.presentations.content(source.id)).toEqual(before);
      expect(readFileSync(source.file)).toEqual(source.bytes);
      expect(readFileSync(source.owned)).toEqual(source.bytes);
    } finally {
      w.clean();
    }
  });

  it('keeps allowed transition edits and unknown source deck data when an unconverted baked page is copied', async () => {
    const w = originalWorld();
    try {
      const source = await bakedSource(w);
      const published = register(w, source.presentations);
      const opened = await open(source.id);
      const group = opened.doc.groups[0],
        original = group?.slides[0];
      if (!group || !original?.deck) throw new Error('The generated source baked page is missing.');
      expect(
        original.elements
          .filter((element) => element.kind === 'text')
          .map((element) => element.text)
          .join('\n'),
      ).toContain(source.words);
      const copy = copiedSlide(original);
      if (!copy.deck) throw new Error('The source copy lost its baked metadata during fixture setup.');
      const drashti: NonNullable<DeckSlide['drashti']> = {
        transition: { kind: 'dissolve', durationMs: 600 },
        mode: 'instead',
      };
      const stepTransitions: NonNullable<DeckSlide['stepTransitions']> = {
        1: { transition: { kind: 'slide', durationMs: 450 }, mode: 'over' },
      };
      copy.deck.drashti = drashti;
      copy.deck.stepTransitions = stepTransitions;
      group.slides.push(copy);
      expect(editDocSchema.safeParse(opened.doc).success).toBe(true);
      const result = await save(source.id, opened);
      expect(result.ok, 'editing Drashti’s transition metadata must not require source conversion').toBe(
        true,
      );
      if (!result.ok) throw new Error(result.message);
      const after = source.presentations.content(source.id);
      expect(after?.slides).toHaveLength(2);
      expect(after?.slides[0]).toEqual(source.before.slides[0]);
      expect(after?.elements.filter((element) => element.slide_id === source.before.slides[0]?.id)).toEqual(
        source.before.elements,
      );
      const stored = after?.slides[1];
      expect(stored?.deck).not.toBeNull();
      const savedDeck = JSON.parse(stored?.deck ?? 'null') as
        (DeckSlide & { placeholderFuture?: unknown }) | null;
      expect(savedDeck?.drashti).toEqual(drashti);
      expect(savedDeck?.stepTransitions).toEqual(stepTransitions);
      expect(savedDeck?.steps).toEqual(source.deck.steps);
      expect(savedDeck?.media).toEqual(source.deck.media);
      expect(savedDeck?.placeholderFuture).toEqual(source.deck.placeholderFuture);
      expect(documentPageFromJson(stored?.document_page)).toMatchObject(source.ref);
      expect(documentPageFromJson(stored?.document_page)?.edited).not.toBe(true);
      expect(published).toEqual([[source.id]]);
      expect(readFileSync(source.file)).toEqual(source.bytes);
      expect(readFileSync(source.owned)).toEqual(source.bytes);
    } finally {
      w.clean();
    }
  });

  it('matches a copied baked occurrence to its own semantic baseline when an edited occurrence of the same source page comes first', async () => {
    const w = originalWorld();
    try {
      const source = await bakedSource(w, true);
      register(w, source.presentations);
      const opened = await open(source.id);
      const group = opened.doc.groups[0],
        baked = group?.slides[1];
      if (!group || !baked?.deck) throw new Error('The second source occurrence is not baked.');
      expect(group.slides[0]?.documentPage).toMatchObject({ ...source.ref, edited: true });
      expect(group.slides[0]?.deck).toBeUndefined();
      expect(baked.documentPage?.edited).not.toBe(true);
      expect(
        baked.elements
          .filter((element) => element.kind === 'text')
          .map((element) => element.text)
          .join('\n'),
      ).toContain(source.words);
      group.slides.push(copiedSlide(baked));
      expect(editDocSchema.safeParse(opened.doc).success).toBe(true);
      const result = await save(source.id, opened);
      expect(result.ok, 'the genuine unchanged baked copy has a matching prepared occurrence').toBe(true);
      if (!result.ok) throw new Error(result.message);
      const after = source.presentations.content(source.id);
      expect(after?.slides).toHaveLength(3);
      expect(after?.slides.slice(0, 2)).toEqual(source.before.slides);
      for (const row of source.before.slides)
        expect(after?.elements.filter((element) => element.slide_id === row.id)).toEqual(
          source.before.elements.filter((element) => element.slide_id === row.id),
        );
      const copy = after?.slides[2];
      expect(
        copy?.deck,
        'choosing the edited occurrence must not silently convert the baked copy',
      ).not.toBeNull();
      expect(documentPageFromJson(copy?.document_page)?.edited).not.toBe(true);
      expect(documentPageFromJson(copy?.document_page)).toMatchObject(source.ref);
      const copiedDeck = JSON.parse(copy?.deck ?? 'null') as
        (DeckSlide & { placeholderFuture?: unknown }) | null;
      expect(copiedDeck?.steps).toEqual(source.deck.steps);
      expect(copiedDeck?.media).toEqual(source.deck.media);
      expect(copiedDeck?.placeholderFuture).toEqual(source.deck.placeholderFuture);
      expect(readFileSync(source.file)).toEqual(source.bytes);
      expect(readFileSync(source.owned)).toEqual(source.bytes);
    } finally {
      w.clean();
    }
  });

  it('keeps the whole saved page when a real prepared image cannot be imported, with a reported failure and no unresolved media ids', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      expect(imported.summary.totals).toMatchObject({ imported: 1, failed: 0 });
      const presentations = new PresentationRepo(w.db);
      const before = presentations.content(imported.id);
      if (!before) throw new Error('The generated imported page is missing.');
      const expected = editDocOf(before, 'Placeholder original').doc.groups.flatMap(
        (group) => group.slides,
      )[0];
      expect(expected?.elements.some((element) => element.kind === 'image')).toBe(true);
      const revision = w.db
        .prepare('SELECT content_rev FROM presentations WHERE id = ?')
        .pluck()
        .get(imported.id);
      const published = register(w, presentations);
      // Import already succeeded. Only the later asset-store boundary fails:
      // real PDF parsing/extraction/raster generation remains untouched.
      const failedAsset = vi.spyOn(MediaStore.prototype, 'stage').mockResolvedValue({
        ok: false,
        issue: {
          severity: 'error',
          code: 'no-room',
          message: 'Placeholder: the generated prepared image could not be retained.',
          fix: null,
        },
      });
      try {
        const opened = await open(imported.id);
        expect(
          failedAsset,
          'real preparation produced an image and reached its asset-import boundary',
        ).toHaveBeenCalled();
        const page = opened.doc.groups.flatMap((group) => group.slides)[0];
        expect(
          page,
          'a failed asset import must preserve the entire saved canvas, including its background and source identity',
        ).toEqual(expected);
        for (const element of page?.elements ?? []) {
          if (element.kind !== 'image' && element.kind !== 'video') continue;
          expect(
            w.db.prepare('SELECT 1 FROM media WHERE id = ?').get(element.mediaId),
            'every displayed image resolves to actual retained media, not an extraction-local id',
          ).toBeDefined();
        }
        const issues = (opened.sourceIssues ?? []).join(' ');
        expect(issues).toMatch(/asset|picture|image|media|prepar/iu);
        expect(issues).toMatch(/fail|could not|unavailable|unchanged|kept/iu);
        expect(presentations.content(imported.id)).toEqual(before);
        expect(
          w.db.prepare('SELECT content_rev FROM presentations WHERE id = ?').pluck().get(imported.id),
        ).toBe(revision);
        expect(published).toEqual([]);
        originalsUnchanged(w);
      } finally {
        failedAsset.mockRestore();
      }
    } finally {
      w.clean();
    }
  });

  it('refuses a native source edit whose page identity was stripped, keeping exact stored playback and source bytes', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      expect(imported.summary.totals).toMatchObject({ imported: 1, failed: 0 });
      const presentations = new PresentationRepo(w.db);
      const before = presentations.content(imported.id);
      expect(before?.slides).toHaveLength(1);
      const revision = w.db
        .prepare('SELECT content_rev FROM presentations WHERE id = ?')
        .pluck()
        .get(imported.id);
      const published = register(w, presentations);
      const opened = await open(imported.id);
      const box = nativeSource(opened);
      const slide = opened.doc.groups.flatMap((group) => group.slides)[0];
      expect(slide?.documentPage).toMatchObject({ sha256: w.hash, ext: 'pdf', page: 0 });
      if (!slide) throw new Error('The source page is missing.');
      delete slide.documentPage;
      box.text = 'Placeholder revised source words';
      box.runs = [{ ...(box.runs?.[0] ?? {}), text: box.text }];
      expect(
        editDocSchema.safeParse(opened.doc).success,
        'the edit is schema-valid apart from its missing provenance',
      ).toBe(true);

      const result = await save(imported.id, opened);
      expect(result.ok, 'stripping provenance must not bypass the imported-page save policy').toBe(false);
      if (result.ok) throw new Error('The provenance-stripped source edit was incorrectly saved.');
      expect(result.message).toMatch(/source|original|document|imported|page|reopen/iu);
      expect(presentations.content(imported.id)).toEqual(before);
      expect(
        w.db.prepare('SELECT content_rev FROM presentations WHERE id = ?').pluck().get(imported.id),
      ).toBe(revision);
      expect(published).toEqual([]);
      originalsUnchanged(w);
    } finally {
      w.clean();
    }
  });

  it('saves a duplicated unedited prepared page with fresh ids and the same resolvable immutable source page', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      expect(imported.summary.totals).toMatchObject({ imported: 1, failed: 0 });
      const presentations = new PresentationRepo(w.db);
      const before = presentations.content(imported.id);
      expect(before?.slides).toHaveLength(1);
      const published = register(w, presentations);
      const opened = await open(imported.id);
      nativeSource(opened);
      const group = opened.doc.groups[0];
      const first = group?.slides[0];
      if (!group || !first) throw new Error('The generated PDF page is missing.');
      expect(first.documentPage).toMatchObject({ sha256: w.hash, ext: 'pdf', page: 0 });
      expect(first.documentPage?.edited).not.toBe(true);
      const copy = structuredClone(first);
      copy.id = randomUUID();
      copy.elements = copy.elements.map((element) => ({ ...element, id: randomUUID() }));
      copy.cues = copy.cues.map((cue) => ({ ...cue, id: randomUUID() }));
      group.slides.push(copy);
      expect(editDocSchema.safeParse(opened.doc).success, 'the duplicate has valid distinct editor ids').toBe(
        true,
      );

      const result = await save(imported.id, opened);
      expect(
        result.ok,
        'a valid copied page occurrence must not be refused only because its slide id is new',
      ).toBe(true);
      if (!result.ok) throw new Error(result.message);
      const after = presentations.content(imported.id);
      expect(after?.slides).toHaveLength(2);
      expect(new Set(after?.slides.map((slide) => slide.id)).size).toBe(2);
      const refs = (after?.slides ?? []).map((slide) => documentPageFromJson(slide.document_page));
      expect(refs.map((ref) => ({ sha256: ref?.sha256, ext: ref?.ext, page: ref?.page }))).toEqual([
        { sha256: w.hash, ext: 'pdf', page: 0 },
        { sha256: w.hash, ext: 'pdf', page: 0 },
      ]);
      const originalId = before?.slides[0]?.id;
      expect(after?.slides.find((slide) => slide.id === originalId)).toEqual(before?.slides[0]);
      expect(after?.elements.filter((element) => element.slide_id === originalId)).toEqual(
        before?.elements.filter((element) => element.slide_id === originalId),
      );
      const originals = new OriginalsStore(w.db, w.mediaDir);
      for (const ref of refs) {
        const original = originals
          .list()
          .find((entry) => entry.sha256 === ref?.sha256 && entry.ext === ref.ext);
        expect(original, 'each occurrence resolves to a registered retained original').toBeDefined();
        if (!original) throw new Error('The duplicated page has no retained original.');
        const file = await originals.resolve(original);
        expect(file).not.toBeNull();
        if (!file) throw new Error('The duplicated page original cannot be read.');
        expect(readFileSync(file)).toEqual(w.bytes);
      }
      const reopened = await open(imported.id);
      const pages = reopened.doc.groups.flatMap((entry) => entry.slides);
      expect(pages).toHaveLength(2);
      for (const page of pages)
        expect(
          page.elements
            .filter((element) => element.kind === 'text')
            .map((element) => element.text)
            .join('\n'),
        ).toContain(PLACEHOLDER_WORDS);
      expect(published).toEqual([[imported.id]]);
      originalsUnchanged(w);
    } finally {
      w.clean();
    }
  });

  it('preserves a legacy imported page with an operator overlay and explains why its older source mapping is ambiguous', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      expect(imported.summary.totals).toMatchObject({ imported: 1, failed: 0 });
      const presentations = new PresentationRepo(w.db);
      const initial = presentations.content(imported.id);
      const slideId = initial?.slides[0]?.id;
      if (!slideId) throw new Error('The generated imported slide is missing.');
      // A pre-17b library has no per-page origin. Model it without guessing any source object ids.
      w.db.prepare('UPDATE slides SET document_page = NULL WHERE id = ?').run(slideId);
      const legacy = presentations.content(imported.id);
      if (!legacy) throw new Error('The generated legacy presentation is missing.');
      const look = themeLook({ ...DEFAULT_THEME }, legacy.width, legacy.height);
      const overlay: TextElement = {
        id: randomUUID(),
        kind: 'text',
        text: 'Placeholder operator-added overlay',
        lang: 'en',
        frame: { x: 80, y: 80, width: 900, height: 160 },
        style: look.style,
      };
      legacy.elements.push({
        ...rowOf(overlay, overlay.id, slideId, undefined),
        position: legacy.elements.length,
      });
      presentations.setContent(legacy);
      const before = presentations.content(imported.id);
      if (!before) throw new Error('The generated legacy presentation cannot be read.');
      const expected = editDocOf(before, 'Placeholder original').doc.groups.flatMap(
        (group) => group.slides,
      )[0];
      const published = register(w, presentations);
      const opened = await open(imported.id);
      const page = opened.doc.groups.flatMap((group) => group.slides)[0];

      expect(page?.elements.find((element) => element.id === overlay.id)).toEqual(overlay);
      expect(
        page?.elements,
        'an ambiguous legacy canvas must not be silently rebuilt from the source',
      ).toEqual(expected?.elements);
      expect(page?.documentPage).toBeUndefined();
      expect((opened.sourceIssues ?? []).join(' ')).toMatch(/ambig|older|legacy|existing.{0,30}edit/iu);
      expect(presentations.content(imported.id)).toEqual(before);
      expect(published).toEqual([]);
      originalsUnchanged(w);
    } finally {
      w.clean();
    }
  });

  // alpha.15 words review: the older-import notice is for slides whose page of the original is unknown, never a
  // page added in the editor. New slide after an imported page (renderer/src/editor/ops.ts addSlideAfter) takes a
  // PDF page's paper size and nothing after a PowerPoint page; no page of the original either way.
  const olderImportNotice = (issues: readonly string[] | undefined) =>
    (issues ?? []).filter((issue) => /older import|which page of the original/iu.test(issue));
  const addBlankAfterFirst = (opened: Opened): EditSlide => {
    const group = opened.doc.groups[0];
    const page = group?.slides[0];
    if (!group || !page) throw new Error('The generated imported page is missing.');
    const blank: EditSlide = {
      id: randomUUID(),
      label: '',
      notes: '',
      background: null,
      darken: null,
      enabled: true,
      transition: null,
      autoAdvanceMs: null,
      macroId: null,
      elements: [],
      cues: [],
      ...(page.pageSize ? { pageSize: page.pageSize } : {}),
    };
    group.slides.splice(1, 0, blank);
    return blank;
  };

  it('gives a new PDF import no older-import notice once a blank page is added and saved', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      expect(imported.summary.totals).toMatchObject({ imported: 1, failed: 0 });
      const presentations = new PresentationRepo(w.db);
      register(w, presentations);
      const opened = await open(imported.id);
      expect(olderImportNotice(opened.sourceIssues)).toEqual([]);
      const blank = addBlankAfterFirst(opened);
      expect(blank.pageSize, 'a blank page after a PDF page takes its paper size').toBeDefined();
      expect(await save(imported.id, opened)).toMatchObject({ ok: true });

      const reopened = await open(imported.id);
      const pages = reopened.doc.groups.flatMap((group) => group.slides);
      expect(pages.map((page) => page.documentPage === undefined)).toEqual([false, true]);
      expect(pages[1]?.pageSize).toEqual(blank.pageSize);
      expect(olderImportNotice(reopened.sourceIssues)).toEqual([]);
      originalsUnchanged(w);
    } finally {
      w.clean();
    }
  });

  it('gives a new PowerPoint import no older-import notice once a blank slide is added and saved', async () => {
    const w = originalWorld();
    try {
      const file = join(w.root, 'Placeholder deck.pptx');
      writeFileSync(file, makeTestPptx([{ text: 'Placeholder deck words', color: '204060' }]));
      const originals = new OriginalsStore(w.db, w.mediaDir, { freeBytes: () => 1024 ** 4 });
      const staged = await originals.stage(file, 'pptx');
      if (!staged.ok) throw new Error(staged.message);
      originals.register(staged.original);
      const picture = new MediaStore(w.db, { dir: w.mediaDir, freeBytes: () => 1024 ** 4 }).addMissing(
        join(w.root, 'Placeholder deck page 1.png'),
        'image',
        { kind: 'drashti', path: file },
      );
      const presentations = new PresentationRepo(w.db);
      // A new import's page: its picture, and the page of its kept original.
      const id = presentations.insert({
        libraryId: presentations.ensureLibrary('Placeholder deck tests'),
        name: 'Placeholder deck',
        width: 1280,
        height: 720,
        source: { kind: 'pictures', path: file, ref: null, importedAt: null },
        sourceHash: staged.original.sha256,
        groups: [
          {
            name: '',
            slides: [
              {
                documentPage: { sha256: staged.original.sha256, ext: 'pptx', page: 0 },
                elements: [
                  {
                    id: randomUUID(),
                    kind: 'image',
                    mediaId: picture,
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
      const opened = await open(id);
      expect(olderImportNotice(opened.sourceIssues)).toEqual([]);
      const blank = addBlankAfterFirst(opened);
      expect(blank.pageSize, 'a blank slide after a PowerPoint page has no paper size of its own').toBeUndefined();
      expect(await save(id, opened)).toMatchObject({ ok: true });

      const reopened = await open(id);
      const pages = reopened.doc.groups.flatMap((group) => group.slides);
      expect(pages.map((page) => page.documentPage === undefined)).toEqual([false, true]);
      expect(olderImportNotice(reopened.sourceIssues)).toEqual([]);
    } finally {
      w.clean();
    }
  });
});
