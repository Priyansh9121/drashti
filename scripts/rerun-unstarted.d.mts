import type { CiAnnotation, CiJob } from './release-gate.mjs';

export const MAX_ATTEMPTS: number;
export const GATE_BRANCHES: string[];
export interface CiRun {
  id: number;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string;
  run_attempt?: number;
  head_repository?: { full_name: string } | null;
}
export function rerunPlan(given: {
  run: CiRun;
  jobs: CiJob[];
  annotationsOf?: Record<number, CiAnnotation[]>;
  newestRunId: number | undefined;
  repository: string;
}): { rerun: true; jobs: CiJob[]; line: string } | { rerun: false; line: string };
