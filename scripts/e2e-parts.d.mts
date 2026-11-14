export const PARTS: number;
export function testsOf(listing: unknown): string[];
export function partsCover(whole: string[], parts: string[][]): { ok: boolean; lines: string[] };
