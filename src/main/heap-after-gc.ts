import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

/*
 * The main process's heap after a full collection (MB), for the Soak's samples (Sessions 31–36, PERF-4):
 * what is still held, not what waits to be collected. Only the Soak asks (drashtiDiagnostics); V8 gives
 * a context its gc function once --expose-gc is set, even after it started.
 */
export function heapAfterCollection(): number {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  gc();
  return process.memoryUsage().heapUsed / (1024 * 1024);
}
