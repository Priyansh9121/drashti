/*
 * What the log says of an output the heartbeat restarts again and again (a23-heartbeat), on Main and on nodes.
 */

/** After "restarting it": which time in a row, from the second. */
export function restartsWords(inARow: number): string {
  return inARow > 1 ? ` (${String(inARow)} times in a row)` : '';
}

/** Said once, at the restart that tells the operator: what happens, and what to do. */
export function keepsRestartingLine(who: string, restarts: number): string {
  return `${who} was restarted ${String(restarts)} times in a row: its page stopped answering each time (this computer may be too slow for it, or something on it stops the page each time it loads). Drashti keeps restarting it, about once a minute; Screens and the status line say so, and Try again in Screens restarts it now.`;
}

/** Held for the owner (QA23-HEARTBEAT-1, A): said when a page is kept as it is instead of restarted. */
export function keptLine(who: string, reason: string, restarts: number): string {
  return `${who} is stuck again (${reason}) after ${String(restarts)} restarts in a row: Drashti stopped restarting it and left it as it is, so a slow computer can catch up; it is shown as Stopped, tried again by itself in a few minutes, and Try again restarts it now.`;
}
