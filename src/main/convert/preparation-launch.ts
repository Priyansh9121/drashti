import { constants } from 'node:os';
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
const tools: PriorityTools = { inspect: '/bin/ps', lower: '/usr/bin/renice', assess: '/usr/bin/awk' };
const gate = `prep_inspect=$1; prep_lower=$2; prep_assess=$3; shift 3
prep_is_low() {
  "$prep_inspect" -o ni= -p "$$" 2>/dev/null | "$prep_assess" 'NR == 1 && $1 ~ /^-?[0-9]+$/ && ($1 + 0) >= ${String(constants.priority.PRIORITY_BELOW_NORMAL)} { ok = 1 } END { exit !ok }'
}
if ! prep_is_low; then
  "$prep_lower" ${String(constants.priority.PRIORITY_LOW)} -p "$$" >/dev/null 2>&1 || exit ${String(PRIORITY_FAILURE_EXIT)}
fi
prep_is_low || exit ${String(PRIORITY_FAILURE_EXIT)}
exec "$@"`;
/** Exec keeps the guarded PID, streams and cancellation; no media is read before priority is verified. */
export function preparationLaunch(
  file: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  priorityTools: PriorityTools = tools,
): PreparationLaunch {
  if (platform === 'win32') return { file, args, guarded: false };
  return {
    file: '/bin/sh',
    args: [
      '-c',
      gate,
      'drashti-preparation',
      priorityTools.inspect,
      priorityTools.lower,
      priorityTools.assess,
      file,
      ...args,
    ],
    guarded: true,
  };
}
