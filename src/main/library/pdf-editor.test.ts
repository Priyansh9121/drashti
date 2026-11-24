import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import type { EditSlidesResult, SlidesSaved } from '../../shared/slide-edit';
import { editDocSchema } from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { sourceWrite } from '../documents/source-write';
import { makeTestPdf } from '../import/testing/make-pdf';
import { nativeSourceReader } from '../import/testing/native-source-reader';
import { originalWorld, PLACEHOLDER_WORDS } from '../import/testing/original-fixture';
import { isInside } from '../media/contained';
import { PdfCopySession } from './pdf-copy-session';
import { PdfEditor } from './pdf-editor';
import { Revisions } from './revisions';
import { registerSlidesIpc } from './slides-ipc';
import type { SlidesIpcController } from './slides-ipc';
import { themeLook } from './themes';

// Existing in-process registration transport: handler bodies/controller remain
// real. No import, extraction, source cache, provenance or writer is mocked.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
}));
beforeEach(() => handlers.clear());

type World = ReturnType<typeof originalWorld>;
type Opened = Extract<EditSlidesResult, { ok: true }>;

// originalWorld uses the real os.tmpdir function. Configure and verify its
// environment before it creates anything, so all data/cleanup stay inside WT.
function fixtureLocation(): () => void {
  const home = resolve(import.meta.dirname, '../../..', 'test-results', 'task-temp', 'pdf-editor');
  mkdirSync(home, { recursive: true });
  const keys = ['TMPDIR', 'TMP', 'TEMP'] as const;
  const before = keys.map((key) => ({ key, value: process.env[key] }));
  for (const key of keys) process.env[key] = home;
  if (resolve(tmpdir()) !== home) {
    for (const entry of before) {
      if (entry.value === undefined) Reflect.deleteProperty(process.env, entry.key);
      else process.env[entry.key] = entry.value;
    }
    throw new Error('The generated PDF fixture temp root must be inside this worktree.');
  }
  return () => {
    for (const entry of before) {
      if (entry.value === undefined) Reflect.deleteProperty(process.env, entry.key);
      else process.env[entry.key] = entry.value;
    }
  };
}

