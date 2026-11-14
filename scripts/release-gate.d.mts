export interface GateResult {
  ok: boolean;
  line: string;
}
/** A CI job as GitHub's API gives it (a run's jobs), as far as the gate reads it. */
export interface CiJob {
  id?: number;
  name: string;
  status?: string;
  conclusion: string | null;
  steps?: unknown[];
  runner_id?: number | null;
  runner_name?: string | null;
}
/** A check run's annotation as GitHub's API gives it, as far as the gate reads it. */
export interface CiAnnotation {
  annotation_level?: string;
  message?: string | null;
}
export const APP_JOBS: string[];
export const NO_RUNNER_SAID: RegExp;
export function tagCheck(lsRemote: string, version: string): GateResult;
export function mainCheck(lsRemote: string, sha: string): GateResult;
export function ranNothing(job: CiJob): boolean;
export function neverStarted(job: CiJob, annotations?: CiAnnotation[]): boolean;
export function jobState(job: CiJob | undefined, annotations?: CiAnnotation[]): string;
export function ciCheck(
  runs: { id: number; event: string; head_sha: string; run_attempt?: number }[],
  jobsOf: Record<number, CiJob[]>,
  sha: string,
  annotationsOf?: Record<number, CiAnnotation[]>,
): GateResult;
export function filesCheck(dir: string): Promise<GateResult[]>;
export function accessCheck(configText: string): GateResult;
