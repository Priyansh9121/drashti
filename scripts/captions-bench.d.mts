/** Types for scripts/captions-bench.mjs (CAP-CI-1: the captions bench for the Performance workflow). */
export function benchFiles(out: string): { stop: string; exit: string; log: string; table: string };
export function benchCommand(): [string, string[]];
export const STOP_WAIT_MS: number;
