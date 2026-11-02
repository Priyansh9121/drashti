import type { IpcMainInvokeEvent } from 'electron';
import { basename, isAbsolute } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { idSchema } from '../../shared/model-schema';
import { editDocSchema, type EditDoc } from '../../shared/slide-edit';
import { renderEditedSlide } from '../../shared/slide-design';
import type { PdfCopyJob, PdfCopyResult } from '../../shared/pdf-copy';
import { OriginalsStore } from '../import/originals-store';
import type { Db } from '../db/database';
import type { PdfCopySession } from './pdf-copy-session';
import { writePdfCopy } from './pdf-copy-file';

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
}
const failed = (message: string): PdfCopyResult => ({ ok: false, message });
class PdfEditorError extends Error {}

/** Save a separate PDF from a validated editor snapshot; never writes a presentation or revision. */
export class PdfEditor {
  private active: { abort: AbortController; done: Promise<PdfCopyResult> } | null = null;
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
      // Managed originals are protected as a subtree. Protect every original external document path too.
      const external = this.deps.db
        .prepare(
          "SELECT source_path FROM presentations WHERE source_kind = 'pictures' AND source_path IS NOT NULL",
        )
        .all() as { source_path: string }[];
      await writePdfCopy({
        bytes,
        outputPath: output,
        mediaDir: this.deps.mediaDir,
        protectedSources: external.map((row) => row.source_path).filter(isAbsolute),
        signal,
        current,
      });
      // Final rename is the writer's commit boundary; do not falsely report cancellation after publication.
      return { ok: true, name: basename(output) };
    } catch (error) {
      if (error instanceof PdfEditorError) return failed(error.message);
      return failed(
        'The PDF copy could not be saved safely. Choose a new file outside the original documents and managed media.',
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
              'An original PDF is unavailable. Restore its retained original before saving this copy.',
            );
          const file = await originals.resolve(descriptor);
          if (!file || !current() || (await stat(file)).size > 128 * 1024 * 1024)
            throw new PdfEditorError('An original PDF is unavailable or exceeds the 128 MiB source limit.');
          const data = new Uint8Array(await readFile(file));
          sourceBytes += data.length;
          if (!current() || sourceBytes > 256 * 1024 * 1024)
            throw new PdfEditorError(
              'The source PDFs exceed the 256 MiB copy limit. Save this document in smaller parts.',
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
