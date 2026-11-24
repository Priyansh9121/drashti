import { makePictureBlob } from './make-copy';

/*
 * The hidden window that makes pictures' display copies (alpha.22; src/main/media/display-copies.ts): one
 * below-normal job at a time, its original streamed from the one source Main has granted it, the copy handed back
 * as a Blob for Main to save. It stays empty between jobs. Its own page (display-copy.html, QA22-L8-2).
 */
async function run(): Promise<void> {
  // Return from this scope before asking for another job, releasing the previous job bytes and output.
  const one = async (): Promise<boolean> => {
    const job = await window.drashti.displayCopies.next();
    if (!job) return false;
    let blob: Blob;
    let url: string;
    try {
      blob = await makePictureBlob(job);
      url = URL.createObjectURL(blob);
    } catch {
      return window.drashti.displayCopies.made(job.key, null);
    }
    try {
      return await window.drashti.displayCopies.made(job.key, { url, bytes: blob.size });
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  while (await one()) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

void run();
