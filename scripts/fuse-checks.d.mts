export interface Verdict {
  ok: boolean;
  why: string;
}
export const FUSES: [number, number, string][];
export function fusesAsWanted(electron: string): Promise<Verdict>;
export function runAsNodeRefused(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  limitMs: number,
): Promise<Verdict>;
