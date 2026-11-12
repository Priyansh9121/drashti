import { documentCanvas, slideCanvas } from '../../shared/document-page';
import { deckAfterEdit } from '../../shared/deck-edit-motion';
import { freshGroups } from '../../shared/element-groups';
import { masterContribution, renderEditedSlide } from '../../shared/slide-design';
import { fitElements } from '../../shared/slide-size';
import type { InsertPdfPagesResult, LinkPdfPageResult } from '../../shared/slide-edit';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { DocumentPageRef } from '../../shared/document-page';
import { documentPageFromJson } from '../../shared/document-page';
import type { MediaElement, SlideElement } from '../../shared/model';
import {
  RETAINED_SLIDE_PICTURE,
  sourcePictureRegion,
  type PreparedSourcePage,
} from '../../shared/editable-source';
import { fitPage } from '../../shared/pictures';
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

function bakedObject(
  element: MediaElement,
  source: PreparedSourcePage,
  slide: EditSlide,
  doc: EditDoc,
): MediaElement | null {
  const canvas = documentCanvas(slide.documentPage, doc);
  const picture = slide.elements.find(
    (item) =>
      item.kind === 'image' &&
      !item.hidden &&
      !item.crop &&
      item.frame.x === 0 &&
      item.frame.y === 0 &&
      Math.abs(item.frame.width - canvas.width) <= 1 &&
      Math.abs(item.frame.height - canvas.height) <= 1,
  );
  if (picture?.kind !== 'image') return null;
  // Existing page pictures include the letterbox. Map the source rectangle through the same fit.
  const { frame } = element;
  const rad = ((element.rotation ?? 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad)),
    s = Math.abs(Math.sin(rad));
  const width = c * frame.width + s * frame.height;
  const height = s * frame.width + c * frame.height;
  const region = sourcePictureRegion(
    { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height },
    source,
  );
  if (!region) return null;
  const fit = fitPage(source.width, source.height, picture.frame.width, picture.frame.height);
  const saved = sourcePictureRegion(
    {
      x: fit.x + region.crop.x * fit.w,
      y: fit.y + region.crop.y * fit.h,
      width: region.crop.width * fit.w,
      height: region.crop.height * fit.h,
    },
    picture.frame,
  );
  if (!saved) return null;
  const { rotation: _rotation, flipX: _flipX, flipY: _flipY, pictureClip: _clip, ...rest } = element;
  return {
    ...rest,
    kind: 'image',
    frame: region.frame,
    crop: saved.crop,
    mediaId: picture.mediaId,
    fit: 'stretch',
  };
}

function nativePageElements(
  slide: EditSlide,
  elements: SlideElement[],
  doc: EditDoc,
  native: Pick<EditDoc, 'width' | 'height'>,
): SlideElement[] {
  const videos = new Map<string, MediaElement>();
  for (const element of slide.elements) {
    if (element.kind === 'video' && element.sourceShapeId) videos.set(element.sourceShapeId, element);
  }
  if (!slide.deck?.motion || videos.size === 0) return elements;
  const mapped = elements.map((element): SlideElement => {
    if (element.kind !== 'image' || !element.sourceShapeId) return element;
    const video = videos.get(element.sourceShapeId);
    if (!video) return element;
    videos.delete(element.sourceShapeId);
    const { crop: _posterCrop, ...poster } = element;
    return {
      ...video,
      ...poster,
      kind: 'video',
      mediaId: video.mediaId,
      fit: video.fit,
    };
  });
  // Some embedded videos have no poster in the source. Keep their playable object above the other elements.
  return [...mapped, ...fitElements([...videos.values()], documentCanvas(slide.documentPage, doc), native)];
}

interface PreparedEditor {
  stamp: string;
  doc: EditDoc;
  inserted: Set<string>;
  linked: Map<string, { page: EditSlide; nativeIds: Set<string> }>;
}

export interface PdfEditorProgress {
  slideId: string | null;
  open(doc: EditDoc, pending: string[], issues: string[]): void;
  update(pages: EditSlide[], settled: string[]): void;
  waitForIdle(signal: AbortSignal): Promise<boolean>;
  /** The show needs the computer now (anything up, or the stream on air or recording). */
  busy(): boolean;
}

const sourceIndices = (slides: EditSlide[]) => [
  ...new Set(slides.flatMap((slide) => (slide.documentPage ? [slide.documentPage.page] : []))),
];

