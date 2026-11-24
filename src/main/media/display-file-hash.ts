import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { MAX_DISPLAY_COPY_BYTES } from '../../shared/pictures';

/** Same SHA256, one reused 64 KiB buffer, and an asynchronous file read between bounded hash updates. */
export async function hashDisplayFile(
  path: string,
  expectedBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (
    signal.aborted ||
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    expectedBytes > MAX_DISPLAY_COPY_BYTES
  ) {
    throw new Error('The display file cannot be checked.');
  }
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== expectedBytes) throw new Error('The display file size differs.');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    for (;;) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > expectedBytes) throw new Error('The display file grew during its check.');
      hash.update(buffer.subarray(0, bytesRead));
    }
    signal.throwIfAborted();
    if (total !== expectedBytes) throw new Error('The display file check did not finish.');
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}
