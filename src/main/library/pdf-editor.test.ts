import { EventEmitter } from 'node:events';
import { linkSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => { handlers.set(channel, fn); },
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
      if (entry.value === undefined) delete process.env[entry.key];
      else process.env[entry.key] = entry.value;
    }
    throw new Error('The generated PDF fixture temp root must be inside this worktree.');
  }
  return () => {
    for (const entry of before) {
      if (entry.value === undefined) delete process.env[entry.key];
      else process.env[entry.key] = entry.value;
    }
  };
}

function stamp(w: World, id: string): string | null {
  const row = w.db.prepare('SELECT updated_at, content_rev FROM presentations WHERE id = ? AND deleted_at IS NULL')
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
        db: world.db, presentations, revisions, settings: new SettingsRepo(world.db),
        fromOperator: () => true, mayPrepareSource: () => true,
        sourceReader: nativeSourceReader, sourceWrite: sourceWrite(world.db),
        lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
        changed: (ids) => { published.push(ids); }, saved: (change) => { saved.push(change); },
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
      expect(opened.doc.groups.flatMap((group) => group.slides).flatMap((slide) => slide.elements)
        .some((element) => element.kind === 'text' && element.text.includes(PLACEHOLDER_WORDS))).toBe(true);
      expect(registered.documentForExport(imported.id, opened.doc, opened.stamp).ok,
        'use the real prepared-source validator, never a seeded trusted document').toBe(true);
      expect(presentations.content(imported.id)).toEqual(before);
      expect(stamp(world, imported.id)).toBe(beforeStamp);

      const chosen = join(world.root, 'chosen-output'); mkdirSync(chosen);
      const alias = join(chosen, 'Placeholder retained-original alias.pdf');
      linkSync(world.owned, alias);
      const ownedBefore = inode(world.owned), aliasBefore = inode(alias);
      const externalBefore = inode(world.source);
      expect({ dev: aliasBefore.dev, ino: aliasBefore.ino }).toEqual({ dev: ownedBefore.dev, ino: ownedBefore.ino });
      expect({ dev: externalBefore.dev, ino: externalBefore.ino }).not.toEqual({ dev: ownedBefore.dev, ino: ownedBefore.ino });
      expect(isInside(realpathSync(world.mediaDir), realpathSync(alias))).toBe(false);
      expect(realpathSync(alias)).not.toBe(realpathSync(world.owned));
      const bytes = makeTestPdf([{ width: 960, height: 540, color: [40, 80, 120], text: 'Placeholder copied output' }]);
      expect(bytes).not.toEqual(world.bytes);
      const session = new PdfCopySession({
        open: () => { throw new Error('The unit hidden-session boundary must not open an Electron window.'); },
        assetDirs: () => [],
        normalize: () => Promise.reject(new Error('No unit print operation is admitted.')),
      });
      // The only feature output stub: the hidden protocol returns generated PDF
      // bytes. Real plan/source resolution and the protected writer still run.
      const generated = vi.spyOn(session, 'run').mockResolvedValue(new Uint8Array(bytes));
      editor = new PdfEditor({
        db: world.db, mediaDir: world.mediaDir, session,
        allowed: () => true, stamp: (id) => stamp(world, id),
        validate: registered.documentForExport, chooseOutput: () => Promise.resolve(alias),
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
      } finally { restoreLocation(); }
    }
  });
});
