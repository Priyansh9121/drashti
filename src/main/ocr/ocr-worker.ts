import { readFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { openReader, tidyRead } from './ocr-engine';
import type { ReaderJob, ReaderSays } from './reader-protocol';

/*
 * The reading process (book OCR, alpha.21): an Electron utility process, started for one reading and stopped once it
 * is done (or as Stop Reading is clicked), at the lowest priority, so neither Main's thread nor the show's screens
 * ever wait for a page to be read. It reads each picture's words with Tesseract inside Drashti (ocr-engine.ts) and says
 * each page's words as they come. It prints nothing and fetches nothing.
 */

const port = process.parentPort;

try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch {
  // Not allowed on this system: run at normal priority.
}

const say = (m: ReaderSays) => {
  port.postMessage(m);
};

async function run(job: ReaderJob): Promise<void> {
  let reader;
  try {
    reader = await openReader(job.files, (fraction) => {
      say({ kind: 'starting', fraction });
    });
  } catch {
    say({ kind: 'failed', page: null });
    return;
  }
  for (const [page, file] of job.pages.entries()) {
    let text: string;
    try {
      const image = new Uint8Array(await readFile(file));
      text = await reader.read(image, (fraction) => {
        say({ kind: 'reading', page, fraction });
      });
    } catch {
      say({ kind: 'failed', page });
      return;
    }
    say({ kind: 'page', page, text: tidyRead(text) });
  }
  say({ kind: 'done' });
}

port.once('message', (event: { data: unknown }) => {
  const job = event.data as ReaderJob;
  void run(job);
});
