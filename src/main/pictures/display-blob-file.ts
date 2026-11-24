import type { DownloadItem, Event, Session, WebContents } from 'electron';
import { isAbsolute } from 'node:path';
import { MAX_DISPLAY_COPY_BYTES, type DisplayCopyBlob } from '../../shared/pictures';

interface PendingFile {
  contents: WebContents;
  blob: DisplayCopyBlob;
  destination: string;
  item: DownloadItem | null;
  failure: Error | null;
  detachNative(): void;
  cancel(error: Error): void;
  finish(error?: Error): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A Blob URL from this exact page's origin, with the browser-generated UUID and no extra address. */
function ownBlob(contents: WebContents, blob: DisplayCopyBlob): boolean {
  if (!Number.isSafeInteger(blob.bytes) || blob.bytes <= 0 || blob.bytes > MAX_DISPLAY_COPY_BYTES)
    return false;
  if (typeof blob.url !== 'string' || blob.url.length > 512) return false;
  try {
    const origin = contents.mainFrame.origin;
    if (!origin) return false;
    const address = /^blob:(.+)\/([^/]+)$/u.exec(blob.url);
    if (!address) return false;
    const [, addressOrigin, id] = address;
    if (!id) return false;
    return addressOrigin === origin && id.length === 36 && UUID.test(id);
  } catch {
    return false;
  }
}

/**
 * Only the private display Session's current, sender-checked Blob can write a Main-chosen temporary file.
 * Chromium writes the encoded bytes natively: no full byte array crosses the context bridge or Main IPC.
 * All other downloads in this Session are denied, including after close and after a late cancelled request.
 */
export class DisplayBlobFiles {
  private current: PendingFile | null = null;
  private closed = false;

  constructor(private readonly pages: Session) {
    pages.on('will-download', this.willDownload);
  }

  save(
    contents: WebContents,
    source: DisplayCopyBlob,
    destination: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      this.closed ||
      this.current ||
      contents.isDestroyed() ||
      contents.session !== this.pages ||
      !ownBlob(contents, source) ||
      !isAbsolute(destination) ||
      signal.aborted
    ) {
      return Promise.reject(new Error('The display Blob is not this worker’s to save.'));
    }
    const blob = { url: source.url, bytes: source.bytes };
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const dispose = () => {
        signal.removeEventListener('abort', aborted);
        contents.removeListener('destroyed', gone);
        contents.removeListener('render-process-gone', gone);
        pending.detachNative();
        if (this.current === pending) this.current = null;
      };
      const pending: PendingFile = {
        contents,
        blob,
        destination,
        item: null,
        failure: null,
        detachNative: () => undefined,
        cancel: (error) => {
          if (finished || pending.failure) return;
          pending.failure = error;
          if (pending.item) {
            try {
              // Keep the promise pending until native 'done' closes the writer.
              pending.item.cancel();
            } catch {
              // A destroyed item has already released its native writer.
              pending.finish(error);
            }
          } else {
            pending.finish(error);
          }
        },
        finish: (error) => {
          if (finished) return;
          finished = true;
          dispose();
          if (error) reject(error);
          else resolve();
        },
      };
      const aborted = () => pending.cancel(new Error('The display Blob write was cancelled.'));
      const gone = () => pending.cancel(new Error('The display Blob worker stopped.'));
      this.current = pending;
      signal.addEventListener('abort', aborted, { once: true });
      contents.once('destroyed', gone);
      contents.once('render-process-gone', gone);
      try {
        if (signal.aborted) aborted();
        else contents.downloadURL(blob.url);
      } catch (error) {
        pending.cancel(error instanceof Error ? error : new Error('The display Blob write could not start.'));
      }
    });
  }

  private readonly willDownload = (event: Event, item: DownloadItem, sender: WebContents | undefined) => {
    const pending = this.current;
    try {
      if (
        this.closed ||
        !pending ||
        sender?.id !== pending.contents.id ||
        item.getURL() !== pending.blob.url
      ) {
        event.preventDefault();
        return;
      }
      const chain = item.getURLChain();
      if (
        pending.item ||
        chain.length === 0 ||
        chain.some((url) => url !== pending.blob.url) ||
        item.getTotalBytes() !== pending.blob.bytes ||
        item.getReceivedBytes() > pending.blob.bytes
      ) {
        event.preventDefault();
        pending.cancel(new Error('The native display Blob identity or size differs.'));
        return;
      }
      pending.item = item;
      const updated = (_event: Event, state: string) => {
        if (
          state === 'interrupted' ||
          !Number.isSafeInteger(item.getReceivedBytes()) ||
          item.getReceivedBytes() < 0 ||
          item.getTotalBytes() !== pending.blob.bytes ||
          item.getReceivedBytes() > pending.blob.bytes
        ) {
          pending.cancel(new Error('The display Blob write was interrupted or exceeded its declared size.'));
        }
      };
      const done = (_event: Event, state: string) => {
        if (pending.failure) {
          pending.finish(pending.failure);
        } else if (
          state !== 'completed' ||
          item.getTotalBytes() !== pending.blob.bytes ||
          item.getReceivedBytes() !== pending.blob.bytes ||
          item.getSavePath() !== pending.destination
        ) {
          pending.finish(new Error('The display Blob file did not finish.'));
        } else {
          pending.finish();
        }
      };
      pending.detachNative = () => {
        item.removeListener('updated', updated);
        item.removeListener('done', done);
      };
      item.on('updated', updated);
      item.once('done', done);
      item.setSavePath(pending.destination);
    } catch (error) {
      event.preventDefault();
      pending?.cancel(
        error instanceof Error ? error : new Error('The display Blob file could not be saved.'),
      );
    }
  };

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.current?.cancel(new Error('Display Blob writes have stopped.'));
    // This one Session-lifetime listener keeps denying late requests during shutdown.
  }
}
