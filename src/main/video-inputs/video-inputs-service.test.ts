import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackgroundLayer, InputBackground, PipLayer } from '../../shared/engine/state';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import type { CameraAccess, VideoInput, VideoInputsView, VideoInputStatus } from '../../shared/video-inputs';
import type { CameraSystem } from './camera';
import { VIDEO_INPUTS_FILE } from './video-inputs-file';
import { RESTORE_WAIT_MS, VideoInputsService } from './video-inputs-service';

/* Video inputs in the main process (Session 50): placeholder names, stand-ins for the camera and the engine. */

/** Each setup's own data folder, removed after each test. */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PAGE_LIVE = 11;
const PAGE_OUTPUT = 12;

function setup(options: { access?: CameraAccess } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-inputs-'));
  dirs.push(dir);
  let background: BackgroundLayer | null = null;
  // The picture-in-picture box (Session 50), holding a video input or not, and how often it was taken off.
  let box: PipLayer | null = null;
  let takenOff = 0;
  let access: CameraAccess = options.access ?? 'granted';
  const views: VideoInputsView[] = [];
  const statuses: VideoInputStatus[] = [];
  const refreshed: VideoInput[] = [];
  const lines: string[] = [];
  let cleared = 0;
  const waits: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const camera: CameraSystem = {
    access: () => access,
    ask: () => {
      if (access === 'not-determined') access = 'granted';
      return Promise.resolve(access);
    },
    openSettings: () => Promise.resolve(),
  };
  let service: VideoInputsService | null = null;
  const make = () =>
    new VideoInputsService({
      userData: dir,
      camera,
      background: () => background,
      box: () => box,
      clearBackground: () => {
        cleared++;
        background = null;
        service?.follow();
      },
      takeOffBox: () => {
        takenOff++;
        box = null;
        service?.follow();
      },
      refresh: (input) => refreshed.push(input),
      changed: (view) => views.push(view),
      statusChanged: (status) => statuses.push(status),
      log: (_level, line) => lines.push(line),
      schedule: (ms, run) => {
        const wait = { ms, run, cancelled: false };
        waits.push(wait);
        return () => {
          wait.cancelled = true;
        };
      },
      retryMs: 5,
    });
  service = make();
  const up = (input: VideoInput, startedAt = 5000): InputBackground => {
    const layer: InputBackground = {
      kind: 'input',
      inputId: input.id,
      name: input.name,
      device: input.device,
      fit: input.fit,
      startedAt,
    };
    background = layer;
    service.follow();
    return layer;
  };
  return {
    dir,
    service,
    make,
    views,
    statuses,
    refreshed,
    lines,
    waits,
    up,
    cleared: () => cleared,
    takenOff: () => takenOff,
    setBackground: (layer: BackgroundLayer | null) => {
      background = layer;
      service.follow();
    },
    setAccess: (a: CameraAccess) => {
      access = a;
    },
    /** This input in the box, up from `shownAt` (the engine tells the service of each change), or none. */
    setBox: (input: VideoInput | null, shownAt = 6000) => {
      box = input
        ? {
            source: { kind: 'input', inputId: input.id, name: input.name, device: input.device },
            place: DEFAULT_PIP_PLACE,
            swapped: false,
            shownAt,
          }
        : null;
      service.follow();
    },
    /** Anything else in the box (the slides). */
    setBoxSlides: () => {
      box = { source: { kind: 'slides' }, place: DEFAULT_PIP_PLACE, swapped: false, shownAt: 7000 };
      service.follow();
    },
  };
}

const fields = { name: 'Placeholder input', device: 'Placeholder camera', fit: 'fit' } as const;

/** The input the result holds, by its name. */
function added(result: ReturnType<VideoInputsService['add']>, name: string): VideoInput {
  if (!result.ok) throw new Error(result.message);
  const input = result.view.inputs.find((i) => i.name === name);
  if (!input) throw new Error(`no input called ${name}`);
  return input;
}

