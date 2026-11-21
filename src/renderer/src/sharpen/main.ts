import { makePictureBlob, makePictureCopy } from './make-copy';

/** One below-normal copy job at a time; the display worker stays empty between jobs. */
async function run(): Promise<void> {
  const display = new URLSearchParams(location.search).get('purpose') === 'display';
  // Return from this scope before asking for another job, releasing the previous job bytes and output.
  const one = async (): Promise<boolean> => {
    const job = await (display ? window.drashti.displayCopies.next() : window.drashti.sharpen.next());
    if (!job) return false;
    if (display) {
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
    }
    let made: Uint8Array | null;
    try {
      made = await makePictureCopy(job);
    } catch {
      made = null;
    }
    return window.drashti.sharpen.made(job.key, made);
  };
  while (await one()) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

void run();
