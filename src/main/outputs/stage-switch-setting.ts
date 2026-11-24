import { STARTS } from '../../shared/screen-switches';

/*
 * Stage as it starts (alpha.22; the owner, 24 Nov 2026: "by default it should be off. keep it off. i can turn on,
 * and then turn off"). Until alpha.22 both switches were on at every start, and nothing was kept. Now Stage is kept
 * in the library's settings each time it changes, and starts as it was left: off on a new library, and off once
 * after the update (nothing was kept before). Audience is still on at every start: the hall's screens are never
 * left off by a restart.
 */

/** The setting that keeps Stage on or off from one start to the next. */
export const STAGE_SETTING = 'stageSwitch';

/**
 * Whether Stage starts on: as it was left, else `untold` (off, as a new library starts; the e2e tests start it on,
 * DRASHTI_TEST_STAGE_AT_START, as every start was before alpha.22). Anything else kept there counts as never chosen.
 */
export function stageStartsOn(settings: { get(name: string): unknown }, untold = STARTS.stage): boolean {
  const kept = settings.get(STAGE_SETTING);
  if (kept === 'on') return true;
  if (kept === 'off') return false;
  return untold;
}

/** Keep Stage as it is now, for the next start. */
export function keepStage(settings: { set(name: string, value: unknown): void }, on: boolean): void {
  settings.set(STAGE_SETTING, on ? 'on' : 'off');
}