function stamp(w: World, id: string): string | null {
  const row = w.db
    .prepare('SELECT updated_at, content_rev FROM presentations WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { updated_at: string; content_rev: number } | undefined;
  return row ? row.updated_at + '#' + String(row.content_rev) : null;
}
function inode(file: string): { dev: bigint; ino: bigint; nlink: bigint } {
  const info = statSync(file, { bigint: true });
  return { dev: info.dev, ino: info.ino, nlink: info.nlink };
}

describe('real PDF editor copy source protection', () => {
  it('rejects an outside hardlink to the retained managed original after real preparation and validation', async () => {
    const restoreLocation = fixtureLocation();
    let w: World | undefined;
    let slides: SlidesIpcController | undefined;
    let editor: PdfEditor | undefined;
    try {
      w = originalWorld();
      const world = w;
      const fixtureHome = resolve(import.meta.dirname, '../../..', 'test-results', 'task-temp', 'pdf-editor');
      expect(isInside(realpathSync(fixtureHome), realpathSync(world.root))).toBe(true);
      const imported = await world.importPdf();
      expect(imported.summary.totals).toMatchObject({ imported: 1, failed: 0, presentations: 1, slides: 1 });
      const presentations = new PresentationRepo(world.db);
      const before = presentations.content(imported.id);
      const beforeStamp = stamp(world, imported.id);
      expect(before?.slides).toHaveLength(1);
      const published: string[][] = [];
      const saved: SlidesSaved[] = [];
      const revisions = new Revisions();
      const kept = vi.spyOn(revisions, 'keep'); // Observe real in-memory revision writes; no stub.
      slides = registerSlidesIpc({
        db: world.db,
        presentations,
        revisions,
        settings: new SettingsRepo(world.db),
        fromOperator: () => true,
        mayPrepareSource: () => true,
        sourceReader: nativeSourceReader,
        sourceWrite: sourceWrite(world.db),
        lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
        changed: (ids) => {
          published.push(ids);
        },
        saved: (change) => {
          saved.push(change);
        },
      });
      const registered = slides;
      const event = { sender: Object.assign(new EventEmitter(), { isDestroyed: () => false }) } as never;
      const open = handlers.get(IPC.library.slidesForEdit);
      if (!open) throw new Error('The real source editor-open handler was not registered.');
      const result = await (open(event, imported.id) as EditSlidesResult | Promise<EditSlidesResult>);
      expect(result.ok, 'real registered source preparation opens successfully').toBe(true);
      if (!result.ok) throw new Error(result.message);
      const opened: Opened = result;
      expect(editDocSchema.safeParse(opened.doc).success).toBe(true);
      expect(
        opened.doc.groups
          .flatMap((group) => group.slides)
          .flatMap((slide) => slide.elements)
          .some((element) => element.kind === 'text' && element.text.includes(PLACEHOLDER_WORDS)),
      ).toBe(true);
      expect(
        registered.documentForExport(imported.id, opened.doc, opened.stamp).ok,
        'use the real prepared-source validator, never a seeded trusted document',
      ).toBe(true);
      expect(presentations.content(imported.id)).toEqual(before);
      expect(stamp(world, imported.id)).toBe(beforeStamp);

      const chosen = join(world.root, 'chosen-output');
      mkdirSync(chosen);
      const alias = join(chosen, 'Placeholder retained-original alias.pdf');
      linkSync(world.owned, alias);
      const ownedBefore = inode(world.owned),
        aliasBefore = inode(alias);
      const externalBefore = inode(world.source);
      expect({ dev: aliasBefore.dev, ino: aliasBefore.ino }).toEqual({
        dev: ownedBefore.dev,
        ino: ownedBefore.ino,
      });
      expect({ dev: externalBefore.dev, ino: externalBefore.ino }).not.toEqual({
        dev: ownedBefore.dev,
        ino: ownedBefore.ino,
      });
      expect(isInside(realpathSync(world.mediaDir), realpathSync(alias))).toBe(false);
      expect(realpathSync(alias)).not.toBe(realpathSync(world.owned));
      const bytes = makeTestPdf([
        { width: 960, height: 540, color: [40, 80, 120], text: 'Placeholder copied output' },
      ]);
      expect(bytes).not.toEqual(world.bytes);
      const session = new PdfCopySession({
        open: () => {
          throw new Error('The unit hidden-session boundary must not open an Electron window.');
        },
        assetDirs: () => [],
        normalize: () => Promise.reject(new Error('No unit print operation is admitted.')),
      });
      // The only feature output stub: the hidden protocol returns generated PDF
      // bytes. Real plan/source resolution and the protected writer still run.
      const generated = vi.spyOn(session, 'run').mockResolvedValue(new Uint8Array(bytes));
      editor = new PdfEditor({
        db: world.db,
        mediaDir: world.mediaDir,
        session,
        allowed: () => true,
        stamp: (id) => stamp(world, id),
        validate: (...args) => registered.documentForExport(...args),
        chooseOutput: () => Promise.resolve(alias),
      });
      const copied = await editor.export(event, imported.id, opened.doc, opened.stamp);
      expect(generated).toHaveBeenCalledOnce();
      const plan = generated.mock.calls[0]?.[0];
      expect(plan, 'the real coordinator planned the unchanged retained source page').toBeDefined();
      if (!plan) throw new Error('The real coordinator did not plan the generated source.');
      expect(plan.pages).toEqual([{ kind: 'original', sourceId: world.hash, page: 0 }]);
      expect(plan.sources).toHaveLength(1);
      expect(plan.sources[0]?.data).toEqual(new Uint8Array(world.bytes));

      expect(copied.ok, 'an outside hardlink is still the managed original and must be refused').toBe(false);
      expect(readFileSync(alias)).toEqual(world.bytes);
      expect(readFileSync(world.owned)).toEqual(world.bytes);
      expect(readFileSync(world.source)).toEqual(world.bytes);
      expect(inode(alias)).toEqual(aliasBefore);
      expect(inode(world.owned)).toEqual(ownedBefore);
      expect(inode(world.source)).toEqual(externalBefore);
      expect(presentations.content(imported.id)).toEqual(before);
      expect(stamp(world, imported.id)).toBe(beforeStamp);
      expect(kept).not.toHaveBeenCalled();
      expect(published).toEqual([]);
      expect(saved).toEqual([]);
    } finally {
      try {
        await editor?.stop();
        slides?.cancelSourcePreparation();
        await slides?.drainSourcePreparation();
        w?.clean(); // Verified generated fixture root inside this worktree only.
      } finally {
        restoreLocation();
      }
    }
  });
});

describe('Make a slide… (alpha.21): a PDF page, or a part of it, as a Drashti slide', () => {
  /** The real imported generated PDF opened in the real editor validator, and a PdfEditor around fakes at its edges. */
  async function opened(many = false) {
    const restoreLocation = fixtureLocation();
    const world = originalWorld();
    let hash = world.hash;
    if (many) {
      const bytes = makeTestPdf([
        { width: 960, height: 540, color: [40, 80, 120], text: 'Placeholder first page' },
        { width: 540, height: 960, color: [80, 120, 40], text: 'Placeholder second page' },
      ]);
      writeFileSync(world.source, bytes);
      hash = createHash('sha256').update(bytes).digest('hex');
    }
    const imported = await world.importPdf(
      many
        ? {
            drawPdf: (_pdf, outDir) => {
              mkdirSync(outDir, { recursive: true });
              const file = join(outDir, 'page.png');
              writeFileSync(
                file,
                Buffer.from(
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                  'base64',
                ),
              );
              return Promise.resolve({
                ok: true as const,
                width: 1920,
                height: 1080,
                pages: [
                  { index: 0, file, notes: '' },
                  { index: 1, file, notes: '' },
                ],
                total: 2,
                failed: [],
              });
            },
          }
        : {},
    );
    const presentations = new PresentationRepo(world.db);
    const revisions = new Revisions();
    const kept = vi.spyOn(revisions, 'keep');
    const slides = registerSlidesIpc({
      db: world.db,
      presentations,
      revisions,
      settings: new SettingsRepo(world.db),
      fromOperator: () => true,
      mayPrepareSource: () => true,
      sourceReader: nativeSourceReader,
      sourceWrite: sourceWrite(world.db),
      lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
      changed: () => undefined,
      saved: () => undefined,
    });
    const event = { sender: Object.assign(new EventEmitter(), { isDestroyed: () => false }) } as never;
    const open = handlers.get(IPC.library.slidesForEdit);
    if (!open) throw new Error('The real source editor-open handler was not registered.');
    const result = await (open(event, imported.id) as EditSlidesResult | Promise<EditSlidesResult>);
    if (!result.ok) throw new Error(result.message);
    const session = new PdfCopySession({
      open: () => {
        throw new Error('The unit hidden-session boundary must not open an Electron window.');
      },
      assetDirs: () => [],
      normalize: () => Promise.reject(new Error('No unit print operation is admitted.')),
    });
    const printed = new Uint8Array(
      makeTestPdf([{ width: 960, height: 540, color: [40, 80, 120], text: 'Placeholder printed page' }]),
    );
    const run = vi.spyOn(session, 'run').mockResolvedValue(printed);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const drawPart = vi.fn(() => Promise.resolve({ ok: true as const, png }));
    const keepSlide = vi.fn((made: { name: string }) =>
      Promise.resolve({
        ok: true as const,
        presentationId: 'made-1',
        name: made.name,
        playlist: 'Placeholder list',
      }),
    );
    let allowed = true;
    // The stream on air or recording (Main's streaming.inUse()), and where a PDF copy is saved when one is asked for.
    let onAir = false;
    let output: string | null = null;
    const editor = new PdfEditor({
      db: world.db,
      mediaDir: world.mediaDir,
      session,
      allowed: () => allowed,
      onAir: () => onAir,
      stamp: (id) => stamp(world, id),
      validate: (...args) => slides.documentForExport(...args),
      chooseOutput: () =>
        output === null
          ? Promise.reject(new Error('Make a slide never asks for a file.'))
          : Promise.resolve(output),
      drawPart,
      keepSlide,
    });
    const slideId = result.doc.groups[0]?.slides[0]?.id ?? '';
    const request = (change: Record<string, unknown> = {}) => ({
      presentationId: imported.id,
      doc: result.doc,
      stamp: result.stamp,
      slideId,
      part: { x: 0, y: 0, w: 0.25, h: 0.5 },
      place: 'playlist',
      ...change,
    });
    const before = presentations.content(imported.id);
    return {
      world,
      hash,
      imported,
      presentations,
      before,
      kept,
      doc: result.doc,
      stamp: result.stamp,
      editor,
      event,
      run,
      printed,
      png,
      drawPart,
      keepSlide,
      request,
      refuse: () => {
        allowed = false;
      },
      /** The stream goes on air (or starts recording), or comes off. */
      goOnAir: (on = true) => {
        onAir = on;
      },
      /** Save a PDF copy… is answered with this file. */
      saveTo: (file: string) => {
        output = file;
      },
      clean: async () => {
        try {
          await editor.stop();
          slides.cancelSourcePreparation();
          await slides.drainSourcePreparation();
          world.clean();
        } finally {
          restoreLocation();
        }
      },
    };
  }

  it('carries crop-only source pages to the PDF copy without converting or dropping underlying content', async () => {
    const t = await opened();
    try {
      const page = t.doc.groups[0]?.slides[0];
      if (!page?.documentPage) throw new Error('Generated page missing');
      const crop = { x: 0.125, y: 0.25, w: 0.5, h: 0.5 };
      page.documentPage.crop = crop;
      t.saveTo(join(t.world.root, 'Placeholder cropped.pdf'));
      expect((await t.editor.export(t.event, t.imported.id, t.doc, t.stamp)).ok).toBe(true);
      expect(t.run.mock.calls[0]?.[0].pages).toEqual([{ kind: 'original', sourceId: t.hash, page: 0, crop }]);
      expect(readFileSync(t.world.source)).toEqual(t.world.bytes);
    } finally {
      await t.clean();
    }
  });

  it('prints that one page as it now looks, draws the part dragged out, and keeps it with its name and place', async () => {
    const t = await opened();
    try {
      const made = await t.editor.makeSlide(t.event, t.request());
      expect(made).toEqual({
        ok: true,
        presentationId: 'made-1',
        name: `${t.doc.name}, page 1 (part)`,
        playlist: 'Placeholder list',
      });
      // One page planned: the unchanged page from the retained original (a changed page would be printed natively).
      expect(t.run).toHaveBeenCalledOnce();
      expect(t.run.mock.calls[0]?.[0].pages).toEqual([{ kind: 'original', sourceId: t.hash, page: 0 }]);
      // Its part drawn from those bytes; the picture kept as a slide in the open playlist.
      expect(t.drawPart).toHaveBeenCalledOnce();
      expect(t.drawPart.mock.calls[0]?.slice(0, 2)).toEqual([t.printed, { x: 0, y: 0, w: 0.25, h: 0.5 }]);
      expect(t.keepSlide).toHaveBeenCalledWith(
        {
          png: t.png,
          name: `${t.doc.name}, page 1 (part)`,
          place: 'playlist',
        },
        expect.any(Function),
      );
      // The PDF's own presentation is not changed, and no revision is kept for it.
      expect(t.presentations.content(t.imported.id)).toEqual(t.before);
      expect(t.kept).not.toHaveBeenCalled();
      // The whole page into the library only: no "(part)".
      const whole = await t.editor.makeSlide(
        t.event,
        t.request({ part: { x: 0, y: 0, w: 1, h: 1 }, place: 'library' }),
      );
      expect(whole.ok && whole.name).toBe(`${t.doc.name}, page 1`);
      expect(t.keepSlide).toHaveBeenLastCalledWith(
        {
          png: t.png,
          name: `${t.doc.name}, page 1`,
          place: 'library',
        },
        expect.any(Function),
      );
    } finally {
      await t.clean();
    }
  });

  it('collects ordered parts across pages into one keep operation, printing each page only once', async () => {
    const t = await opened(true);
    try {
      const pages = t.doc.groups.flatMap((g) => g.slides);
      const first = pages[0];
      const second = pages[1];
      if (!first || !second) throw new Error('The generated PDF needs two pages.');
      const parts = [
        { slideId: second.id, part: { x: 0, y: 0, w: 1, h: 0.5 } },
        { slideId: first.id, part: { x: 0, y: 0, w: 0.25, h: 0.5 } },
        { slideId: second.id, part: { x: 0, y: 0.5, w: 1, h: 0.5 } },
      ];
      const pngs = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
      for (const png of pngs) t.drawPart.mockResolvedValueOnce({ ok: true, png });
      const made = await t.editor.makeSlide(t.event, t.request({ parts }));
      expect(made.ok).toBe(true);
      expect(t.run).toHaveBeenCalledTimes(2);
      expect(t.run.mock.calls.map((call) => call[0].pages)).toEqual([
        [{ kind: 'original', sourceId: t.hash, page: 1 }],
        [{ kind: 'original', sourceId: t.hash, page: 0 }],
      ]);
      expect(t.drawPart.mock.calls.map((call) => call.slice(0, 2))).toEqual(
        [parts[0], parts[2], parts[1]].map((p) => [t.printed, p?.part]),
      );
      expect(t.keepSlide).toHaveBeenCalledExactlyOnceWith(
        {
          png: [pngs[0], pngs[2], pngs[1]],
          name: `${t.doc.name}, 3 parts`,
          place: 'playlist',
        },
        expect.any(Function),
      );
      expect(t.presentations.content(t.imported.id)).toEqual(t.before);
      expect(t.kept).not.toHaveBeenCalled();
    } finally {
      await t.clean();
    }
  });

  it('keeps no presentation when a later part fails or any collected page is invalid', async () => {
    const t = await opened();
    try {
      const slideId = t.doc.groups[0]?.slides[0]?.id;
      const part = { x: 0, y: 0, w: 1, h: 1 };
      for (const parts of [
        [],
        Array.from({ length: 401 }, () => ({ slideId, part })),
        [{ slideId: 'missing', part }],
        [{ slideId, part: { ...part, w: 2 } }],
      ]) {
        expect((await t.editor.makeSlide(t.event, t.request({ parts }))).ok).toBe(false);
      }
      expect(t.run).not.toHaveBeenCalled();
      t.drawPart.mockResolvedValueOnce({ ok: true, png: t.png });
      t.drawPart.mockResolvedValueOnce({ ok: false, message: 'Placeholder second part failed.' } as never);
      expect(
        await t.editor.makeSlide(
          t.event,
          t.request({
            parts: [
              { slideId, part },
              { slideId, part },
            ],
          }),
        ),
      ).toEqual({ ok: false, message: 'Placeholder second part failed.' });
      expect(t.keepSlide).not.toHaveBeenCalled();
    } finally {
      await t.clean();
    }
  });

  it('refuses a part off the page, a slide not in the document, a changed presentation, a bad place, and another window', async () => {
    const t = await opened();
    try {
      for (const change of [
        { part: { x: 0.8, y: 0, w: 0.5, h: 1 } },
        { part: { x: 0, y: 0, w: 0.01, h: 1 } },
        { slideId: 'no-such-slide' },
        { stamp: 'an older stamp' },
        { place: 'somewhere' },
        { presentationId: 'another-presentation' },
      ]) {
        const refused = await t.editor.makeSlide(t.event, t.request(change));
        expect(refused.ok, JSON.stringify(change)).toBe(false);
      }
      expect((await t.editor.makeSlide(t.event, null)).ok).toBe(false);
      t.refuse();
      expect((await t.editor.makeSlide(t.event, t.request())).ok).toBe(false);
      expect(t.run).not.toHaveBeenCalled();
      expect(t.drawPart).not.toHaveBeenCalled();
      expect(t.keepSlide).not.toHaveBeenCalled();
    } finally {
      await t.clean();
    }
  });

  it('refuses collected pictures over 128 MB without keeping a partial presentation', async () => {
    const t = await opened();
    try {
      const slideId = t.doc.groups[0]?.slides[0]?.id;
      const part = { x: 0, y: 0, w: 1, h: 1 };
      const png = new Uint8Array(64 * 1024 * 1024 + 1);
      t.drawPart.mockResolvedValue({ ok: true, png });
      const made = await t.editor.makeSlide(
        t.event,
        t.request({
          parts: [
            { slideId, part },
            { slideId, part },
          ],
        }),
      );
      expect(made).toEqual({
        ok: false,
        message: 'The collected pictures are larger than 128 MB. Make fewer parts at a time.',
      });
      expect(t.keepSlide).not.toHaveBeenCalled();
    } finally {
      await t.clean();
    }
  });

  it('gives the keeping operation a live guard so a mode change during import cannot publish the batch', async () => {
    const t = await opened();
    try {
      await t.editor.makeSlide(t.event, t.request());
      const guard = (t.keepSlide.mock.calls[0] as unknown as [unknown, () => boolean])[1];
      expect(typeof guard).toBe('function');
      expect(guard()).toBe(true);
      t.refuse();
      expect(guard()).toBe(false);
    } finally {
      await t.clean();
    }
  });

  it('says why when the part cannot be drawn, and keeps nothing', async () => {
    const t = await opened();
    try {
      t.drawPart.mockResolvedValueOnce({ ok: false, message: 'The page could not be drawn.' } as never);
      const made = await t.editor.makeSlide(t.event, t.request());
      expect(made).toEqual({ ok: false, message: 'The page could not be drawn.' });
      expect(t.keepSlide).not.toHaveBeenCalled();
    } finally {
      await t.clean();
    }
  });

  // Main's off-air guard (x82's batch, 47412e65, reviewed in a21-review-x82): only a batch of parts waits for the stream
  // to be off air; the single Make a slide… and Save a PDF copy… go on during a show, as they did before the batch.
  it('the single Make a slide and Save a PDF copy go on while the stream is on air or recording, and a stream starting does not stop them', async () => {
    const t = await opened();
    try {
      t.goOnAir();
      expect(await t.editor.makeSlide(t.event, t.request())).toMatchObject({ ok: true });
      // The stream starts while one is being made: Main's off-air hook stops a batch only.
      t.goOnAir(false);
      t.drawPart.mockImplementationOnce(() => {
        t.goOnAir();
        t.editor.cancelBatch();
        return Promise.resolve({ ok: true as const, png: t.png });
      });
      expect(await t.editor.makeSlide(t.event, t.request())).toMatchObject({ ok: true });
      // Save a PDF copy…, on air, and with the stream starting while it is printed.
      t.saveTo(join(t.world.root, 'Placeholder copy on air.pdf'));
      expect(await t.editor.export(t.event, t.imported.id, t.doc, t.stamp)).toEqual({
        ok: true,
        name: 'Placeholder copy on air.pdf',
      });
      t.goOnAir(false);
      t.run.mockImplementationOnce(() => {
        t.goOnAir();
        t.editor.cancelBatch();
        return Promise.resolve(t.printed);
      });
      t.saveTo(join(t.world.root, 'Placeholder copy as the stream starts.pdf'));
      expect(await t.editor.export(t.event, t.imported.id, t.doc, t.stamp)).toEqual({
        ok: true,
        name: 'Placeholder copy as the stream starts.pdf',
      });
    } finally {
      await t.clean();
    }
  });

  it('a batch of parts is refused while the stream is on air or recording, in its own words, and nothing is drawn', async () => {
    const t = await opened(true);
    try {
      const [first, second] = t.doc.groups.flatMap((g) => g.slides);
      if (!first || !second) throw new Error('The generated PDF needs two pages.');
      const parts = [
        { slideId: first.id, part: { x: 0, y: 0, w: 1, h: 0.5 } },
        { slideId: second.id, part: { x: 0, y: 0.5, w: 1, h: 0.5 } },
      ];
      t.goOnAir();
      expect(await t.editor.makeSlide(t.event, t.request({ parts }))).toEqual({
        ok: false,
        message:
          'No batch is made while the stream is on air or recording: make the slides once it has stopped.',
      });
      expect(t.run).not.toHaveBeenCalled();
      expect(t.drawPart).not.toHaveBeenCalled();
      expect(t.keepSlide).not.toHaveBeenCalled();
    } finally {
      await t.clean();
    }
  });

  it('a batch stops when the stream goes on air while it is made, says why, and keeps nothing', async () => {
    const t = await opened(true);
    try {
      const [first, second] = t.doc.groups.flatMap((g) => g.slides);
      if (!first || !second) throw new Error('The generated PDF needs two pages.');
      const parts = [
        { slideId: first.id, part: { x: 0, y: 0, w: 1, h: 0.5 } },
        { slideId: second.id, part: { x: 0, y: 0.5, w: 1, h: 0.5 } },
      ];
      t.drawPart.mockImplementationOnce(() => {
        t.goOnAir();
        t.editor.cancelBatch();
        return Promise.resolve({ ok: true as const, png: t.png });
      });
      expect(await t.editor.makeSlide(t.event, t.request({ parts }))).toEqual({
        ok: false,
        message:
          'The slides were not made: the stream went on air or started recording. Make them again once it has stopped.',
      });
      expect(t.keepSlide).not.toHaveBeenCalled();
    } finally {
      await t.clean();
    }
  });

  // x85's Extract pages… to a new PDF (alpha.21, taken from alpha.22) waits for the stream to be off air, as a batch of
  // parts does, in its own words (the lead's QA21-TAKEPDF-1 A: nothing that works on air today stops working); the
  // whole Save a PDF copy… goes on (above).
  it('Extract pages to a new PDF is refused on air in its own words, and stops when the stream starts while it is printed', async () => {
    const t = await opened(true);
    try {
      const onAir = join(t.world.root, 'Placeholder extracted on air.pdf');
      t.saveTo(onAir);
      t.goOnAir();
      expect(await t.editor.export(t.event, t.imported.id, t.doc, t.stamp, [0])).toEqual({
        ok: false,
        message:
          'No pages are extracted while the stream is on air or recording: extract them once it has stopped.',
      });
      expect(t.run).not.toHaveBeenCalled();
      expect(existsSync(onAir)).toBe(false);
      t.goOnAir(false);
      const starting = join(t.world.root, 'Placeholder extracted as the stream starts.pdf');
      t.saveTo(starting);
      t.run.mockImplementationOnce(() => {
        t.goOnAir();
        t.editor.cancelBatch();
        return Promise.resolve(t.printed);
      });
      expect(await t.editor.export(t.event, t.imported.id, t.doc, t.stamp, [0])).toEqual({
        ok: false,
        message:
          'The pages were not extracted: the stream went on air or started recording. Extract them again once it has stopped.',
      });
      expect(existsSync(starting)).toBe(false);
    } finally {
      await t.clean();
    }
  });

  it('Undo and Redo of an extracted PDF wait while the stream is on air or recording', async () => {
    const t = await opened(true);
    try {
      const file = join(t.world.root, 'Placeholder extracted pages.pdf');
      t.saveTo(file);
      const made = await t.editor.export(t.event, t.imported.id, t.doc, t.stamp, [0]);
      expect(made).toMatchObject({ ok: true, name: 'Placeholder extracted pages.pdf' });
      const undoId = made.ok ? made.undoId : undefined;
      if (!undoId) throw new Error('The extracted PDF has no Undo.');
      t.goOnAir();
      expect(await t.editor.showExtractedCopy(t.event, undoId, false)).toBe(false);
      expect(existsSync(file)).toBe(true);
      t.goOnAir(false);
      expect(await t.editor.showExtractedCopy(t.event, undoId, false)).toBe(true);
      expect(existsSync(file)).toBe(false);
      t.goOnAir();
      expect(await t.editor.showExtractedCopy(t.event, undoId, true)).toBe(false);
      expect(existsSync(file)).toBe(false);
      t.goOnAir(false);
      expect(await t.editor.showExtractedCopy(t.event, undoId, true)).toBe(true);
      expect(existsSync(file)).toBe(true);
    } finally {
      await t.clean();
    }
  });
});
