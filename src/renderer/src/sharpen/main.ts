import { makePictureCopy } from './make-copy';

/** One below-normal copy job at a time; the display worker stays empty between jobs. */
async function run(): Promise<void> {
  const service =
    new URLSearchParams(location.search).get('purpose') === 'display'
      ? window.drashti.displayCopies
      : window.drashti.sharpen;
  // Return from this scope before asking for another job, releasing the previous job bytes and output.
  const one = async (): Promise<boolean> => {
    const job = await service.next();
    if (!job) return false;
    let made: Uint8Array | null;
    try {
      made = await makePictureCopy(job);
    } catch {
      made = null;
    }
    return service.made(job.key, made);
  };
  while (await one()) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

void run();
