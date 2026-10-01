export function clearStaleTempRoots(base?: string, now?: number): number;
export function makeTempRoot(base?: string): string;
export function tempEnv(dir: string): { TMPDIR: string; TEMP: string; TMP: string };
export function removeTempRoot(dir: string): void;
