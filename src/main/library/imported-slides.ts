import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import type { DocumentPageRef } from '../../shared/document-page';
import { documentPageFromJson } from '../../shared/document-page';
import type { SlideElement } from '../../shared/model';
import { editablePdfPage } from '../../shared/pdf-edit-page';
import type { EditDoc, EditSlide } from '../../shared/slide-edit';
import type { ContentRows } from '../db/content';
import type { Db } from '../db/database';
import { readEditablePptx } from '../import/deck/editable-pptx';
import { MediaStore } from '../import/media-store';
import { MEDIA_REF } from '../import/model';
import { OriginalsStore, type OriginalDescriptor } from '../import/originals-store';
import { editDocOf, sameData } from './slides';

const require = createRequire(import.meta.url);
const allSlides = (doc: EditDoc) => doc.groups.flatMap((group) => group.slides);
const contentOf = (slide: EditSlide, copied = false) => {
  const groups = new Map<string, number>();
  return {
    elements: copied
      ? slide.elements.map(({ id: _id, groupId, ...element }) => {
          if (groupId && !groups.has(groupId)) groups.set(groupId, groups.size);
          return { ...element, ...(groupId ? { groupId: groups.get(groupId) } : {}) };
        })
      : slide.elements,
    background: slide.background,
    darken: slide.darken,
    design: slide.design,
    cues: copied ? slide.cues.map(({ id: _id, ...cue }) => cue) : slide.cues,
    width: slide.documentPage?.width,
    height: slide.documentPage?.height,
    rotation: slide.documentPage?.rotation,
    pageSize: slide.pageSize,
  };
};
const sameSource = (a: DocumentPageRef | undefined, b: DocumentPageRef | undefined) =>
  !!a && !!b && a.sha256 === b.sha256 && a.ext === b.ext && a.page === b.page;

/** Native working copies belong to an editor stamp; they never replace stored playback merely on open. */
export class ImportedSlides {
  private readonly prepared = new Map<string, { stamp: string; doc: EditDoc }>();
  private readonly originals: OriginalsStore;
  private readonly media: MediaStore;

  constructor(
    private readonly db: Db,
    mediaDir = join(dirname(db.name), 'Media'),
  ) {
    this.originals = new OriginalsStore(db, mediaDir);
    this.media = new MediaStore(db, { dir: mediaDir });
  }

  private async originalFor(
    ref: DocumentPageRef,
  ): Promise<{ original: OriginalDescriptor; file: string } | null> {
    const original = this.originals
      .list()
      .find((entry) => entry.sha256 === ref.sha256 && entry.ext === ref.ext);
    if (!original) return null;
    const file = await this.originals.resolve(original);
    return file ? { original, file } : null;
  }