describe('this computer’s video inputs', () => {
  it('are named in Media, kept in the data folder, and the operator window hears of each change', () => {
    const { dir, service, make, views } = setup();
    expect(service.view()).toEqual({ inputs: [] });
    const one = added(service.add(fields), 'Placeholder input');
    expect(one).toEqual({ id: one.id, ...fields });
    expect(one.id.length).toBeGreaterThan(8);
    const two = added(
      service.add({ name: '  Placeholder mixer  ', device: 'Placeholder capture', fit: 'fill' }),
      'Placeholder mixer',
    );
    expect(service.view().inputs.map((i) => i.name)).toEqual(['Placeholder input', 'Placeholder mixer']);
    expect(service.get(two.id)).toEqual(two);
    expect(service.get('no-such-input')).toBeNull();
    expect(views.at(-1)).toEqual(service.view());
    expect(views).toHaveLength(2);
    // Kept on this computer: a later start reads the same list.
    expect(
      (JSON.parse(readFileSync(join(dir, VIDEO_INPUTS_FILE), 'utf8')) as { inputs: unknown[] }).inputs,
    ).toHaveLength(2);
    expect(make().view()).toEqual(service.view());
  });

  it('refuses what it cannot keep, and says why', () => {
    const { service, views } = setup();
    added(service.add(fields), 'Placeholder input');
    const refused = (result: ReturnType<VideoInputsService['add']>) => (result.ok ? 'kept' : result.message);
    expect(refused(service.add({ ...fields, name: '   ' }))).toBe(
      'Give the video input a name, such as “Input 1”.',
    );
    expect(refused(service.add({ ...fields, name: 'x'.repeat(61) }))).toBe(
      'A video input’s name has 60 characters at most.',
    );
    expect(refused(service.add({ ...fields, name: 'placeholder INPUT' }))).toBe(
      'There is already a video input called “Placeholder input”: give this one another name.',
    );
    expect(refused(service.add({ ...fields, name: 'Another', device: '' }))).toBe(
      'Choose one of this computer’s cameras or capture inputs.',
    );
    for (const bad of [null, 'Input 1', { ...fields, fit: 'stretch' }, { name: 'Another' }])
      expect(refused(service.add(bad)), JSON.stringify(bad)).toBe('That video input cannot be kept.');
    for (let i = 2; i <= 20; i++)
      added(service.add({ ...fields, name: `Placeholder ${String(i)}` }), `Placeholder ${String(i)}`);
    expect(refused(service.add({ ...fields, name: 'One too many' }))).toBe(
      'This computer keeps 20 video inputs at most: remove one first.',
    );
    expect(service.view().inputs).toHaveLength(20);
    // Only what was kept was told.
    expect(views).toHaveLength(20);
  });

  it('a change follows on the screens while that input is up; one up is never removed (the screens open only what is listed)', () => {
    const { service, refreshed, cleared, up, setBackground } = setup();
    const one = added(service.add(fields), 'Placeholder input');
    const two = added(service.add({ ...fields, name: 'Placeholder mixer' }), 'Placeholder mixer');
    // Not up: the list changes, the screens are not told.
    expect(service.update(two.id, { fit: 'fill' })).toMatchObject({ ok: true });
    expect(refreshed).toEqual([]);
    up(one);
    const renamed = service.update(one.id, { name: 'Placeholder program', fit: 'fill' });
    expect(renamed.ok).toBe(true);
    expect(refreshed).toEqual([{ ...one, name: 'Placeholder program', fit: 'fill' }]);
    expect(service.get(one.id)).toEqual({ ...one, name: 'Placeholder program', fit: 'fill' });
    expect(service.update(one.id, { name: 'placeholder MIXER' })).toEqual({
      ok: false,
      message: 'There is already a video input called “Placeholder mixer”: give this one another name.',
    });
    // Its own name again, in other letters, is not another's.
    expect(service.update(one.id, { name: 'PLACEHOLDER PROGRAM' }).ok).toBe(true);
    expect(service.update('gone', { name: 'Placeholder' })).toEqual({
      ok: false,
      message: 'That video input is no longer on this computer.',
    });
    expect(service.update(one.id, { fit: 'stretch' })).toEqual({
      ok: false,
      message: 'That video input cannot be kept.',
    });
    // Up now: not removed (the screens draw only an input in this list), and the show is left as it is.
    expect(service.remove(one.id)).toEqual({
      ok: false,
      message: '“PLACEHOLDER PROGRAM” is on the screens: clear it first, then remove it.',
    });
    expect(service.view().inputs).toHaveLength(2);
    expect(cleared()).toBe(0);
    // Cleared: removed.
    setBackground(null);
    expect(service.remove(one.id)).toEqual({ ok: true, view: { inputs: [{ ...two, fit: 'fill' }] } });
    expect(service.remove(one.id)).toEqual({
      ok: false,
      message: 'That video input is no longer on this computer.',
    });
  });
});

