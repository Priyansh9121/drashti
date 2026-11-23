import { utilityProcess } from 'electron';
import type { OcrFiles } from './ocr-engine';
import type { ReaderSays } from './reader-protocol';
import { isReaderSays, READER_SERVICE_NAME } from './reader-protocol';

/*
 * Main's side of the reading process (book OCR, alpha.21; ocr-worker.ts): started for one reading, given its pictures,
 * heard as it goes, and stopped once it is done, fails or is stopped. `gone`: it ended before it was done.
 */

export interface ReaderHandle {
  stop(): void;
}

export function startReader(
  workerPath: string,
  files: OcrFiles,
  pages: string[],
  said: (m: ReaderSays | { kind: 'gone' }) => void,
): ReaderHandle {
  const child = utilityProcess.fork(workerPath, [], { serviceName: READER_SERVICE_NAME, stdio: 'ignore' });
  let over = false;
  const end = () => {
    over = true;
    child.kill();
  };
  child.once('spawn', () => {
    if (!over) child.postMessage({ files, pages });
  });
  child.on('message', (message: unknown) => {
    if (over) return;
    if (!isReaderSays(message)) {
      end();
      said({ kind: 'gone' });
      return;
    }
    if (message.kind === 'done' || message.kind === 'failed') end();
    said(message);
  });
  child.once('exit', () => {
    if (over) return;
    over = true;
    said({ kind: 'gone' });
  });
  return {
    stop: () => {
      if (!over) end();
    },
  };
}
