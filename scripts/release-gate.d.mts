export interface GateResult {
  ok: boolean;
  line: string;
}
export const APP_JOBS: string[];
export function tagCheck(lsRemote: string, version: string): GateResult;
export function mainCheck(lsRemote: string, sha: string): GateResult;
export function ciCheck(
  runs: { id: number; event: string; head_sha: string; run_attempt?: number }[],
  jobsOf: Record<number, { name: string; conclusion: string | null }[]>,
  sha: string,
): GateResult;
export function filesCheck(dir: string): Promise<GateResult[]>;
export function accessCheck(configText: string): GateResult;