describe('a video input in the picture-in-picture box (Session 50, section 8 review)', () => {
  it('is followed when it changes, and never removed while in the box, as the background’s is', () => {
    const { service, refreshed, setBox } = setup();
    const one = added(service.add(fields), 'Placeholder input');
    setBox(one);
    expect(service.update(one.id, { name: 'Placeholder box' }).ok).toBe(true);
    expect(refreshed).toEqual([{ ...one, name: 'Placeholder box' }]);
    expect(service.remove(one.id)).toEqual({
      ok: false,
      message: '“Placeholder box” is in the picture-in-picture box: take it off first, then remove it.',
    });
    setBox(null);
    expect(service.remove(one.id).ok).toBe(true);
  });
});

describe('the input on the screens', () => {
  it('stopped: said while any screen drawing it says so (unplugged, taken by another app), and not once it plays again', () => {
    const { service, statuses, up } = setup();
    const one = added(service.add(fields), 'Placeholder input');
    expect(service.status()).toEqual({ stopped: null, access: 'granted' });
    up(one);
    service.report(PAGE_LIVE, { inputId: one.id, state: 'playing' });
    service.report(PAGE_OUTPUT, { inputId: one.id, state: 'stopped' });
    expect(service.status()).toEqual({ stopped: { inputId: one.id, name: one.name }, access: 'granted' });
    expect(statuses.at(-1)).toEqual(service.status());
    // A page with no camera of that name counts as stopped too, except right after a restart (below).
    service.report(PAGE_LIVE, { inputId: one.id, state: 'missing' });
    service.report(PAGE_OUTPUT, { inputId: one.id, state: 'playing' });
    expect(service.status().stopped).not.toBeNull();
    // Back by itself: every screen plays it again.
    service.report(PAGE_LIVE, { inputId: one.id, state: 'playing' });
    expect(service.status().stopped).toBeNull();
    expect(statuses.at(-1)).toEqual({ stopped: null, access: 'granted' });
    // A screen that closed says nothing more.
    service.report(PAGE_OUTPUT, { inputId: one.id, state: 'stopped' });
    service.pageGone(PAGE_OUTPUT);
    expect(service.status().stopped).toBeNull();
    // Told only of changes.
    const told = statuses.length;
    service.report(PAGE_LIVE, { inputId: one.id, state: 'playing' });
    expect(statuses).toHaveLength(told);
  });

  it('hears only of the input up now: another, nonsense, or after it was cleared, is not said', () => {
    const { service, up, setBackground } = setup();
    const one = added(service.add(fields), 'Placeholder input');
    const two = added(service.add({ ...fields, name: 'Placeholder mixer' }), 'Placeholder mixer');
    service.report(PAGE_LIVE, { inputId: one.id, state: 'stopped' });
    expect(service.status().stopped).toBeNull();
    up(one);
    service.report(PAGE_LIVE, { inputId: two.id, state: 'stopped' });
    for (const nonsense of [null, 'stopped', { inputId: one.id, state: 'gone' }, { state: 'stopped' }])
      service.report(PAGE_LIVE, nonsense);
    expect(service.status().stopped).toBeNull();
    service.report(PAGE_LIVE, { inputId: one.id, state: 'stopped' });
    expect(service.status().stopped).toEqual({ inputId: one.id, name: one.name });
    // Another input up: what the pages said of the last one is forgotten.
    up(two, 6000);
    expect(service.status().stopped).toBeNull();
    service.report(PAGE_LIVE, { inputId: two.id, state: 'stopped' });
    expect(service.status().stopped?.name).toBe('Placeholder mixer');
    // Cleared (Clear all, F3, Clear the input): nothing stopped is up.
    setBackground(null);
    expect(service.status().stopped).toBeNull();
    // Put back as it was: the pages say again how it stands.
    up(two, 6000);
    expect(service.status().stopped).toBeNull();
  });

  it('says whether Drashti may use the cameras, and how it stands after the Mac asked', async () => {
    const { service, statuses, setAccess } = setup({ access: 'not-determined' });
    expect(service.access()).toBe('not-determined');
    expect(await service.askAccess()).toBe('granted');
    expect(statuses.at(-1)).toEqual({ stopped: null, access: 'granted' });
    setAccess('denied');
    expect(service.status().access).toBe('denied');
  });
});

