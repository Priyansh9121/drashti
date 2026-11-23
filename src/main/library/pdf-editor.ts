import type { IpcMainInvokeEvent } from 'electron';
import { basename, isAbsolute, join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { idSchema } from '../../shared/model-schema';
import { editDocSchema, type EditDoc } from '../../shared/slide-edit';
import { renderEditedSlide } from '../../shared/slide-design';
import { z } from 'zod';
import { cutText } from '../../shared/text';
import type { MadeSlidePlace, MakeSlideResult, PagePart } from '../../shared/page-part';
import { madeSlideName, pagePartSchema } from '../../shared/page-part';
import type { PdfCopyJob, PdfCopyResult } from '../../shared/pdf-copy';
import type { PartPicture } from '../pictures/pdf-pictures';
import { OriginalsStore, originalRelative } from '../import/originals-store';
import type { Db } from '../db/database';
import type { PdfCopySession } from './pdf-copy-session';
import { PdfCopyError, writePdfCopy } from './pdf-copy-file';

export interface PdfEditorDeps {
  db: Db;
  mediaDir: string;
  session: PdfCopySession;
  allowed(event: IpcMainInvokeEvent): boolean;
  stamp(presentationId: string): string | null;
  validate(
    presentationId: string,
    doc: EditDoc,
    stamp: string,
  ): { ok: true; doc: EditDoc } | { ok: false; message: string };
  chooseOutput(event: IpcMainInvokeEvent, name: string): Promise<string | null>;
  /**
   * Whether the stream is on air or recording: no batch of parts is made then (x82's Make slides from many parts),
   * and one being made stops (cancelBatch). The single Make a slide… and Save a PDF copy… go on, as before the batch.
   */
  onAir?: () => boolean;
  /** Make a slide… (alpha.21): the part of a one-page PDF just printed here, drawn at the hall's picture size. */
  drawPart?: (pdf: Uint8Array, part: PagePart, signal: AbortSignal) => Promise<PartPicture>;
  /** Make a slide…: the picture kept in the library as a one-slide presentation, in the open playlist when asked. */
  keepSlide?: (
    made: {
      png: Uint8Array | Uint8Array[];
      name: string;
      place: MadeSlidePlace;
    },
    current: () => boolean,
  ) => Promise<MakeSlideResult>;
}
const failed = (message: string): { ok: false; message: string } => ({ ok: false, message });
/** A batch of parts asked for while the stream is on air or recording (the single slide goes on). */
const BATCH_ON_AIR =
  'No batch is made while the stream is on air or recording: make the slides once it has stopped.';
/** A batch stopped by the stream going on air or starting to record. */
const BATCH_STOPPED =
  'The slides were not made: the stream went on air or started recording. Make them again once it has stopped.';
/** Make a slide…'s request, its document checked apart (editDocSchema) and against what is stored (validate). */
const makeSlideSchema = z.object({
  presentationId: idSchema,
  doc: z.unknown(),
  stamp: z.string().max(1024),
  slideId: z.string().min(1).max(200),
  part: pagePartSchema,
  place: z.enum(['playlist', 'library']),
  parts: z
    .array(z.object({ slideId: z.string().min(1).max(200), part: pagePartSchema }))
    .min(1)
    .max(400)
    .optional(),
});
class PdfEditorError extends Error {}

/** Save a separate PDF from a validated editor snapshot; never writes a presentation or revision. */
export class PdfEditor {
  private active: { abort: AbortController; done: Promise<PdfCopyResult>; batch?: boolean } | null = null;
  private stopped = false;
  constructor(private readonly deps: PdfEditorDeps) {}

  export(
    event: IpcMainInvokeEvent,
    rawId: unknown,
    rawDoc: unknown,
    rawStamp: unknown,
  ): Promise<PdfCopyResult> {
    if (this.stopped || this.active || !this.deps.allowed(event))
      return Promise.resolve(
        failed('A PDF copy is already being made, or this editor is no longer available.'),
      );
    const id = idSchema.safeParse(rawId),
      checked = editDocSchema.safeParse(rawDoc);
    if (
      !id.success ||
      !checked.success ||
      checked.data.presentationId !== id.data ||
      typeof rawStamp !== 'string' ||
      rawStamp.length > 1024
    )
      return Promise.resolve(failed('Reopen the editor before saving a PDF copy.'));
    const validated = this.deps.validate(id.data, checked.data, rawStamp);
    if (!validated.ok) return Promise.resolve(validated);
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      !this.stopped &&
      !event.sender.isDestroyed() &&
      this.deps.allowed(event) &&
      this.deps.stamp(id.data) === rawStamp;
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort);
    const done = this.make(event, structuredClone(validated.doc), current, controller.signal).finally(() => {
      event.sender.removeListener('destroyed', abort);
      if (this.active?.abort === controller) this.active = null;
    });
    this.active = { abort: controller, done };
    return done;
  }

  private async make(
    event: IpcMainInvokeEvent,
    doc: EditDoc,
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<PdfCopyResult> {
    try {
      if (!current()) return failed('The editor changed. Reopen it before saving a PDF copy.');
      const output = await this.deps.chooseOutput(event, doc.name);
      if (!output) return { ok: false, cancelled: true, message: 'Saving the PDF copy was cancelled.' };
      if (!current()) return failed('The presentation or editor changed. Choose Save a PDF copy again.');
      const plan = await this.plan(doc, current);
      if (!current()) return failed('Saving the PDF copy was cancelled.');
      const bytes = await this.deps.session.run(plan, current, signal);
      if (!bytes || !current())
        return failed('The PDF copy could not be generated safely. The original is unchanged.');
      // Protect retained originals by file identity as well as by subtree, including outside hardlinks.
      const external = this.deps.db
        .prepare(
          "SELECT source_path FROM presentations WHERE source_kind = 'pictures' AND source_path IS NOT NULL",
        )
        .all() as { source_path: string }[];
      await writePdfCopy({
        bytes,
        outputPath: output,
        mediaDir: this.deps.mediaDir,
        protectedSources: [
          ...new OriginalsStore(this.deps.db, this.deps.mediaDir)
            .list()
            .map((original) => join(this.deps.mediaDir, originalRelative(original))),
          ...new OriginalsStore(this.deps.db, this.deps.mediaDir).sourceLocations(),
          ...external.map((row) => row.source_path).filter(isAbsolute),
        ],
        signal,
        current,
      });
      // Final rename is the writer's commit boundary; do not falsely report cancellation after publication.
      return { ok: true, name: basename(output) };
    } catch (error) {
      if (error instanceof PdfEditorError) return failed(error.message);
      if (error instanceof PdfCopyError && error.code === 'source-limit') return failed(error.message);
      return failed(
        'The PDF copy could not be saved safely. Choose a new file that is not one of the original files and not in Drashti’s own media folder.',
      );
    }
  }

  private async plan(doc: EditDoc, current: () => boolean): Promise<Omit<PdfCopyJob, 'id'>> {
    const slides = doc.groups.flatMap((group) => group.slides);
    if (!slides.length || slides.length > 400)
      throw new PdfEditorError('A PDF copy needs between 1 and 400 pages. Save larger documents in parts.');
    const originals = new OriginalsStore(this.deps.db, this.deps.mediaDir);
    const retained = originals.list();
    const sources = new Map<string, Uint8Array>();
    const pages: PdfCopyJob['pages'] = [];
    let sourceBytes = 0;
    for (const slide of slides) {
      if (!current()) throw new Error('Cancelled.');
      const ref = slide.documentPage;
      if (ref?.ext === 'pdf' && !ref.edited) {
        if (!sources.has(ref.sha256)) {
          const descriptor = retained.find(
            (original) => original.sha256 === ref.sha256 && original.ext === 'pdf',
          );
          if (!descriptor)
            throw new PdfEditorError(
              'An original PDF file is missing. Restore it from a backup before saving this copy.',
            );
          const file = await originals.resolve(descriptor);
          if (!file || !current() || (await stat(file)).size > 128 * 1024 * 1024)
            throw new PdfEditorError('An original PDF file is missing or larger than 128 MB.');
          const data = new Uint8Array(await readFile(file));
          sourceBytes += data.length;
          if (!current() || sourceBytes > 256 * 1024 * 1024)
            throw new PdfEditorError(
              'The original PDFs together are larger than 256 MB. Save this document in smaller parts.',
            );
          sources.set(ref.sha256, data);
        }
        pages.push({ kind: 'original', sourceId: ref.sha256, page: ref.page });
      } else {
        const rendered = renderEditedSlide(doc, slide);
        if (rendered.elements.some((element) => element.kind === 'video' || element.kind === 'timer'))
          throw new PdfEditorError(
            'A page contains video or a live timer. Remove that moving element before saving a PDF copy.',
          );
        const { deck: _deck, ...still } = rendered;
        pages.push({ kind: 'native', slide: still });
      }
    }
    return { pages, sources: [...sources].map(([id, data]) => ({ id, data })) };
  }

  /**
   * Make a slide… (alpha.21, the owner's "add a slide button to create a slide in drashti"): the editor's page as it
   * now looks (unsaved changes too), printed as a one-page PDF the way Save a PDF copy prints it (an unchanged page
   * straight from the retained original), its part drawn from that at the hall's picture size, and kept as a slide
   * in the library (in the open playlist when asked). The presentation being edited is never changed.
   */
  makeSlide(event: IpcMainInvokeEvent, raw: unknown): Promise<MakeSlideResult> {
    const drawPart = this.deps.drawPart;
    const keepSlide = this.deps.keepSlide;
    if (this.stopped || this.active || !drawPart || !keepSlide || !this.deps.allowed(event))
      return Promise.resolve(
        failed('Drashti is making a PDF copy or a slide already: try again in a moment.'),
      );
    const asked = makeSlideSchema.safeParse(raw);
    if (!asked.success)
      return Promise.resolve(failed('Choose a part of the page, and where the slide goes, then try again.'));
    const { presentationId, doc: rawDoc, stamp, slideId, part, place, parts } = asked.data;
    if (parts && this.onAir()) return Promise.resolve(failed(BATCH_ON_AIR));
    const checked = editDocSchema.safeParse(rawDoc);
    if (!checked.success || checked.data.presentationId !== presentationId)
      return Promise.resolve(failed('Reopen the editor before making a slide.'));
    const validated = this.deps.validate(presentationId, checked.data, stamp);
    if (!validated.ok) return Promise.resolve(validated);
    const doc = structuredClone(validated.doc);
    const pages = doc.groups.flatMap((group) => group.slides);
    const chosen = parts ?? [{ slideId, part }];
    const selected = chosen.map((picked) => {
      const at = pages.findIndex((slide) => slide.id === picked.slideId);
      const slide = pages[at];
      const group = doc.groups.find((g) => g.slides.some((s) => s.id === picked.slideId));
      return { ...picked, at, slide, group };
    });
    if (selected.some(({ slide, group }) => !slide || !group || slide.documentPage?.ext !== 'pdf'))
      return Promise.resolve(failed('Choose a PDF page for every part, then make the slides again.'));
    const controller = new AbortController();
    // A batch stops once the stream is on air or recording, and says so (BATCH_STOPPED); one slide goes on.
    let stoppedOnAir = false;
    const current = () => {
      if (parts && this.onAir()) {
        stoppedOnAir = true;
        return false;
      }
      return (
        !controller.signal.aborted &&
        !this.stopped &&
        !event.sender.isDestroyed() &&
        this.deps.allowed(event) &&
        this.deps.stamp(presentationId) === stamp
      );
    };
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort);
    const whole = part.x <= 0 && part.y <= 0 && part.w >= 1 && part.h >= 1;
    const name = parts
      ? `${cutText(doc.name, 180, '…')}, ${String(parts.length)} parts`
      : madeSlideName(doc.name, (selected[0]?.at ?? 0) + 1, whole);
    const done = (async (): Promise<MakeSlideResult> => {
      try {
        if (!current()) return failed('The editor changed. Reopen it before making a slide.');
        const pngs: Uint8Array[] = new Array<Uint8Array>(selected.length);
        let pictureBytes = 0;
        // One page printed at a time, all its parts drawn before moving on. Output keeps the chosen order.
        for (const id of new Set(selected.map((picked) => picked.slideId))) {
          const picked = selected.find((p) => p.slideId === id);
          if (!picked?.slide || !picked.group) throw new Error('Missing PDF page.');
          const one: EditDoc = { ...doc, groups: [{ ...picked.group, slides: [picked.slide] }] };
          const plan = await this.plan(one, current);
          const bytes = await this.deps.session.run(plan, current, controller.signal);
          if (!bytes || !current()) return failed('The page could not be drawn. Try again in a moment.');
          for (const [index, item] of selected.entries()) {
            if (item.slideId !== id) continue;
            if (!current()) return failed('The editor changed. Reopen it before making the slides.');
            const drawn = await drawPart(bytes, item.part, controller.signal);
            if (!drawn.ok) return failed(drawn.message);
            pictureBytes += drawn.png.byteLength;
            if (pictureBytes > 128 * 1024 * 1024)
              return failed('The collected pictures are larger than 128 MB. Make fewer parts at a time.');
            pngs[index] = drawn.png;
          }
        }
        if (!current()) return failed('The editor changed. Reopen it before making a slide.');
        const png = parts ? pngs : pngs[0];
        if (!png) throw new Error('Missing picture.');
        return await keepSlide({ png, name, place }, current);
      } catch (error) {
        if (error instanceof PdfEditorError) return failed(error.message);
        return failed('The slide could not be made. Try again in a moment.');
      }
    })()
      .then((made) => (!made.ok && parts && (stoppedOnAir || this.onAir()) ? failed(BATCH_STOPPED) : made))
      .finally(() => {
        event.sender.removeListener('destroyed', abort);
        if (this.active?.abort === controller) this.active = null;
      });
    this.active = {
      abort: controller,
      done: done.then((made) => (made.ok ? { ok: true, name } : made)),
      batch: parts !== undefined,
    };
    return done;
  }

  private onAir(): boolean {
    return this.deps.onAir?.() === true;
  }

  /** The stream went on air or started recording: a batch of parts being made stops; nothing else does. */
  cancelBatch(): void {
    if (!this.active?.batch) return;
    this.active.abort.abort();
    this.deps.session.stop();
  }

  cancel(): void {
    this.active?.abort.abort();
    this.deps.session.stop();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    const active = this.active;
    this.cancel();
    if (active) await active.done;
  }
}
