import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { PptxReaderChild, ToPptxReader } from './pptx-reader-protocol';

export function spawnPptxReaderWorker(): PptxReaderChild {
  const child = utilityProcess.fork(join(__dirname, 'pptx-reader-worker.js'), [], {
    serviceName: 'Drashti document preparation',
    stdio: 'pipe',
  });
  let spawned = false;
  let pending: ToPptxReader | undefined;
  child.once('spawn', () => {
    spawned = true;
    if (pending) child.postMessage(pending);
    pending = undefined;
  });
  // Consume pipes without logging arbitrary parser/document output.
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return {
    post: (message) => {
      if (spawned) child.postMessage(message);
      else if (!pending) pending = message;
      else if (message.type === 'cancel') child.kill();
      else throw new Error('Document reader startup queue is full.');
    },
    onMessage: (listener) => {
      child.on('message', listener);
    },
    onExit: (listener) => {
      child.on('exit', listener);
    },
    kill: () => {
      pending = undefined;
      child.kill();
    },
  };
}