describe('after a restart (restart recovery put the input back)', () => {
  it('a screen with no camera of that name: taken off, and the recovery notice names it', async () => {
    const { service, up, cleared, waits } = setup();
    const one = added(service.add(fields), 'Placeholder input');
    up(one);
    service.restored();
    let answer: string | null | undefined;
    void service.settled().then((gone) => {
      answer = gone;
    });
    await Promise.resolve();
    expect(answer).toBeUndefined();
    expect(waits.map((w) => w.ms)).toEqual([RESTORE_WAIT_MS]);
    service.report(PAGE_OUTPUT, { inputId: one.id, state: 'missing' });
    expect(await service.settled()).toBe('Placeholder input');
    expect(answer).toBe('Placeholder input');
    expect(cleared()).toBe(1);
    expect(waits[0]?.cancelled).toBe(true);
    // Nothing up any more: nothing is said to have stopped.
    expect(service.status().stopped).toBeNull();
  });

  it('there (playing, or stopped by another app): it stays, and the notice says it was put back', async () => {
    for (const state of ['playing', 'stopped'] as const) {
      const { service, up, cleared } = setup();
      const one = added(service.add(fields), 'Placeholder input');
      up(one);
      service.restored();
      service.report(PAGE_LIVE, { inputId: one.id, state });
      // A later page with no such camera is a stopped input now, never taken off.
      service.report(PAGE_OUTPUT, { inputId: one.id, state: 'missing' });
      expect(await service.settled()).toBeNull();
      expect(cleared()).toBe(0);
      expect(service.status().stopped).toEqual({ inputId: one.id, name: one.name });
    }
  });

  it('no screen says (none draws it), or the operator put something else up first: it stays as the operator has it', async () => {
    const waited = setup();
    const one = added(waited.service.add(fields), 'Placeholder input');
    waited.up(one);
    waited.service.restored();
    waited.waits[0]?.run();
    expect(await waited.service.settled()).toBeNull();
    waited.service.report(PAGE_LIVE, { inputId: one.id, state: 'missing' });
    expect(waited.cleared()).toBe(0);

    const replaced = setup();
    const two = added(replaced.service.add(fields), 'Placeholder input');
    replaced.up(two);
    replaced.service.restored();
    replaced.setBackground({ kind: 'color', color: '#000000' });
    expect(await replaced.service.settled()).toBeNull();
    expect(replaced.cleared()).toBe(0);
    // Nothing put back: nothing to wait for.
    const none = setup();
    none.service.restored();
    expect(await none.service.settled()).toBeNull();
    expect(none.waits).toEqual([]);
  });
});

