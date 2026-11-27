/** The environment variables whose values never appear in a packaging failure's report. */
export const PACKAGING_SECRETS: readonly string[];
export interface PackagingFailureReport {
  /** One `::error` workflow command: the run's page keeps it when the job's log is lost. */
  annotation: string;
  /** Markdown for GITHUB_STEP_SUMMARY: the last lines electron-builder printed. */
  summary: string;
}
export function failureReport(
  output: string,
  options: { status: number; secrets?: readonly (string | undefined)[]; keep?: number },
): PackagingFailureReport;