  async prepare(
    rows: ContentRows,
    opened: EditDoc,
    stamp: string,
  ): Promise<{ doc: EditDoc; issues: string[] }> {
    const doc = structuredClone(opened);
    const issues: string[] = [];
    const slides = allSlides(doc);
    if (slides.length > 0 && !slides.some((slide) => slide.documentPage)) {
      const kind = this.db
        .prepare('SELECT source_kind FROM presentations WHERE id = ?')
        .pluck()
        .get(rows.presentationId);
      if (kind === 'pictures')
        issues.push(
          'This older import has ambiguous source-page mapping. Its saved canvas and operator additions are preserved; link the matching original pages before changing source objects.',
        );
    }
    const work = await mkdtemp(join(tmpdir(), 'drashti-edit-source-'));
    try {
      const bySource = new Map<string, EditSlide[]>();
      for (const slide of slides)
        if (slide.documentPage && !slide.documentPage.edited) {
          const ref = slide.documentPage;
          const key = `${ref.sha256}.${ref.ext}`;
          const list = bySource.get(key) ?? [];
          list.push(slide);
          bySource.set(key, list);
        }
      for (const list of bySource.values()) {
        const ref = list[0]?.documentPage;
        if (!ref) continue;
        const source = await this.originalFor(ref);
        if (!source) {
          issues.push(
            'A retained original is missing or damaged. Saved playback is unchanged; restore the original from a backup.',
          );
          continue;
        }
        try {
          if (ref.ext === 'pptx') {
            const parsed = await readEditablePptx(source.file, join(work, ref.sha256));
            const media = new Map<string, string>();
            for (const [i, asset] of parsed.media.entries()) {
              const imported = await this.media.importFile(asset.originalPath, {
                kind: 'drashti',
                path: 'Editable document object',
              });
              if (!('mediaId' in imported)) throw new Error('A source object could not be retained.');
              media.set(`${MEDIA_REF}${i}`, imported.mediaId);
            }
            for (const slide of list) {
              const pageRef = slide.documentPage;
              if (!pageRef) continue;
              const native = parsed.slides.find((page) => page.sourceIndex === pageRef.page);
              if (!native) {
                issues.push('A source slide could not be matched; its saved playback is unchanged.');
                continue;
              }
              slide.elements = native.elements.map((element): SlideElement => {
                const own = { ...element, id: `${slide.id}-${element.id}` };
                return own.kind === 'image' || own.kind === 'video'
                  ? { ...own, mediaId: media.get(own.mediaId) ?? own.mediaId }
                  : own;
              });
              slide.background = native.background;
              slide.documentPage = { ...pageRef, width: parsed.width, height: parsed.height };
              issues.push(...native.issues);
            }
          } else if (ref.ext === 'pdf') {
            const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
            // A bundled entry has no sibling pdf.worker.mjs. Keep the real parser in the bundle too.
            const pdfWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
            (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
            const assets = dirname(require.resolve('pdfjs-dist/package.json'));
            const loading = pdfjs.getDocument({
              data: new Uint8Array(await readFile(source.file)),
              useWorkerFetch: false,
              useSystemFonts: false,
              disableFontFace: false,
              standardFontDataUrl: join(assets, 'standard_fonts') + sep,
              cMapUrl: join(assets, 'cmaps') + sep,
              cMapPacked: true,
              wasmUrl: join(assets, 'wasm') + sep,
            });
            try {
              const pdf = await loading.promise;
              for (const slide of list) {
                const pageRef = slide.documentPage;
                if (!pageRef) continue;
                const page = await pdf.getPage(pageRef.page + 1);
                const native = await editablePdfPage(pdf, page, pdfjs.OPS);
                const media = new Map<string, string>();
                for (const asset of native.assets) {
                  const file = join(work, `${randomUUID()}.png`);
                  await writeFile(file, asset.png);
                  const imported = await this.media.importFile(file, {
                    kind: 'drashti',
                    path: 'Editable document object',
                  });
                  if (!('mediaId' in imported)) throw new Error('A source object could not be retained.');
                  media.set(asset.id, imported.mediaId);
                }
                slide.elements = native.elements.map((element): SlideElement =>
                  element.kind === 'image' || element.kind === 'video'
                    ? {
                        ...element,
                        id: `${slide.id}-${element.id}`,
                        mediaId: media.get(element.mediaId) ?? element.mediaId,
                      }
                    : { ...element, id: `${slide.id}-${element.id}` },
                );
                slide.background = '#ffffff';
                slide.documentPage = { ...pageRef, width: native.width, height: native.height };
                slide.pageSize = { width: native.width, height: native.height };
                issues.push(...native.issues);
              }
            } finally {
              await loading.destroy();
            }
          } else
            issues.push(
              'This older deck needs a retained PDF reading copy to expose its objects. Its saved playback is unchanged.',
            );
        } catch {
          issues.push('Some source objects could not be prepared safely. Saved playback is unchanged.');
        }
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    for (const slide of slides) if (slide.documentPage) slide.sourceOccurrenceId = slide.id;
    this.prepared.delete(doc.presentationId);
    this.prepared.set(doc.presentationId, { stamp, doc: structuredClone(doc) });
    while (this.prepared.size > 8) {
      const oldest = this.prepared.keys().next().value;
      if (oldest === undefined) break;
      this.prepared.delete(oldest);
    }
    return { doc, issues: [...new Set(issues)] };
  }

  /** Restore untouched original rows; only actual object edits save the prepared native page. */
  forSave(
    before: ContentRows,
    edited: EditDoc,
    stamp: string,
  ): { ok: true; doc: EditDoc } | { ok: false; message: string } {
    const cached = this.prepared.get(edited.presentationId);
    const doc = structuredClone(edited);
    const prepared = cached?.stamp === stamp ? allSlides(cached.doc) : [];
    const native = new Map(prepared.map((slide) => [slide.id, slide]));
    const stored = new Map(allSlides(editDocOf(before, edited.name).doc).map((slide) => [slide.id, slide]));
    const globalContentChanged =
      cached?.stamp === stamp &&
      (cached.doc.width !== doc.width ||
        cached.doc.height !== doc.height ||
        !sameData(cached.doc.master, doc.master));
    for (const slide of allSlides(doc)) {
      const old = before.slides.find((row) => row.id === slide.id);
      const storedRef = documentPageFromJson(old?.document_page);
      const ownPrepared = native.get(slide.id);
      if (!slide.documentPage) {
        if (storedRef || ownPrepared?.documentPage)
          return { ok: false, message: 'An imported page must keep its original document identity.' };
        continue;
      }
      if (storedRef?.edited) {
        if (!sameSource(slide.documentPage, storedRef))
          return { ok: false, message: 'A page cannot change its original document identity.' };
        slide.documentPage.edited = true;
        delete slide.deck;
        continue;
      }
      const original =
        ownPrepared ?? (!old && slide.sourceOccurrenceId ? native.get(slide.sourceOccurrenceId) : undefined);
      const originalRef = original?.documentPage;
      if (
        !original ||
        !originalRef ||
        slide.sourceOccurrenceId !== original.id ||
        !sameSource(slide.documentPage, originalRef)
      )
        return { ok: false, message: 'Reopen the editor before saving these imported pages.' };
      const copied = !old;
      const untouched =
        !globalContentChanged && sameData(contentOf(slide, copied), contentOf(original, copied));
      if (untouched) {
        const saved = stored.get(original.id);
        if (!saved)
          return { ok: false, message: 'The original page is no longer available. Reopen the editor.' };
        // Only the prepared objects are restored; notes, position, hide, guides and transitions still save.
        if (copied) {
          const groups = new Map<string, string>();
          slide.elements = saved.elements.map((element) => {
            if (element.groupId && !groups.has(element.groupId)) groups.set(element.groupId, randomUUID());
            const groupId = element.groupId ? groups.get(element.groupId) : undefined;
            return { ...element, id: randomUUID(), ...(groupId ? { groupId } : {}) };
          });
          slide.cues = saved.cues.map((cue) => ({ ...cue, id: randomUUID() }));
          if (saved.deck) {
            const drashti = slide.deck?.drashti;
            const stepTransitions = slide.deck?.stepTransitions;
            const { drashti: _drashti, stepTransitions: _steps, ...kept } = saved.deck;
            slide.deck = {
              ...structuredClone(kept),
              ...(drashti ? { drashti: structuredClone(drashti) } : {}),
              ...(stepTransitions ? { stepTransitions: structuredClone(stepTransitions) } : {}),
            };
          } else delete slide.deck;
        } else slide.elements = saved.elements;
        slide.background = saved.background;
        slide.darken = saved.darken;
        slide.design = saved.design;
        slide.documentPage = saved.documentPage ?? original.documentPage;
        if (saved.pageSize) slide.pageSize = saved.pageSize;
        else delete slide.pageSize;
      } else {
        if (original.deck && !original.documentPage?.edited && (!slide.documentPage.edited || slide.deck))
          return {
            ok: false,
            message: 'Confirm that this animated slide becomes a Drashti slide before changing its objects.',
          };
        slide.documentPage = {
          ...slide.documentPage,
          sha256: originalRef.sha256,
          ext: originalRef.ext,
          page: originalRef.page,
          edited: true,
        };
        delete slide.deck;
      }
    }
    return { ok: true, doc };
  }
}
