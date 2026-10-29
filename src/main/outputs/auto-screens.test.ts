import { describe, expect, it } from 'vitest';
import type { DisplayInfo, DisplayUse, ScreensSaid } from '../../shared/screens';
import type { JobFor } from './auto-screens';
import {
  AutoScreens,
  jobsFor,
  memoryNotUsed,
  NOT_USED_MAX,
  NotUsedDisplays,
  sayJobs,
  sayMirroring,
} from './auto-screens';

/*
 * Screens that set themselves (Session 55): a display plugged in is used at once, the first not the controls' the
 * audience picture, the next the stage; never the controls' display or a built-in one; a display set Not used by
 * hand stays so. Placeholder display names; the displays are this test's own.
 */

function display(
  id: number,
  label: string,
  x: number,
  hardwareId: string | null = null,
  internal = false,
): DisplayInfo {
  return {
    id,
    label,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workArea: { x, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    pixelWidth: 1920,
    pixelHeight: 1080,
    refreshHz: 60,
    rotation: 0,
    internal,
    primary: x === 0,
    key: { id, label, pixelWidth: 1920, pixelHeight: 1080, x, y: 0, internal, hardwareId },
  };
}

const laptop = display(1, 'Built-in', 0, null, true);
const desk = display(2, 'Desk monitor', 0);
const pjA = display(5, 'PLACEHOLDER PJ', 1920, 'edid:4183:1234:n1111');
const pjB = display(6, 'PLACEHOLDER PJ', 3840, 'edid:4183:1234:n2222');
const tv = display(7, 'PLACEHOLDER TV', 5760, 'edid:4183:99:n7');

const unused = (d: DisplayInfo): DisplayUse => ({
  displayId: d.id,
  screenId: null,
  groupId: null,
  role: null,
});
const used = (d: DisplayInfo, role: DisplayUse['role']): DisplayUse => ({
  displayId: d.id,
  screenId: `screen-${String(d.id)}`,
  groupId: `group-${String(role)}`,
  role,
});
const jobs = (list: JobFor[]) => list.map((j) => [j.display.id, j.job]);

describe('the jobs displays plugged in get', () => {
  it('the first not the controls’ shows the audience picture, the next the stage, any more the audience picture', () => {
    const all = [laptop, pjA, pjB, tv];
    expect(jobs(jobsFor(all, all.map(unused), 1, new Set()))).toEqual([
      [5, 'audience'],
      [6, 'stage'],
      [7, 'audience'],
    ]);
  });

  it('never the controls’ display, nor a computer’s built-in one, wherever the controls are', () => {
    // A desktop computer, its controls on its own monitor: the projector is the audience's.
    expect(jobs(jobsFor([desk, pjA], [unused(desk), unused(pjA)], 2, new Set()))).toEqual([[5, 'audience']]);
    // The controls moved to the projector: the laptop's own screen is never taken.
    expect(jobs(jobsFor([laptop, pjA], [unused(laptop), unused(pjA)], 5, new Set()))).toEqual([]);
  });

  it('a display plugged in beside one that shows the audience picture shows the stage; beside both, the audience', () => {
    expect(
      jobs(jobsFor([laptop, pjA, pjB], [unused(laptop), used(pjA, 'audience'), unused(pjB)], 1, new Set())),
    ).toEqual([[6, 'stage']]);
    // A key and fill pair's display sends the audience picture.
    expect(
      jobs(jobsFor([laptop, pjA, pjB], [unused(laptop), used(pjA, 'keyfill'), unused(pjB)], 1, new Set())),
    ).toEqual([[6, 'stage']]);
    expect(
      jobs(
        jobsFor(
          [laptop, pjA, pjB, tv],
          [unused(laptop), used(pjA, 'audience'), used(pjB, 'stage'), unused(tv)],
          1,
          new Set(),
        ),
      ),
    ).toEqual([[7, 'audience']]);
  });

  it('a display used already, or set Not used by hand, keeps it', () => {
    expect(
      jobsFor([laptop, pjA, pjB], [unused(laptop), used(pjA, 'stage'), unused(pjB)], 1, new Set([6])),
    ).toEqual([]);
  });
});

describe('what the notice says', () => {
  const unnamed = display(8, '', 7680);
  const all = [laptop, pjA, pjB, tv, unnamed];
  it('in one line, each display by its name (or its place when it has none)', () => {
    expect(sayJobs([{ display: pjA, job: 'audience' }], all)).toBe(
      '“PLACEHOLDER PJ” shows the audience picture.',
    );
    expect(sayJobs([{ display: tv, job: 'stage' }], all)).toBe('“PLACEHOLDER TV” shows the stage.');
    expect(
      sayJobs(
        [
          { display: pjA, job: 'audience' },
          { display: tv, job: 'stage' },
        ],
        all,
      ),
    ).toBe('“PLACEHOLDER PJ” shows the audience picture, and “PLACEHOLDER TV” the stage.');
    expect(
      sayJobs(
        [
          { display: pjA, job: 'audience' },
          { display: tv, job: 'stage' },
          { display: unnamed, job: 'audience' },
        ],
        all,
      ),
    ).toBe('“PLACEHOLDER PJ” and “Display 5” show the audience picture, and “PLACEHOLDER TV” the stage.');
  });

  it('how to extend, on a Mac and on Windows', () => {
    expect(sayMirroring(['PLACEHOLDER PJ'], 'darwin')).toBe(
      'This Mac is mirroring its screen onto “PLACEHOLDER PJ”, so Drashti sees one display. To give “PLACEHOLDER PJ” the audience picture, extend instead: in System Settings › Displays, choose “PLACEHOLDER PJ”, then Use as: Extended display.',
    );
    expect(sayMirroring(['PLACEHOLDER PJ'], 'win32')).toBe(
      'Windows shows the same picture on “PLACEHOLDER PJ” (Duplicate), so Drashti sees one display. To give “PLACEHOLDER PJ” the audience picture, extend instead: press Windows+P and choose Extend.',
    );
  });
});

describe('the displays set Not used by hand', () => {
  it('found by the display itself, wherever it is plugged in; given a job by hand, no longer', () => {
    const notUsed = memoryNotUsed();
    notUsed.remember(pjB.key);
    // Plugged into another port: another id and place, the same display.
    const moved = display(9, 'PLACEHOLDER PJ', 1920, 'edid:4183:1234:n2222');
    expect([...notUsed.among([laptop, pjA, moved])]).toEqual([9]);
    // Its twin (the same model) is not it.
    expect([...notUsed.among([laptop, pjA])]).toEqual([]);
    notUsed.forget(moved);
    expect([...notUsed.among([laptop, moved])]).toEqual([]);
  });

  it('kept in the library’s settings, at most fifty, each once; anything else there is none', () => {
    let kept: unknown = 'not a list';
    const notUsed = new NotUsedDisplays({
      get: () => kept,
      set: (v) => {
        kept = v;
      },
    });
    expect([...notUsed.among([pjA])]).toEqual([]);
    notUsed.remember(pjA.key);
    notUsed.remember(pjA.key);
    expect(kept).toEqual([pjA.key]);
    for (let i = 0; i < NOT_USED_MAX + 5; i++)
      notUsed.remember({ ...pjA.key, id: 1000 + i, hardwareId: `edid:1:1:n${String(i + 10)}` });
    expect(kept).toHaveLength(NOT_USED_MAX);
  });
});

describe('giving them their jobs', () => {
  function auto(options: {
    on?: boolean;
    displays: DisplayInfo[];
    uses?: DisplayUse[];
    mirrored?: string[];
  }) {
    const said: ScreensSaid[] = [];
    const given: JobFor[][] = [];
    const notUsed = memoryNotUsed();
    let uses = options.uses ?? options.displays.map(unused);
    let mirrored = options.mirrored ?? [];
    const a = new AutoScreens({
      on: options.on ?? true,
      displays: () => options.displays,
      uses: () => uses,
      controlsDisplayId: () => 1,
      notUsed,
      give: (jobs) => {
        given.push([...jobs]);
        uses = uses.map((u) => {
          const j = jobs.find((x) => x.display.id === u.displayId);
          return j ? used(j.display, j.job) : u;
        });
        return { ok: true, snapshot: { displays: [], groups: [], status: [], nodes: [], uses: [] } };
      },
      said: (s) => said.push(s),
      mirroredOnto: () => mirrored,
      platform: 'darwin',
      log: () => undefined,
    });
    return {
      a,
      said,
      given,
      notUsed,
      mirror: (m: string[]) => {
        mirrored = m;
      },
    };
  }

  it('gives them at once and says so once, with the displays it is about; the next check has nothing to give', () => {
    const t = auto({ displays: [laptop, pjA, pjB] });
    t.a.check();
    expect(t.given.map(jobs)).toEqual([
      [
        [5, 'audience'],
        [6, 'stage'],
      ],
    ]);
    expect(t.said).toEqual([
      {
        id: 1,
        kind: 'set',
        text: '“PLACEHOLDER PJ” shows the audience picture, and “PLACEHOLDER PJ” the stage.',
        displayIds: [5, 6],
      },
    ]);
    t.a.check();
    expect(t.given).toHaveLength(1);
    expect(t.said).toHaveLength(1);
  });

  it('a display set Not used by hand is left alone; off (tests not about it), nothing at all', () => {
    const t = auto({ displays: [laptop, pjA] });
    t.notUsed.remember(pjA.key);
    t.a.check();
    expect(t.given).toEqual([]);
    expect(t.said).toEqual([]);
    const off = auto({ on: false, displays: [laptop, pjA], mirrored: ['PLACEHOLDER PJ'] });
    off.a.check();
    expect(off.given).toEqual([]);
    expect(off.said).toEqual([]);
  });

  it('mirroring is said once, and again only once it has stopped and started again', () => {
    const t = auto({ displays: [laptop], mirrored: ['PLACEHOLDER PJ'] });
    t.a.check();
    t.a.check();
    expect(t.said.map((s) => s.kind)).toEqual(['mirroring']);
    expect(t.said[0]?.text).toContain('extend instead');
    t.mirror([]);
    t.a.check();
    t.mirror(['PLACEHOLDER PJ']);
    t.a.check();
    expect(t.said.map((s) => s.kind)).toEqual(['mirroring', 'mirroring']);
  });
});
