import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { AiChild } from './protocol';
export function spawnAiWorker(): AiChild {
  const child = utilityProcess.fork(join(__dirname, 'ai-worker.js'), [], {
    serviceName: 'Drashti offline helpers',
    stdio: 'pipe',
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  let spawned = false;
  const waiting: unknown[] = [];
  child.once('spawn', () => {
    spawned = true;
    for (const value of waiting) child.postMessage(value);
    waiting.length = 0;
  });
  return {
    post: (value) => {
      if (spawned) child.postMessage(value);
      else if (waiting.length < 16) waiting.push(value);
      else throw new Error('Offline helper queue is full.');
    },
    onMessage: (listener) => {
      child.on('message', listener);
    },
    onExit: (listener) => {
      child.on('exit', listener);
    },
    kill: () => {
      waiting.length = 0;
      child.kill();
    },
  };
}
