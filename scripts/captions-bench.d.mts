/** Types for scripts/captions-bench.mjs (CAP-CI-1: the captions bench for the Performance workflow). */
export function benchFiles(out: string): { stop: string; exit: string; log: string; table: string };
export function benchCommand(): [string, string[]];
export const STOP_WAIT_MS: number;
/** Why a captions input is refused (as the bench's parseCaptionsInput refuses it), or null when it is good. */
export function checkCaptionsInput(input: string): string | null;