describe('after a restart, a video input put back in the picture-in-picture box (Session 51)', () => {
  it('a screen with no camera of that name: the box comes off, and the recovery notice names it', async () => {
    const { service, setBox, takenOff, cleared, waits } = setup();
    const one = added(service.add(fields), 'Placeholder input');
    setBox(one);
    service.restored();
    let answer: string | null | undefined;
    void service.boxSettled().then((gone) => {
      answer = gone;
    });
    await Promise.resolve();
    expect(answer).toBeUndefined();
    expect(waits.map((w) => w.ms)).toEqual([RESTORE_WAIT_MS]);
    // What a page says of the background's picture is not the box's.
    service.report(PAGE_OUTPUT, { inputId: one.id, state: 'missing' });
    expect(takenOff()).toBe(0);
    service.report(PAGE_OUTPUT, { inputId: one.id, state: 'missing', box: true });
    expect(await service.boxSettled()).toBe('Placeholder input');
    expect(answer).toBe('Placeholder input');
    expect(takenOff()).toBe(1);
    expect(waits[0]?.cancelled).toBe(true);
    // The background was not the input: nothing of it comes off, and its own answer names nothing.
    expect(cleared()).toBe(0);
    expect(await service.settled()).toBeNull();
    // The box says nothing of its own to the operator's stopped notice (that is the background's).
    expect(service.status().stopped).toBeNull();
  });

  it('there (playing, or stopped by another app): it stays, and a later page with no such camera never takes it off', async () => {
    for (const state of ['playing', 'stopped'] as const) {
      const { service, setBox, takenOff } = setup();
      const one = added(service.add(fields), 'Placeholder input');
      setBox(one);
      service.restored();
      service.report(PAGE_LIVE, { inputId: one.id, state, box: true });
      service.report(PAGE_OUTPUT, { inputId: one.id, state: 'missing', box: true });
      expect(await service.boxSettled()).toBeNull();
      expect(takenOff()).toBe(0);
      expect(service.status().stopped).toBeNull();
    }
  });

  it('no screen says, another input is said, or the operator changed the box first: it stays as the operator has it', async () => {
    const waited = setup();
    const one = added(waited.service.add(fields), 'Placeholder input');
    const two = added(waited.service.add({ ...fields, name: 'Placeholder mixer' }), 'Placeholder mixer');
    waited.setBox(one);
    waited.service.restored();
    // Another input than the box's: not its word.
    waited.service.report(PAGE_LIVE, { inputId: two.id, state: 'missing', box: true });
    expect(waited.takenOff()).toBe(0);
    waited.waits[0]?.run();
    expect(await waited.service.boxSettled()).toBeNull();
    waited.service.report(PAGE_LIVE, { inputId: one.id, state: 'missing', box: true });
    expect(waited.takenOff()).toBe(0);

    // Taken off, another input in the box, the slides in it, or the same input up again (another showing).
    const changes: ((s: ReturnType<typeof setup>, input: VideoInput) => void)[] = [
      (s) => {
        s.setBox(null);
      },
      (s, input) => {
        s.setBox({ ...input, id: 'another-input' });
      },
      (s) => {
        s.setBoxSlides();
      },
      (s, input) => {
        s.setBox(input, 9000);
      },
    ];
    for (const change of changes) {
      const changed = setup();
      const three = added(changed.service.add(fields), 'Placeholder input');
      changed.setBox(three);
      changed.service.restored();
      change(changed, three);
      expect(await changed.service.boxSettled()).toBeNull();
      changed.service.report(PAGE_LIVE, { inputId: three.id, state: 'missing', box: true });
      expect(changed.takenOff()).toBe(0);
    }

    // Nothing in the box: nothing to wait for.
    const none = setup();
    none.setBoxSlides();
    none.service.restored();
    expect(await none.service.boxSettled()).toBeNull();
    expect(none.waits).toEqual([]);
  });

  it('the background’s and the box’s are each checked on their own, the same input or two', async () => {
    // Two inputs: the box's is not there, the background's is.
    const two = setup();
    const one = added(two.service.add(fields), 'Placeholder input');
    const mixer = added(
      two.service.add({ name: 'Placeholder mixer', device: 'Placeholder capture', fit: 'fill' }),
      'Placeholder mixer',
    );
    two.up(one);
    two.setBox(mixer);
    two.service.restored();
    expect(two.waits.map((w) => w.ms)).toEqual([RESTORE_WAIT_MS, RESTORE_WAIT_MS]);
    two.service.report(PAGE_LIVE, { inputId: one.id, state: 'playing' });
    two.service.report(PAGE_LIVE, { inputId: mixer.id, state: 'missing', box: true });
    expect(await two.service.settled()).toBeNull();
    expect(await two.service.boxSettled()).toBe('Placeholder mixer');
    expect(two.cleared()).toBe(0);
    expect(two.takenOff()).toBe(1);

    // One input both full and in the box, not there: each place hears its own pictures, and both come off.
    const same = setup();
    const input = added(same.service.add(fields), 'Placeholder input');
    same.up(input);
    same.setBox(input);
    same.service.restored();
    same.service.report(PAGE_OUTPUT, { inputId: input.id, state: 'missing' });
    expect(await same.service.settled()).toBe('Placeholder input');
    expect(same.takenOff()).toBe(0);
    same.service.report(PAGE_OUTPUT, { inputId: input.id, state: 'missing', box: true });
    expect(await same.service.boxSettled()).toBe('Placeholder input');
    expect(same.cleared()).toBe(1);
    expect(same.takenOff()).toBe(1);
  });

  it('quitting ends the wait: nothing is taken off', async () => {
    const { service, setBox, takenOff } = setup();
    const one = added(service.add(fields), 'Placeholder input');
    setBox(one);
    service.restored();
    service.close();
    expect(await service.boxSettled()).toBeNull();
    service.report(PAGE_LIVE, { inputId: one.id, state: 'missing', box: true });
    expect(takenOff()).toBe(0);
  });
});
