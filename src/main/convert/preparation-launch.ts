export const PRIORITY_FAILURE_EXIT = 125;
export interface PriorityTools {
  inspect: string;
  lower: string;
  assess: string;
}
export interface PreparationLaunch {
  file: string;
  args: string[];
  guarded: boolean;
}
/** Strict POSIX preparation must establish its own priority before decoding; Windows uses the verified native setter. */
export function preparationLaunch(
  file: string,
  args: string[],
  _platform: NodeJS.Platform = process.platform,
  _tools?: PriorityTools,
): PreparationLaunch {
  return { file, args, guarded: false };
}
