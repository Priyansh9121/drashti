import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  private readonly prepared = new Map<string, { stamp: string; doc: EditDoc }>();
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
    guard: SourceCommitGuard,
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
        .get(rows.presentationId);
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
        const source = await this.originalFor(ref);
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
