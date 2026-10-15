import { beforeEach, describe, expect, it } from 'vitest';
import {
  BEHIND_MS,
  CHECK_EVERY_MS,
  OPEN_GRACE_MS,
  OutputHeartbeat,
  REPORT_STALE_MS,
  WARMING_STALE_MS,
} from './heartbeat';

/* Hung and stale outputs (Session 23): judged from the reports they already send. */

let now = 0;
let rev = 0;
let judged: string[] = [];
let stuck: { screenId: string; reason: string }[] = [];
let beat: OutputHeartbeat;

/**
 * Time passes, with a check every second and a report every 2 s from each output in `reporting` (still
 * warming up its GPU when `warming`).
 */
function run(ms: number, reporting: Record<string, () => number> = {}, warming = false) {
  for (let t = 0; t < ms; t += CHECK_EVERY_MS) {
    now += CHECK_EVERY_MS;
    if (now % 2000 === 0)
      for (const [id, painted] of Object.entries(reporting)) beat.report(id, painted(), warming);
    beat.check();
  }
}

beforeEach(() => {
  now = 0;
  rev = 0;
  judged = ['hall'];
  stuck = [];
  beat = new OutputHeartbeat({
    now: () => now,
    engineRev: () => rev,
    judged: () => judged,
    stuck: (screenId, reason) => stuck.push({ screenId, reason }),
  });
  beat.opened('hall');
});

describe('the outputs’ heartbeat', () => {
  it('the limits are generous: a few report gaps and a change painted late are well inside them', () => {
    expect(REPORT_STALE_MS).toBeGreaterThanOrEqual(3 * 2000);
    expect(BEHIND_MS).toBeGreaterThanOrEqual(90 * (1000 / 30));
    expect(OPEN_GRACE_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('a healthy output is never judged stuck, through many changes', () => {
    let painted = 0;
    for (let i = 0; i < 200; i++) {
      rev++;
      beat.changed(rev);
      painted = rev;
      run(1000, { hall: () => painted });
    }
    expect(stuck).toEqual([]);
  });

  it('an output still warming up its GPU is alive, and never judged behind meanwhile (Session 27)', () => {
    // A slow computer (an Intel build under Rosetta): warming up long past the open grace, the show changing.
    for (let i = 0; i < 40; i++) {
      rev++;
      beat.changed(rev);
      run(1000, { hall: () => 0 }, true);
    }
    expect(stuck).toEqual([]);
    // Drawing now: judged as any output, behind and all.
    rev++;
    beat.changed(rev);
    run(6000, { hall: () => 0 });
    expect(stuck.map((s) => s.reason)).toEqual([expect.stringMatching(/^painted revision 0 of/u)]);
  });

  it('a warming output’s reports may come far apart on a slow computer; silent for 30 s, it is stuck', () => {
    run(OPEN_GRACE_MS, { hall: () => 0 }, true);
    // A main thread busy for 10 s at a time (the warm-up on an emulated GPU): alive.
    for (let i = 0; i < 4; i++) {
      run(10_000);
      beat.report('hall', 0, true);
    }
    expect(stuck).toEqual([]);
    run(WARMING_STALE_MS + 1000);
    expect(stuck.map((s) => s.reason)).toEqual([expect.stringMatching(/^no report for 3\d s$/u)]);
  });

  it('an output whose reports stop is stuck about 6 s later, once, then given time to come back', () => {
    run(20_000, { hall: () => rev });
    expect(stuck).toEqual([]);
    run(REPORT_STALE_MS + 1000);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.reason).toMatch(/^no report for \d+ s$/u);
    // Restarting: not judged again within the grace, even though it is still silent.
    run(OPEN_GRACE_MS - 2000);
    expect(stuck).toHaveLength(1);
  });

  it('an output that reports but stops painting is stuck once a report comes 3 s after a change', () => {
    run(20_000, { hall: () => rev });
    const frozen = rev;
    rev++;
    beat.changed(rev);
    run(2000, { hall: () => frozen });
    expect(stuck).toEqual([]);
    run(2000, { hall: () => frozen });
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.reason).toContain(`painted revision ${frozen} of ${rev}`);
  });

  it('an output that is not visible or not showing is never judged; nor is one just opened', () => {
    judged = [];
    run(60_000);
    expect(stuck).toEqual([]);
    judged = ['hall'];
    beat.opened('hall');
    run(OPEN_GRACE_MS - 1000);
    expect(stuck).toEqual([]);
  });

  it('after the main process itself was held up, silence proves nothing', () => {
    run(20_000, { hall: () => rev });
    // Ten seconds with no check at all (a stall, a sleep), then checks again with reports.
    now += 10_000;
    beat.check();
    run(4000, { hall: () => rev });
    expect(stuck).toEqual([]);
  });
});
