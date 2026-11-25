import { beforeEach, describe, expect, it } from 'vitest';
import {
  BEHIND_MS,
  CHECK_EVERY_MS,
  OPEN_GRACE_MS,
  OutputHeartbeat,
  REPORT_STALE_MS,
  RESTART_GRACE_MAX_MS,
  RESTARTS_FORGET_MS,
  RESTARTS_TOLD,
  WARMING_STALE_MS,
} from './heartbeat';

/* Hung and stale outputs (Session 23): judged from the reports they already send. */

let now = 0;
let rev = 0;
let judged: string[] = [];
let stuck: { screenId: string; reason: string; at: number; inARow: number }[] = [];
/** What the operator was told of outputs restarted again and again (a23-heartbeat). */
let told: { screenId: string; restarts: number | null }[] = [];
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

/** A heartbeat as Main makes one, its output 'hall' just opened; `translated` as under Rosetta (a23-heartbeat). */
function make(translated = false) {
  beat = new OutputHeartbeat({
    now: () => now,
    engineRev: () => rev,
    judged: () => judged,
    stuck: (screenId, reason, inARow) => stuck.push({ screenId, reason, at: now, inARow }),
    told: (screenId, restarts) => told.push({ screenId, restarts }),
    translated,
  });
  beat.opened('hall');
}

/** Time passes, a check every second, until the heartbeat judges one more output stuck (at most `ms`): when. */
function untilStuck(ms = 10 * 60_000, reporting: Record<string, () => number> = {}): number {
  const before = stuck.length;
  for (let t = 0; t < ms && stuck.length === before; t += CHECK_EVERY_MS) run(CHECK_EVERY_MS, reporting);
  return now;
}

/** The watchdog's reload of a restarted output, a second after: its page loads again (index.ts's opened()). */
function reloaded(screenId = 'hall') {
  run(1000);
  beat.opened(screenId);
}

