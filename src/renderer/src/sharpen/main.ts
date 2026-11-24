import { makePictureCopy } from './make-copy';

/*
 * The hidden window that makes pictures' sharpened copies (Session 26f; src/main/media/sharpened.ts): one at a
 * time, each picture's bytes through the bridge and the copy back the same way. The display copies have a window
 * and a page of their own (display-main.ts, display-copy.html).
 */
async function run(): Promise<void> {
  // Return from this scope before asking for another job, releasing the previous job bytes and output.
  const one = async (): Promise<boolean> => {
    const job = await window.drashti.sharpen.next();
    if (!job) return false;
    let made: Uint8Array | null;
    try {
      made = await makePictureCopy(job);
    } catch {
      made = null;
    }
    return window.drashti.sharpen.made(job.key, made);
  };
  while (await one()) {
    // A moment between pictures: this window's process never holds on to the processor.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

void run();
