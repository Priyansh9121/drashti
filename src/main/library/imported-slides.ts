import { documentCanvas, slideCanvas } from '../../shared/document-page';
import { freshGroups } from '../../shared/element-groups';
import { masterContribution, renderEditedSlide } from '../../shared/slide-design';
import type { InsertPdfPagesResult } from '../../shared/slide-edit';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { DocumentPageRef } from '../../shared/document-page';
import { documentPageFromJson } from '../../shared/document-page';
import type { SlideElement } from '../../shared/model';
import { editDocSchema, type EditDoc, type EditSlide } from '../../shared/slide-edit';
import type { ContentRows } from '../db/content';
import type { Db } from '../db/database';
import { unavailableSourceReader, type SourceReader } from '../documents/source-reader';
import { unavailableSourceWrite, type SourceCommitGuard, type SourceWrite } from '../documents/source-write';
import { MediaStore } from '../import/media-store';
import { OriginalsStore, type OriginalDescriptor } from '../import/originals-store';
import { editDocOf, sameData } from './slides';

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
  private readonly prepared = new Map<string, { stamp: string; doc: EditDoc; inserted: Set<string> }>();
  private readonly originals: OriginalsStore;
  private readonly media: MediaStore;
  private readonly reader: SourceReader;
  private readonly write: SourceWrite;

  constructor(
    private readonly db: Db,
    mediaDir = join(dirname(db.name), 'Media'),
    options: { sourceReader?: SourceReader; sourceWrite?: SourceWrite } = {},
  ) {
    this.originals = new OriginalsStore(db, mediaDir);
    this.media = new MediaStore(db, { dir: mediaDir });
    this.reader = options.sourceReader ?? unavailableSourceReader;
    this.write = options.sourceWrite ?? unavailableSourceWrite;
  }

  private async originalFor(
    ref: DocumentPageRef,
    retained?: OriginalDescriptor,
  ): Promise<{ original: OriginalDescriptor; file: string } | null> {
    const original =
      retained?.sha256 === ref.sha256 && retained.ext === ref.ext
        ? retained
        : this.originals.list().find((entry) => entry.sha256 === ref.sha256 && entry.ext === ref.ext);
    if (!original) return null;
    const file = await this.originals.resolve(original);
    return file ? { original, file } : null;
  }

  async prepare(
    rows: ContentRows,
    opened: EditDoc,
    stamp: string,
    guard: SourceCommitGuard,
  ): Promise<{ doc: EditDoc; issues: string[] }> {
    if (rows.presentationId !== opened.presentationId)
      throw new Error('Source presentation identity changed.');
    return this.prepareDoc(opened, stamp, guard);
  }

  private async prepareDoc(
    opened: EditDoc,
    stamp: string,
    guard: SourceCommitGuard,
    retained?: OriginalDescriptor,
  ): Promise<{ doc: EditDoc; issues: string[] }> {
    const allowed = () => !guard.signal.aborted && guard.allowed();
    if (!allowed()) throw new Error('Source preparation cancelled.');
    const doc = structuredClone(opened);
    const issues: string[] = [];
    const slides = allSlides(doc);
    if (slides.length > 0 && !slides.some((slide) => slide.documentPage)) {
      const kind = this.db
        .prepare('SELECT source_kind FROM presentations WHERE id = ?')
        .pluck()
        .get(opened.presentationId);
      if (kind === 'pictures')
        issues.push(
          'This older import has ambiguous source-page mapping. Its saved canvas and operator additions are preserved; link the matching original pages before changing source objects.',
        );
    }
    const work = await mkdtemp(join(tmpdir(), 'drashti-edit-source-'));
    let retainOutput = false;
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
        const source = await this.originalFor(ref, retained);
        if (!source) {
          issues.push(
            'A retained original is missing or damaged. Saved playback is unchanged; restore the original from a backup.',
          );
          continue;
        }
        if (!allowed()) throw new Error('Source preparation cancelled.');
        if (ref.ext !== 'pdf' && ref.ext !== 'pptx') {
          issues.push(
            'This older deck needs a retained PDF reading copy to expose its objects. Its saved playback is unchanged.',
          );
          continue;
        }
        try {
          const outDir = join(work, randomUUID());
          await mkdir(outDir);
          const parsed = await this.reader({
            ext: ref.ext,
            file: source.file,
            outDir,
            sourcePages: [
              ...new Set(list.flatMap((slide) => (slide.documentPage ? [slide.documentPage.page] : []))),
            ],
            signal: guard.signal,
            checkpoint: () => Promise.resolve(allowed()),
          });
          if (!parsed.ok) {
            retainOutput ||= parsed.retainOutput === true;
            issues.push(parsed.message);
            continue;
          }
          if (!allowed()) throw new Error('Source preparation cancelled.');
          const retained = new Map<string, string>();
          for (const native of parsed.pages) {
            const occurrences = list.filter((slide) => slide.documentPage?.page === native.sourceIndex);
            if (!occurrences.length) continue;
            try {
              const media = new Map<string, string>();
              for (const asset of native.assets) {
                if (!allowed()) throw new Error('Source preparation cancelled.');
                let mediaId = retained.get(asset.file);
                if (!mediaId) {
                  const staged = await this.media.stage(asset.file);
                  if (!staged.ok) throw new Error('A source object could not be retained.');
                  if (!allowed()) throw new Error('Source preparation cancelled.');
                  const imported = await this.write(guard, () =>
                    this.media.addStaged(staged.staged, {
                      kind: 'drashti',
                      path: 'Editable document object',
                    }),
                  );
                  mediaId = imported.mediaId;
                  retained.set(asset.file, mediaId);
                }
                if (media.has(asset.token)) throw new Error('A source asset token is duplicated.');
                media.set(asset.token, mediaId);
              }
              const elements = native.elements.map((element): SlideElement => {
                if (element.kind !== 'image' && element.kind !== 'video') return element;
                const mediaId = media.get(element.mediaId);
                if (!mediaId) throw new Error('A source object could not be retained.');
                return { ...element, mediaId };
              });
              const candidates = occurrences.map((slide) => ({
                ...slide,
                elements: elements.map((element) => ({ ...element, id: `${slide.id}-${element.id}` })),
                background: native.background,
                documentPage: { ...slide.documentPage, width: native.width, height: native.height },
                ...(ref.ext === 'pdf' ? { pageSize: { width: native.width, height: native.height } } : {}),
              }));
              // Check complete candidates before replacing any occurrence's old canvas.
              for (const candidate of candidates) {
                const one = {
                  ...doc,
                  groups: [
                    {
                      ...doc.groups[0],
                      id: doc.groups[0]?.id ?? randomUUID(),
                      name: '',
                      color: doc.groups[0]?.color ?? null,
                      slides: [candidate],
                    },
                  ],
                };
                if (!editDocSchema.safeParse(one).success)
                  throw new Error('A prepared source page is not valid.');
              }
              if (!allowed()) throw new Error('Source preparation cancelled.');
              for (const [index, slide] of occurrences.entries()) {
                const candidate = candidates[index];
                if (!candidate) throw new Error('A prepared page is missing.');
                Object.assign(slide, candidate);
              }
              issues.push(...native.issues);
            } catch {
              if (!allowed()) throw new Error('Source preparation cancelled.');
              issues.push('Some source objects could not be prepared safely. Saved playback is unchanged.');
            }
          }
          if (parsed.failed.length)
            issues.push('Some source pages could not be matched; their saved playback is unchanged.');
        } catch {
          if (!allowed()) throw new Error('Source preparation cancelled.');
          issues.push('Some source objects could not be prepared safely. Saved playback is unchanged.');
        }
      }
    } finally {
      if (!retainOutput) await rm(work, { recursive: true, force: true });
    }
    if (!allowed()) throw new Error('Source preparation cancelled.');
    for (const slide of slides) if (slide.documentPage) slide.sourceOccurrenceId = slide.id;
    this.prepared.delete(doc.presentationId);
    this.prepared.set(doc.presentationId, { stamp, doc: structuredClone(doc), inserted: new Set() });
    while (this.prepared.size > 8) {
      const oldest = this.prepared.keys().next().value;
      if (oldest === undefined) break;
      this.prepared.delete(oldest);
    }
    return { doc, issues: [...new Set(issues)] };
  }

  /** Prepare an existing retained PDF, then authorize fresh occurrences for this editor stamp.
   * Neither the source presentation nor the target's stored rows are changed. */
  async insertFromPdf(
    targetRows: ContentRows,
    targetName: string,
    stamp: string,
    sourceRows: ContentRows,
    sourceName: string,
    sourceStamp: string,
    guard: SourceCommitGuard,
  ): Promise<InsertPdfPagesResult> {
    const baseline = this.insertionBaseline(targetRows, targetName, stamp);
    const source = editDocOf(sourceRows, sourceName);
    if (source.unreadable)
      return {
        ok: false,
        message:
          'Some objects in that PDF cannot be copied. Open it in Edit slides and review its limits first.',
      };
    const prepared = await this.prepare(sourceRows, source.doc, sourceStamp, guard);
    return this.adoptInsertion(baseline, prepared, guard);
  }

  private insertionBaseline(targetRows: ContentRows, targetName: string, stamp: string) {
    const cached = this.prepared.get(targetRows.presentationId);
    const baseline =
      cached?.stamp === stamp
        ? { ...cached, doc: structuredClone(cached.doc), inserted: new Set(cached.inserted) }
        : { stamp, doc: editDocOf(targetRows, targetName).doc, inserted: new Set<string>() };
    return baseline;
  }

  private adoptInsertion(
    baseline: { stamp: string; doc: EditDoc; inserted: Set<string> },
    prepared: { doc: EditDoc; issues: string[] },
    guard: SourceCommitGuard,
  ): InsertPdfPagesResult {
    const original = allSlides(prepared.doc);
    if (!original.length || original.length > 400 || baseline.inserted.size + original.length > 400)
      return {
        ok: false,
        message: 'Insert at most 400 PDF pages in one editor session. Save and reopen before adding more.',
      };
    if (
      original.some(
        (page) =>
          page.deck !== undefined ||
          page.pageSize === undefined ||
          (page.documentPage !== undefined && page.documentPage.ext !== 'pdf'),
      )
    )
      return {
        ok: false,
        message:
          'The PDF source pages are not ready to copy. Restore its original and reopen it in Edit slides first.',
      };
    const pages = original.map((page): EditSlide => {
      const rendered = renderEditedSlide(prepared.doc, page);
      const masterUsed = !!prepared.doc.master && !page.design?.skipMaster;
      const id = randomUUID();
      const { deck: _deck, sourceOccurrenceId: _occurrence, ...content } = page;
      return {
        ...content,
        id,
        elements: freshGroups(rendered.elements.map((element) => ({ ...element, id: randomUUID() }))),
        cues: page.cues.map((cue) => ({ ...cue, id: randomUUID() })),
        background: rendered.background,
        darken: rendered.darken ?? null,
        pageSize: slideCanvas(page, prepared.doc),
        design: {
          ...page.design,
          skipMaster: true,
          ...(rendered.backdrop ? { backdrop: rendered.backdrop } : {}),
        },
        ...(page.documentPage
          ? {
              documentPage: { ...page.documentPage, ...(masterUsed ? { edited: true } : {}) },
              sourceOccurrenceId: id,
            }
          : {}),
      };
    });
    let first = baseline.doc.groups[0];
    if (!first) {
      first = { id: randomUUID(), name: 'Pages', color: null, slides: [] };
      baseline.doc.groups.push(first);
    }
    first.slides.push(...pages);
    if (!editDocSchema.safeParse(baseline.doc).success)
      return { ok: false, message: 'These pages exceed the editor limits. Insert a smaller PDF instead.' };
    if (guard.signal.aborted || !guard.allowed()) throw new Error('Source preparation cancelled.');
    for (const page of pages) baseline.inserted.add(page.id);
    this.prepared.delete(baseline.doc.presentationId);
    this.prepared.set(baseline.doc.presentationId, baseline);
    while (this.prepared.size > 8) {
      const oldest = this.prepared.keys().next().value;
      if (oldest === undefined) break;
      this.prepared.delete(oldest);
    }
    return { ok: true, pages, issues: prepared.issues };
  }

  /** File selection stays in Main. Native page zero supplies the real count;
   * the second bounded read prepares the complete document off Main. */
  async insertFromFile(
    targetRows: ContentRows,
    targetName: string,
    stamp: string,
    sourcePath: string,
    guard: SourceCommitGuard,
  ): Promise<InsertPdfPagesResult> {
    const allowed = () => !guard.signal.aborted && guard.allowed();
    if (!allowed() || !isAbsolute(sourcePath)) throw new Error('Source preparation cancelled.');
    const info = await stat(sourcePath);
    if (!info.isFile() || info.size > 128 * 1024 * 1024)
      return {
        ok: false,
        message: 'Choose a regular PDF no larger than 128 MiB. Save a smaller PDF and try again.',
      };
    const baseline = this.insertionBaseline(targetRows, targetName, stamp);
    const staged = await this.originals.stage(sourcePath, 'pdf', guard.signal);
    if (!allowed()) throw new Error('Source preparation cancelled.');
    if (!staged.ok) return staged;
    if (staged.original.bytes > 128 * 1024 * 1024)
      return { ok: false, message: 'The PDF grew beyond 128 MiB. Save a smaller PDF and try again.' };
    const work = await mkdtemp(join(tmpdir(), 'drashti-insert-pdf-'));
    const sourceId = randomUUID();
    let retainOutput = false;
    try {
      const count = await this.reader({
        ext: 'pdf',
        file: staged.file,
        outDir: join(work, 'count'),
        sourcePages: [0],
        signal: guard.signal,
        checkpoint: () => Promise.resolve(allowed()),
      });
      if (!count.ok) {
        retainOutput ||= count.retainOutput === true;
        return {
          ok: false,
          message: 'That PDF could not be prepared. Save an unprotected PDF copy and choose it again.',
        };
      }
      if (!allowed()) throw new Error('Source preparation cancelled.');
      if (
        count.total < 1 ||
        count.total > 400 ||
        count.pages.length !== 1 ||
        count.failed.length ||
        baseline.inserted.size + count.total > 400
      )
        return {
          ok: false,
          message:
            'Insert at most 400 PDF pages in one editor session. Save smaller parts or reopen before adding more.',
        };
      const doc: EditDoc = {
        presentationId: sourceId,
        name: 'PDF pages',
        width: targetRows.width,
        height: targetRows.height,
        transition: null,
        loop: false,
        groups: [
          {
            id: randomUUID(),
            name: 'Pages',
            color: null,
            slides: Array.from({ length: count.total }, (_, page): EditSlide => ({
              id: randomUUID(),
              label: '',
              notes: '',
              background: '#ffffff',
              darken: null,
              enabled: true,
              transition: null,
              autoAdvanceMs: null,
              macroId: null,
              elements: [],
              cues: [],
              documentPage: { sha256: staged.original.sha256, ext: 'pdf', page },
            })),
          },
        ],
      };
      const prepared = await this.prepareDoc(doc, stamp, guard, staged.original);
      if (!allowed()) throw new Error('Source preparation cancelled.');
      // Register only after successful native preparation. The source location
      // protects the external original without creating another presentation.
      await this.write(guard, () => this.originals.register(staged.original, sourcePath));
      return this.adoptInsertion(baseline, prepared, guard);
    } finally {
      this.prepared.delete(sourceId);
      if (!retainOutput) await rm(work, { recursive: true, force: true });
    }
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
        sameData(slideCanvas(original, cached?.doc ?? before), slideCanvas(slide, doc)) &&
        sameData(masterContribution(cached?.doc ?? doc, original), masterContribution(doc, slide)) &&
        sameData(contentOf(slide, copied), contentOf(original, copied));
      if (untouched) {
        const saved = stored.get(original.id) ?? (cached?.inserted.has(original.id) ? original : undefined);
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
        if (
          slide.documentPage &&
          !slide.documentPage.edited &&
          !saved.pageSize &&
          (before.width !== doc.width || before.height !== doc.height)
        ) {
          slide.documentPage = {
            ...slide.documentPage,
            playbackSize: documentCanvas(saved.documentPage, before),
          };
        }
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