beforeEach(() => {
  now = 0;
  rev = 0;
  judged = ['hall'];
  stuck = [];
  told = [];
  make();
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

/**
 * Today's heartbeat (Session 23, before a23-heartbeat), for a page that paints every change at once: judged once its
 * 15 s grace is over and nothing has come for more than 6 s, then the same grace again. When it restarted the page.
 */
function restartsBefore(reportsAt: ReadonlySet<number>, until: number): number[] {
  let since = 0;
  let heardAt: number | null = null;
  const at: number[] = [];
  for (let t = CHECK_EVERY_MS; t <= until; t += CHECK_EVERY_MS) {
    if (reportsAt.has(t)) heardAt = t;
    if (t - since < 15_000 || t - (heardAt ?? since) <= 6000) continue;
    at.push(t);
    since = t;
    heardAt = null;
  }
  return at;
}

describe('a slow output page is not restarted for good (a23-heartbeat: an Intel build under Rosetta, alpha.22)', () => {
  it('under translation, an output’s reports may come as far apart as a warming one’s; silent past 30 s, it is stuck', () => {
    make(true);
    run(20_000, { hall: () => rev });
    // A translated page's main thread busy for 25 s at a time (its code, its fonts): alive.
    for (let i = 0; i < 4; i++) {
      run(25_000);
      beat.report('hall', rev);
    }
    expect(stuck).toEqual([]);
    const last = now;
    expect(untilStuck() - last).toBe(WARMING_STALE_MS + 1000);
    expect(stuck.map((s) => s.reason)).toEqual(['no report for 31 s']);
  });

  it('under translation, a page slow to send its first report is not restarted at the 15 s grace; one never heard from is, after 31 s', () => {
    make(true);
    // CI's Rosetta Mac: the output's first report came 15-20 s after it opened, and it was restarted each time.
    run(25_000);
    beat.report('hall', rev);
    run(20_000, { hall: () => rev });
    expect(stuck).toEqual([]);
    // Loaded again, and never heard from since.
    beat.opened('hall');
    const opened = now;
    expect(untilStuck() - opened).toBe(WARMING_STALE_MS + 1000);
    expect(stuck.map((s) => s.reason)).toEqual(['no report for 31 s']);
  });

  it('not translated, the limits are as before: stuck 7 s after the last report, and a page never heard from 15 s after it opens', () => {
    run(20_000, { hall: () => rev });
    const last = now;
    expect(untilStuck() - last).toBe(REPORT_STALE_MS + 1000);
    expect(stuck.map((s) => s.reason)).toEqual(['no report for 7 s']);
    // Another output opened and never heard from: judged as soon as its grace is over, as before.
    judged = ['hall', 'side'];
    beat.opened('side');
    const opened = now;
    expect(untilStuck(60_000, { hall: () => rev }) - opened).toBe(OPEN_GRACE_MS);
    expect(stuck.at(-1)).toEqual({
      screenId: 'side',
      reason: 'no report for 15 s',
      at: opened + OPEN_GRACE_MS,
      inARow: 1,
    });
  });

  it('each restart of the same output doubles its next grace, up to 60 s: never heard from, it is restarted 15 s after it opens, then 30 s and 60 s after each reload', () => {
    const after: number[] = [];
    let openedAt = now;
    for (let i = 0; i < 4; i++) {
      after.push(untilStuck() - openedAt);
      reloaded();
      openedAt = now;
    }
    expect(after).toEqual([OPEN_GRACE_MS, 2 * OPEN_GRACE_MS, RESTART_GRACE_MAX_MS, RESTART_GRACE_MAX_MS]);
    expect(RESTART_GRACE_MAX_MS).toBe(60_000);
  });

  it('under translation too, the grace after each restart grows, and the 30 s limit still holds within it', () => {
    make(true);
    const after: number[] = [];
    let openedAt = now;
    for (let i = 0; i < 4; i++) {
      after.push(untilStuck() - openedAt);
      reloaded();
      openedAt = now;
    }
    expect(after).toEqual([31_000, 31_000, 60_000, 60_000]);
  });

  it('the count is each output’s own: another output’s restarts do not lengthen its grace', () => {
    judged = ['hall', 'side'];
    beat.opened('side');
    const hall = { hall: () => rev };
    // The side screen is never heard from: restarted twice.
    untilStuck(undefined, hall);
    reloaded('side');
    untilStuck(undefined, hall);
    reloaded('side');
    expect(stuck.map((s) => s.screenId)).toEqual(['side', 'side']);
    // The hall's reports stop: stuck 7 s after, as before; its first restart, so 30 s of grace after its reload.
    judged = ['hall'];
    untilStuck();
    reloaded();
    const opened = now;
    expect(untilStuck() - opened).toBe(2 * OPEN_GRACE_MS);
    expect(stuck.map((s) => s.screenId)).toEqual(['side', 'side', 'hall', 'hall']);
  });

  it('back for less than 5 minutes, a page keeps its count; back for longer, its next restart is a first one again', () => {
    const hall = { hall: () => rev };
    // Restarted twice in a row (never heard from), then back for 2 minutes.
    untilStuck();
    reloaded();
    untilStuck();
    reloaded();
    run(2 * 60_000, hall);
    // Its reports stop: restarted (the third in a row), so 60 s of grace after the reload.
    untilStuck();
    reloaded();
    let opened = now;
    expect(untilStuck() - opened).toBe(RESTART_GRACE_MAX_MS);
    reloaded();
    // Back for longer than RESTARTS_FORGET_MS: the next restart is a first one, 30 s of grace after it.
    run(RESTARTS_FORGET_MS, hall);
    untilStuck();
    reloaded();
    opened = now;
    expect(untilStuck() - opened).toBe(2 * OPEN_GRACE_MS);
    expect(stuck).toHaveLength(6);
  });

  it('an output closed and made again starts afresh: 15 s of grace', () => {
    untilStuck();
    reloaded();
    untilStuck();
    beat.closed('hall');
    beat.opened('hall');
    const opened = now;
    expect(untilStuck() - opened).toBe(OPEN_GRACE_MS);
  });

  it('a healthy screen is never restarted, translated or not, even after a restart earlier: reports every 2 s through an hour of changes', () => {
    for (const translated of [false, true]) {
      now = 0;
      rev = 0;
      stuck = [];
      make(translated);
      // One restart early on (a hang its reload cured), then an hour of the show changing every 3 s.
      untilStuck();
      reloaded();
      let painted = rev;
      for (let i = 0; i < 1200; i++) {
        rev++;
        beat.changed(rev);
        painted = rev;
        run(3000, { hall: () => painted });
      }
      expect(stuck).toHaveLength(1);
    }
  });

  it('a page is never restarted more often than before, translated or not, however its reports come (100 made-up pages, 30 minutes each)', () => {
    let seed = 23;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const until = 30 * 60_000;
    let before = 0;
    const totals = { untranslated: 0, translated: 0 };
    for (let page = 0; page < 100; page++) {
      // Reports every 2 s, with gaps now and then: most short, some long (a busy page), some for a minute.
      const reportsAt = new Set<number>();
      for (let t = 2000; t <= until; t += random() < 0.9 ? 2000 : 2000 * Math.ceil(random() * 30))
        reportsAt.add(t);
      const today = restartsBefore(reportsAt, until).length;
      before += today;
      for (const translated of [false, true]) {
        now = 0;
        rev = 0;
        stuck = [];
        make(translated);
        for (let t = 0; t < until; t += CHECK_EVERY_MS) {
          now += CHECK_EVERY_MS;
          if (reportsAt.has(now)) beat.report('hall', rev);
          beat.check();
        }
        expect(stuck.length).toBeLessThanOrEqual(today);
        totals[translated ? 'translated' : 'untranslated'] += stuck.length;
      }
    }
    // Not an empty proof: before, these pages were restarted, and they still are, only less often.
    expect(before).toBeGreaterThan(100);
    expect(totals.untranslated).toBeGreaterThan(0);
    expect(totals.untranslated).toBeLessThan(before);
    expect(totals.translated).toBeLessThan(totals.untranslated);
  });

  it('a truly hung page (no reports at all) is still restarted, translated or not, again after each grace while it stays hung', () => {
    for (const translated of [false, true]) {
      now = 0;
      rev = 0;
      stuck = [];
      make(translated);
      run(20_000, { hall: () => rev });
      const last = now;
      // Hung for good: its first restart comes at once after the limit, and each reload is judged again.
      const at: number[] = [];
      for (let i = 0; i < 4; i++) {
        at.push(untilStuck() - last);
        reloaded();
      }
      expect(at[0]).toBe(translated ? WARMING_STALE_MS + 1000 : REPORT_STALE_MS + 1000);
      expect(at).toHaveLength(4);
      expect(at.at(-1)).toBeLessThan(4 * 60_000);
    }
  });
});

describe('the operator is told of an output restarted again and again (a23-heartbeat)', () => {
  /** Restarted `n` times in a row, never heard from, each reloaded a second after. */
  const restartedInARow = (n: number) => {
    for (let i = 0; i < n; i++) {
      untilStuck();
      reloaded();
    }
  };

  it('each restart says which it is in a row; from the 4th the operator is told, with the count, on each restart after', () => {
    restartedInARow(3);
    expect(told).toEqual([]);
    restartedInARow(2);
    expect(stuck.map((s) => s.inARow)).toEqual([1, 2, 3, 4, 5]);
    expect(told).toEqual([
      { screenId: 'hall', restarts: 4 },
      { screenId: 'hall', restarts: 5 },
    ]);
    expect(RESTARTS_TOLD).toBe(4);
  });

  it('told, it is told no more only once it has drawn the show and kept reporting for over a minute (review S1)', () => {
    restartedInARow(4);
    rev++;
    beat.changed(rev);
    // A report behind the show (4 s after the change, not painted) is not drawing.
    run(4000, { hall: () => rev - 1 });
    // Drawing the show: one report is not enough, nor 60 s of them.
    run(2000, { hall: () => rev });
    run(RESTART_GRACE_MAX_MS - 2000, { hall: () => rev });
    expect(told).toEqual([{ screenId: 'hall', restarts: 4 }]);
    run(4000, { hall: () => rev });
    expect(told.at(-1)).toEqual({ screenId: 'hall', restarts: null });
    expect(told).toHaveLength(2);
    // Its count is kept: silent again within 5 minutes, its next restart is the 5th in a row, said at once.
    untilStuck();
    expect(stuck.at(-1)?.inARow).toBe(5);
    expect(told.at(-1)).toEqual({ screenId: 'hall', restarts: 5 });
  });

  it('a page that draws the show after each reload and then stops again stays told the whole time (review S1)', () => {
    restartedInARow(4);
    for (let i = 0; i < 3; i++) {
      // It draws for 20 s after its reload, then stops: restarted again.
      run(20_000, { hall: () => rev });
      untilStuck();
      reloaded();
    }
    expect(stuck.map((s) => s.inARow)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(told.map((t) => t.restarts)).toEqual([4, 5, 6, 7]);
  });

  it('told, a page that reports but has not painted its first frame (paintedRev -1) is not drawing: still told after 2 minutes of it (review R2-S1)', () => {
    restartedInARow(4);
    run(2 * 60_000, { hall: () => -1 });
    expect(told).toEqual([{ screenId: 'hall', restarts: 4 }]);
    // Nor is it judged for it, as before (why() is unchanged).
    expect(stuck).toHaveLength(4);
  });

  it('a gap in its reports longer than the limit starts its minute of drawing again (review S1)', () => {
    restartedInARow(4);
    // Inside its 60 s grace: 30 s drawing, 10 s silent, then drawing again.
    run(30_000, { hall: () => rev });
    run(10_000);
    run(40_000, { hall: () => rev });
    expect(told).toEqual([{ screenId: 'hall', restarts: 4 }]);
    run(24_000, { hall: () => rev });
    expect(told.at(-1)).toEqual({ screenId: 'hall', restarts: null });
  });

  it('while the show changes, a report that has not yet painted a change younger than 3 s still counts as drawing (review S3)', () => {
    restartedInARow(4);
    let painted = rev;
    // The show changes every 3 s and each change is painted 1 s later: always a little behind, never late.
    for (let i = 0; i < 30; i++) {
      rev++;
      beat.changed(rev);
      run(1000, { hall: () => painted });
      painted = rev;
      run(2000, { hall: () => painted });
    }
    expect(told.at(-1)).toEqual({ screenId: 'hall', restarts: null });
    expect(stuck).toHaveLength(4);
  });

  it('tried afresh (Try again, or the watchdog’s own try), its count starts again and it is told no more', () => {
    restartedInARow(4);
    beat.afresh('hall');
    expect(told.at(-1)).toEqual({ screenId: 'hall', restarts: null });
    // Its reload: the first grace, and the next restart is a first one.
    beat.opened('hall');
    const opened = now;
    expect(untilStuck() - opened).toBe(OPEN_GRACE_MS);
    expect(stuck.at(-1)?.inARow).toBe(1);
    expect(told).toHaveLength(2);
    // Tried afresh when it was never told: nothing to say.
    beat.afresh('hall');
    expect(told).toHaveLength(2);
  });

  it('its count forgotten (5 minutes with no restart) or its window closed, it is told no more', () => {
    restartedInARow(4);
    // Not judged meanwhile (its display away, say): 5 minutes on, its count is forgotten.
    judged = [];
    run(RESTARTS_FORGET_MS - 2000);
    expect(told).toHaveLength(1);
    run(2000);
    expect(told.at(-1)).toEqual({ screenId: 'hall', restarts: null });
    // Judged again from a first restart; told again only at the 4th.
    judged = ['hall'];
    beat.opened('hall');
    restartedInARow(4);
    expect(told.map((t) => t.restarts)).toEqual([4, null, 4]);
    beat.closed('hall');
    expect(told.at(-1)).toEqual({ screenId: 'hall', restarts: null });
  });
});
