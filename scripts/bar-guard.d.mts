export const WATCHED: string[];
export const BUDGETS: string[];
export const RATCHETS: [string, string, string[]][];
export function barsLowered(diff: string): string[];
export function countIn(ref: string, pattern: string, paths: string[]): number;
export function report(base: string, head?: string): string;
