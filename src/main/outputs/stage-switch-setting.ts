/*
 * Stage as it starts (alpha.22): a stub until the change lands; Stage is on at every start, as before.
 */

/** The setting that keeps Stage on or off from one start to the next. */
export const STAGE_SETTING = 'stageSwitch';

export function stageStartsOn(_settings: { get(name: string): unknown }, _untold = false): boolean {
  return true;
}

export function keepStage(_settings: { set(name: string, value: unknown): void }, _on: boolean): void {
  // Nothing kept yet.
}