/** Native working copies belong to an editor stamp; they never replace stored playback merely on open. */
export class ImportedSlides {
  private readonly prepared = new Map<string, PreparedEditor>();
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
    progress?: PdfEditorProgress,
  ): Promise<{ doc: EditDoc; issues: string[] }> {
    if (rows.presentationId !== opened.presentationId)
      throw new Error('Source presentation identity changed.');
    return this.prepareDoc(opened, stamp, guard, undefined, progress);
  }

  private async prepareDoc(
    opened: EditDoc,
    stamp: string,
    guard: SourceCommitGuard,
    retained?: OriginalDescriptor,
    progress?: PdfEditorProgress,
  ): Promise<{ doc: EditDoc; issues: string[] }> {
    const allowed = () => !guard.signal.aborted && guard.allowed();
    if (!allowed()) throw new Error('Source preparation cancelled.');
    const doc = structuredClone(opened);
    const issues: string[] = [];
    const slides = allSlides(doc);
    for (const slide of slides) if (slide.documentPage) slide.sourceOccurrenceId = slide.id;
    // A saved page picture with no page of the original: an older import's slide (or one whose pages did not match).
    // A page added in the editor is not one: it has a PDF page's paper size, or no picture of an original.
    if (
      slides.some(
        (slide) =>
          !slide.documentPage &&
          !slide.pageSize &&
          slide.elements.some((element) => element.kind === 'image'),
      )
    ) {
      const kind = this.db
        .prepare('SELECT source_kind FROM presentations WHERE id = ?')
        .pluck()
        .get(opened.presentationId);
      if (kind === 'pictures')
        issues.push(
          'Drashti doesn’t know which page of the original each of these slides shows, as with older imports. The slides and what you added to them stay as they are. To edit the original’s own words and shapes, first use Link source page… to link each slide to its page.',
        );
    }
    const work = await mkdtemp(join(tmpdir(), 'drashti-edit-source-'));
    let retainOutput = false;
    const view = { shown: false };
    try {
      const bySource = new Map<string, EditSlide[]>();
      for (const slide of slides)
        if (
          slide.documentPage &&
          !slide.documentPage.edited &&
          !(slide.deck?.motion && slide.deck.steps.length === 0)
        ) {
          const ref = slide.documentPage;
          const key = `${ref.sha256}.${ref.ext}`;
          const list = bySource.get(key) ?? [];
          list.push(slide);
          bySource.set(key, list);
        }
      const sources = [...bySource.values()];
      const focused = slides.find((slide) => slide.id === progress?.slideId) ?? slides[0];
      const primary = sources.find((list) => focused && list.includes(focused)) ?? sources[0];
      const primaryPages = primary ? sourceIndices(primary) : [];
      const progressive =
        primary?.[0]?.documentPage?.ext === 'pdf' && primaryPages.length > 3 ? progress : undefined;
      if (progressive && focused?.documentPage && primary?.includes(focused)) {
        const at = focused.documentPage.page;
        primaryPages.sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || b - a);
      }
      const order =
        progressive && primary ? [primary, ...sources.filter((list) => list !== primary)] : sources;
      const pending = new Set(progressive ? order.flat().map((slide) => slide.id) : []);
      const firstPages = new Set(primaryPages.slice(0, 3));
      const openEditor = () => {
        if (!progressive || view.shown || !allowed()) return;
        view.shown = true;
        this.rememberPrepared(doc, stamp);
        progressive.open(structuredClone(doc), [...pending], [...issues]);
      };
      const settle = (occurrences: EditSlide[], ready: EditSlide[] = []) => {
        const settled = occurrences.map((slide) => slide.id).filter((id) => pending.delete(id));
        if (view.shown && settled.length && allowed()) progressive?.update(ready, settled);
      };
      const waitForIdle = (signal: AbortSignal) =>
        view.shown && progressive ? progressive.waitForIdle(signal) : Promise.resolve(!signal.aborted);
      if (progressive && focused && !primary?.includes(focused)) openEditor();

      for (const list of order) {
        if (!(await waitForIdle(guard.signal)) || !allowed())
          throw new Error('Source preparation cancelled.');
        const ref = list[0]?.documentPage;
        if (!ref) continue;
        const source = await this.originalFor(ref, retained);
        if (!source) {
          issues.push(
            'The original file of these slides is missing or damaged. The slides still show as before; restore the original file from a backup.',
          );
          settle(list);
          if (list === primary) openEditor();
          continue;
        }
        if (!allowed()) throw new Error('Source preparation cancelled.');
        if (ref.ext !== 'pdf' && ref.ext !== 'pptx') {
          issues.push(
            'Drashti can’t read this deck’s own words and shapes. To edit them, save the deck as a PDF from its own program, then use Link source page… to link each slide to its page. The slides still show as before.',
          );
          settle(list);
          if (list === primary) openEditor();
          continue;
        }
        try {
          const outDir = join(work, randomUUID());
          await mkdir(outDir);
          const retainedAssets = new Map<string, string>();
          const takeNative = async (
            native: PreparedSourcePage,
            occurrences: EditSlide[],
          ): Promise<EditSlide[]> => {
            if (!occurrences.length) return [];
            try {
              const media = new Map<string, string>();
              for (const asset of native.assets) {
                if (!allowed()) throw new Error('Source preparation cancelled.');
                let mediaId = retainedAssets.get(asset.file);
                if (!mediaId) {
                  const staged = await this.media.stage(asset.file);
                  if (!staged.ok) {
                    if (ref.ext === 'pptx') continue;
                    throw new Error('A source object could not be retained.');
                  }
                  if (!allowed()) throw new Error('Source preparation cancelled.');
                  const imported = await this.write(guard, () =>
                    this.media.addStaged(staged.staged, {
                      kind: 'drashti',
                      path: 'Editable document object',
                    }),
                  );
                  mediaId = imported.mediaId;
                  retainedAssets.set(asset.file, mediaId);
                }
                if (media.has(asset.token)) throw new Error('A source asset token is duplicated.');
                media.set(asset.token, mediaId);
              }
              const candidates = occurrences.map((slide) => {
                const elements = native.elements.flatMap((element): SlideElement[] => {
                  if (element.kind !== 'image' && element.kind !== 'video') return [element];
                  const mediaId = media.get(element.mediaId);
                  if (mediaId) return [{ ...element, mediaId }];
                  if (ref.ext !== 'pptx') throw new Error('A source object could not be retained.');
                  const baked = bakedObject(element, native, slide, doc);
                  if (baked) {
                    if (element.mediaId !== RETAINED_SLIDE_PICTURE)
                      issues.push(
                        'A source picture could not be read. The slide’s saved picture supplies that part.',
                      );
                    return [baked];
                  }
                  issues.push(
                    'A source drawing has no usable saved picture. Re-import with PowerPoint or Keynote to retain its picture.',
                  );
                  return [];
                });
                return {
                  ...slide,
                  elements: nativePageElements(slide, elements, doc, native).map((element) => ({
                    ...element,
                    id: `${slide.id}-${element.id}`,
                  })),
                  background: native.background,
                  documentPage: { ...slide.documentPage, width: native.width, height: native.height },
                  ...(ref.ext === 'pdf' ? { pageSize: { width: native.width, height: native.height } } : {}),
                };
              });
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
              return occurrences;
            } catch {
              if (!allowed()) throw new Error('Source preparation cancelled.');
              issues.push(
                'Some of the original’s words, pictures or shapes could not be made editable. Those slides still show as before.',
              );
              return [];
            }
          };
          const offered = new Set<number>();
          const takePage = async (index: number, page?: PreparedSourcePage) => {
            if (!allowed()) throw new Error('Source preparation cancelled.');
            if (offered.has(index)) return;
            offered.add(index);
            const occurrences = list.filter((slide) => slide.documentPage?.page === index);
            const ready = page ? await takeNative(page, occurrences) : [];
            settle(occurrences, ready);
            if (list === primary && (!firstPages.delete(index) || !firstPages.size)) openEditor();
          };
          /*
           * Behind the open editor (Session 57, the review's HIGH-1), a PDF's job ends whenever the show needs the
           * computer, leaving the pages it has not read `unread`; the reading waits for the show here, outside every
           * queue and with no job's clock running, then goes on with them in a new job. One byte budget for the PDF.
           */
          const behind =
            progressive && ref.ext === 'pdf'
              ? {
                  onPdfPage: takePage,
                  pdfHold: () => view.shown && progressive?.busy() === true,
                  pdfBudget: { assetBytes: 0, metadataBytes: 0 },
                }
              : {};
          let sourcePages = progressive && list === primary ? primaryPages : sourceIndices(list);
          let failed = false;
          for (;;) {
            const parsed = await this.reader({
              ext: ref.ext,
              file: source.file,
              outDir,
              sourcePages,
              signal: guard.signal,
              checkpoint: () => Promise.resolve(allowed()),
              ...behind,
            });
            if (!parsed.ok) {
              retainOutput ||= parsed.retainOutput === true;
              issues.push(parsed.message);
              break;
            }
            if (!allowed()) throw new Error('Source preparation cancelled.');
            for (const native of parsed.pages) await takePage(native.sourceIndex, native);
            failed ||= parsed.failed.length > 0;
            if (!parsed.unread?.length) break;
            sourcePages = parsed.unread;
            if (!(await waitForIdle(guard.signal)) || !allowed())
              throw new Error('Source preparation cancelled.');
          }
          if (failed)
            issues.push('Some source pages could not be prepared and stay as their saved pictures.');
        } catch {
          if (!allowed()) throw new Error('Source preparation cancelled.');
          issues.push(
            'Some of the original’s words, pictures or shapes could not be made editable. Those slides still show as before.',
          );
        } finally {
          settle(list);
          if (list === primary) openEditor();
        }
      }
    } finally {
      if (!retainOutput) await rm(work, { recursive: true, force: true });
    }
    if (!allowed()) throw new Error('Source preparation cancelled.');
    if (!view.shown) this.rememberPrepared(structuredClone(doc), stamp);
    return { doc, issues: [...new Set(issues)] };
  }

  private rememberPrepared(doc: EditDoc, stamp: string): void {
    this.prepared.delete(doc.presentationId);
    this.prepared.set(doc.presentationId, {
      stamp,
      doc,
      inserted: new Set(),
      linked: new Map(),
    });
    while (this.prepared.size > 8) {
      const oldest = this.prepared.keys().next().value;
      if (oldest === undefined) break;
      this.prepared.delete(oldest);
    }
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
    const baseline: PreparedEditor =
      cached?.stamp === stamp
        ? {
            ...cached,
            doc: structuredClone(cached.doc),
            inserted: new Set(cached.inserted),
            linked: new Map(cached.linked),
          }
        : {
            stamp,
            doc: editDocOf(targetRows, targetName).doc,
            inserted: new Set<string>(),
            linked: new Map(),
          };
    return baseline;
  }

  private adoptInsertion(
    baseline: PreparedEditor,
    prepared: { doc: EditDoc; issues: string[] },
    guard: SourceCommitGuard,
  ): InsertPdfPagesResult {
    const original = allSlides(prepared.doc);
    if (!original.length || original.length > 400 || baseline.inserted.size + original.length > 400)
      return {
        ok: false,
        message: 'Insert at most 400 PDF pages at a time. Save and reopen the editor before adding more.',
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
        message: 'Choose a PDF file of 128 MB or less. Save a smaller PDF and try again.',
      };
    const baseline = this.insertionBaseline(targetRows, targetName, stamp);
    const staged = await this.originals.stage(sourcePath, 'pdf', guard.signal);
    if (!allowed()) throw new Error('Source preparation cancelled.');
    if (!staged.ok) return staged;
    if (staged.original.bytes > 128 * 1024 * 1024)
      return { ok: false, message: 'That PDF is now larger than 128 MB. Save a smaller PDF and try again.' };
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
            'Insert at most 400 PDF pages at a time. Save the PDF in smaller parts, or save and reopen the editor before adding more.',
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

  /** The operator names both the saved picture and a prepared PDF page; no ordinal is guessed. */
  linkPdfPage(
    doc: EditDoc,
    stamp: string,
    slideId: string,
    pictureId: string,
    preparedId: string,
  ): LinkPdfPageResult {
    const cached = this.prepared.get(doc.presentationId);
    const original =
      cached?.stamp === stamp ? allSlides(cached.doc).find((slide) => slide.id === slideId) : undefined;
    const target = allSlides(doc).find((slide) => slide.id === slideId);
    const source = cached?.inserted.has(preparedId)
      ? allSlides(cached.doc).find((slide) => slide.id === preparedId)
      : undefined;
    const picture = target?.elements.find((element) => element.id === pictureId);
    const savedPicture = original?.elements.find((element) => element.id === pictureId);
    if (
      cached?.stamp !== stamp ||
      !original ||
      !target ||
      source?.documentPage?.ext !== 'pdf' ||
      !source.pageSize ||
      (original.documentPage && original.documentPage.ext !== 'ppt' && original.documentPage.ext !== 'key') ||
      picture?.kind !== 'image' ||
      savedPicture?.kind !== 'image' ||
      picture.mediaId !== savedPicture.mediaId
    )
      return {
        ok: false,
        message:
          'Choose the slide’s saved picture and a page of the PDF. If either changed, reopen the editor and try again.',
      };
    if (
      picture.fit !== 'fit' ||
      picture.crop ||
      picture.rotation ||
      picture.flipX ||
      picture.flipY ||
      (picture.opacity !== undefined && picture.opacity !== 1)
    )
      return {
        ok: false,
        message:
          'This picture is cropped, turned, faded or set to fill the slide. Keep the slide as it is, or use the whole, uncropped page picture before linking.',
      };
    const paper = slideCanvas(target, doc);
    const background: SlideElement[] = source.background
      ? [
          {
            id: randomUUID(),
            kind: 'shape',
            frame: { x: 0, y: 0, ...source.pageSize },
            fill: source.background,
            cornerRadius: 0,
            opacity: 1,
          },
        ]
      : [];
    const objects = freshGroups(
      fitElements([...background, ...source.elements], source.pageSize, picture.frame).map((element) => ({
        ...element,
        id: randomUUID(),
        frame: {
          ...element.frame,
          x: element.frame.x + picture.frame.x,
          y: element.frame.y + picture.frame.y,
        },
      })),
    ).map((element) => (picture.groupId ? { ...element, groupId: picture.groupId } : element));
    const { deck: _deck, ...kept } = target;
    const page: EditSlide = {
      ...kept,
      pageSize: paper,
      documentPage: {
        sha256: source.documentPage.sha256,
        ext: 'pdf',
        page: source.documentPage.page,
        width: paper.width,
        height: paper.height,
        edited: true,
      },
      sourceOccurrenceId: target.id,
      elements: target.elements.flatMap((element) => (element.id === pictureId ? objects : [element])),
    };
    const next = {
      ...doc,
      groups: doc.groups.map((group) => ({
        ...group,
        slides: group.slides.map((slide) => (slide.id === page.id ? page : slide)),
      })),
    };
    if (!editDocSchema.safeParse(next).success)
      return {
        ok: false,
        message: 'That reading copy exceeds this page’s editor limits. Choose a simpler PDF reading copy.',
      };
    cached.linked.set(page.id, {
      page: structuredClone(page),
      nativeIds: new Set(objects.map((element) => element.id)),
    });
    return {
      ok: true,
      page,
      issues: [
        'You linked this slide to a page of the PDF. Check how it looks before you save; what you added to the slide, and its size, stay as they were.',
      ],
    };
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
    const storedDoc = editDocOf(before, edited.name).doc;
    const stored = new Map(allSlides(storedDoc).map((slide) => [slide.id, slide]));
    for (const slide of allSlides(doc)) {
      const old = before.slides.find((row) => row.id === slide.id);
      const storedRef = documentPageFromJson(old?.document_page);
      const ownPrepared = native.get(slide.id);
      const approval =
        cached?.stamp === stamp
          ? (cached.linked.get(slide.id) ??
            (!old && slide.sourceOccurrenceId ? cached.linked.get(slide.sourceOccurrenceId) : undefined))
          : undefined;
      const linked = approval?.page;
      if (linked?.documentPage && sameSource(slide.documentPage, linked.documentPage)) {
        if (slide.sourceOccurrenceId !== linked.id)
          return {
            ok: false,
            message:
              'A linked page must stay on the slide it was linked to. Reopen the editor and link it again.',
          };
        slide.documentPage = { ...slide.documentPage, ...linked.documentPage, edited: true };
        delete slide.deck;
        continue;
      }
      if (
        linked &&
        !slide.documentPage &&
        slide.elements.some((element) => approval.nativeIds.has(element.id))
      )
        return {
          ok: false,
          message: 'A linked page must stay linked to its PDF. Reopen the editor and link it again.',
        };
      if (!slide.documentPage) {
        if (storedRef || ownPrepared?.documentPage)
          return {
            ok: false,
            message: 'An imported page must stay linked to its original file. Reopen the editor.',
          };
        continue;
      }
      if (storedRef?.edited) {
        if (!sameSource(slide.documentPage, storedRef))
          return {
            ok: false,
            message: 'A page cannot be linked to a different original file. Reopen the editor.',
          };
        slide.documentPage.edited = true;
        const deck = deckAfterEdit(stored.get(slide.id)?.deck, slide.deck);
        if (deck) slide.deck = deck;
        else delete slide.deck;
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
      const saved = stored.get(original.id) ?? (cached?.inserted.has(original.id) ? original : undefined);
      const matches = (basis: EditSlide, basisDoc: EditDoc) =>
        sameData(slideCanvas(basis, basisDoc), slideCanvas(slide, doc)) &&
        sameData(masterContribution(basisDoc, basis), masterContribution(doc, slide)) &&
        sameData(contentOf(slide, copied), contentOf(basis, copied));
      // A save can reach Main before the renderer receives the last prepared page.
      if (matches(original, cached?.doc ?? doc) || (saved && matches(saved, storedDoc))) {
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
        if (original.deck?.steps.length && !original.documentPage?.edited && !slide.documentPage.edited)
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
        const deck = deckAfterEdit(original.deck, slide.deck);
        if (deck) slide.deck = deck;
        else delete slide.deck;
      }
    }
    return { ok: true, doc };
  }
}
