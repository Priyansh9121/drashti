import { describe, expect, it } from 'vitest';
import { READY_CANNOT_CHECK, type ReadyFacts, type ReadyLine, readyLines } from './ready';

/** Everything as it should be before a sabha: every line green. */
const good: ReadyFacts = {
  platform: 'darwin',
  screens: {
    others: 1,
    mirrored: false,
    switches: { audience: true, stage: true },
    outputs: [{ name: 'Main Hall', role: 'audience', state: 'showing', node: false }],
  },
  sound: { state: 'chosen', checked: true, chosen: 'Placeholder mixer', playerRunning: true },
  videoInput: { chosen: null, access: 'granted', seen: null },
  access: { phase: 'in', stopsInMs: null, endsInMs: null },
  playlist: { name: 'Placeholder sabha', problems: [] },
  power: { onBattery: false, keptAwake: true },
  focus: { quiet: true },
};

const line = (facts: ReadyFacts, id: ReadyLine['id']): ReadyLine => {
  const found = readyLines(facts).find((l) => l.id === id);
  if (!found) throw new Error(`no ${id} line`);
  return found;
};

describe('Ready? (Session 55, Part 8, H): each line green or amber, with what to do', () => {
  it('has the eight lines, in order, all green when all is well, none saying what to do', () => {
    const lines = readyLines(good);
    expect(lines.map((l) => l.id)).toEqual([
      'screens',
      'sound',
      'video-input',
      'access',
      'files',
      'charger',
      'sleep',
      'notifications',
    ]);
    expect(lines.filter((l) => !l.ok)).toEqual([]);
    for (const l of lines) {
      expect(l.todo).toBeNull();
      expect(l.said.length).toBeGreaterThan(0);
    }
  });

  it('every amber line says what to do', () => {
    const bad: ReadyFacts = {
      platform: 'win32',
      screens: { others: 0, mirrored: true, switches: { audience: false, stage: false }, outputs: [] },
      sound: { state: 'missing', checked: true, chosen: 'Placeholder mixer', playerRunning: true },
      videoInput: { chosen: { name: 'Input 1', device: 'Placeholder camera' }, access: 'granted', seen: [] },
      access: { phase: 'warning', stopsInMs: 3 * 24 * 3600_000, endsInMs: null },
      playlist: null,
      power: { onBattery: true, keptAwake: false },
      focus: { quiet: false },
    };
    const lines = readyLines(bad);
    expect(lines.filter((l) => l.ok).map((l) => l.id)).toEqual([]);
    for (const l of lines) expect(l.todo, l.id).toMatch(/\S/u);
  });

  it('screens: no screen besides the controls asks for the projector, extended', () => {
    const l = line({ ...good, screens: { ...good.screens, others: 0, outputs: [] } }, 'screens');
    expect(l.ok).toBe(false);
    expect(l.todo).toMatch(/projector/u);
    expect(l.todo).toMatch(/extend/iu);
  });

  it('screens: a hall screen whose display is gone, Audience off, Stage off, mirroring and a stopped one each say so', () => {
    const missing = line(
      {
        ...good,
        screens: {
          ...good.screens,
          outputs: [{ name: 'Main Hall', role: 'audience', state: 'missing-display', node: false }],
        },
      },
      'screens',
    );
    expect(missing.ok).toBe(false);
    expect(missing.said).toMatch(/Main Hall/u);
    expect(missing.todo).toMatch(/cable/u);
    const off = line(
      { ...good, screens: { ...good.screens, switches: { audience: false, stage: true } } },
      'screens',
    );
    expect(off.ok).toBe(false);
    expect(off.todo).toMatch(/⌘1/u);
    const offWin = line(
      {
        ...good,
        platform: 'win32',
        screens: { ...good.screens, switches: { audience: false, stage: true } },
      },
      'screens',
    );
    expect(offWin.todo).toMatch(/Ctrl\+1/u);
    const stage = line(
      {
        ...good,
        screens: {
          ...good.screens,
          switches: { audience: true, stage: false },
          outputs: [...good.screens.outputs, { name: 'Stage', role: 'stage', state: 'showing', node: false }],
        },
      },
      'screens',
    );
    expect(stage.ok).toBe(false);
    expect(stage.todo).toMatch(/⌘2/u);
    const mirrored = line({ ...good, screens: { ...good.screens, mirrored: true } }, 'screens');
    expect(mirrored.ok).toBe(false);
    expect(mirrored.todo).toMatch(/extend/iu);
    const stopped = line(
      {
        ...good,
        screens: {
          ...good.screens,
          outputs: [{ name: 'Main Hall', role: 'audience', state: 'stopped', node: false }],
        },
      },
      'screens',
    );
    expect(stopped.ok).toBe(false);
    expect(stopped.todo).toMatch(/Try again/u);
    const quiet = line(
      {
        ...good,
        screens: {
          ...good.screens,
          outputs: [{ name: 'Main Hall', role: 'audience', state: 'not-drawing', node: false }],
        },
      },
      'screens',
    );
    expect(quiet.ok).toBe(false);
  });

  it('screens: a screen set aside on purpose (not used, turned off) is no problem, and a green line names what shows', () => {
    const l = line(
      {
        ...good,
        screens: {
          ...good.screens,
          outputs: [
            ...good.screens.outputs,
            { name: 'Lobby', role: 'audience', state: 'disabled', node: false },
            { name: 'Spare', role: 'audience', state: 'unassigned', node: false },
          ],
        },
      },
      'screens',
    );
    expect(l.ok).toBe(true);
    expect(l.said).toMatch(/Main Hall/u);
  });

  it('sound: the chosen output unplugged, never looked at, or no sound player is amber; the computer’s own output is green', () => {
    expect(line({ ...good, sound: { ...good.sound, state: 'missing' } }, 'sound')).toMatchObject({
      ok: false,
    });
    expect(line({ ...good, sound: { ...good.sound, state: 'missing' } }, 'sound').said).toMatch(
      /Placeholder mixer/u,
    );
    expect(line({ ...good, sound: { ...good.sound, checked: false } }, 'sound')).toMatchObject({ ok: false });
    expect(line({ ...good, sound: { ...good.sound, playerRunning: false } }, 'sound')).toMatchObject({
      ok: false,
    });
    expect(line({ ...good, sound: { ...good.sound, state: 'default', chosen: null } }, 'sound').ok).toBe(
      true,
    );
    expect(line(good, 'sound').said).toMatch(/Placeholder mixer/u);
  });

  it('video input: none chosen is green; chosen and seen is green; unplugged, not allowed or not yet seen is amber', () => {
    expect(line(good, 'video-input').ok).toBe(true);
    const chosen = { name: 'Input 1', device: 'Placeholder camera' };
    expect(
      line(
        { ...good, videoInput: { chosen, access: 'granted', seen: ['Placeholder camera'] } },
        'video-input',
      ).ok,
    ).toBe(true);
    const gone = line(
      { ...good, videoInput: { chosen, access: 'granted', seen: ['Another camera'] } },
      'video-input',
    );
    expect(gone.ok).toBe(false);
    expect(gone.said).toMatch(/Input 1/u);
    const denied = line({ ...good, videoInput: { chosen, access: 'denied', seen: null } }, 'video-input');
    expect(denied.ok).toBe(false);
    expect(denied.todo).toMatch(/Camera/u);
    const unknown = line({ ...good, videoInput: { chosen, access: 'granted', seen: null } }, 'video-input');
    expect(unknown).toMatchObject({ ok: false, unknown: true });
  });

  it('access: let in is green; the offline countdown, an end within 7 days and still checking are amber', () => {
    expect(line(good, 'access').ok).toBe(true);
    const offline = line(
      { ...good, access: { phase: 'warning', stopsInMs: 2 * 24 * 3600_000, endsInMs: null } },
      'access',
    );
    expect(offline.ok).toBe(false);
    expect(offline.said).toMatch(/2 days/u);
    expect(offline.todo).toMatch(/internet/u);
    const ends = line(
      { ...good, access: { phase: 'in', stopsInMs: null, endsInMs: 3 * 24 * 3600_000 } },
      'access',
    );
    expect(ends.ok).toBe(false);
    expect(ends.said).toMatch(/3 days/u);
    expect(
      line({ ...good, access: { phase: 'in', stopsInMs: null, endsInMs: 30 * 24 * 3600_000 } }, 'access').ok,
    ).toBe(true);
    expect(
      line({ ...good, access: { phase: 'checking', stopsInMs: null, endsInMs: null } }, 'access').ok,
    ).toBe(false);
  });

  it('files: no playlist open, or missing files in it, is amber, naming them (a few, then how many more)', () => {
    expect(line({ ...good, playlist: null }, 'files')).toMatchObject({ ok: false });
    const some = line(
      {
        ...good,
        playlist: { name: 'Placeholder sabha', problems: ['a.mp4', 'b.jpg', 'c.mp3', 'd.png', 'e.mov'] },
      },
      'files',
    );
    expect(some.ok).toBe(false);
    expect(some.said).toMatch(/5 files/u);
    expect(some.said).toMatch(/a\.mp4/u);
    expect(some.said).toMatch(/2 more/u);
    expect(some.said).not.toMatch(/e\.mov/u);
    const one = line({ ...good, playlist: { name: 'Placeholder sabha', problems: ['a.mp4'] } }, 'files');
    expect(one.said).toMatch(/1 file /u);
    expect(line(good, 'files').said).toMatch(/Placeholder sabha/u);
  });

  it('the charger, sleep and notifications', () => {
    expect(line({ ...good, power: { onBattery: true, keptAwake: true } }, 'charger')).toMatchObject({
      ok: false,
    });
    expect(line({ ...good, power: { onBattery: true, keptAwake: true } }, 'charger').todo).toMatch(
      /charger/u,
    );
    expect(line({ ...good, power: { onBattery: null, keptAwake: true } }, 'charger')).toMatchObject({
      ok: false,
      unknown: true,
    });
    expect(line({ ...good, power: { onBattery: false, keptAwake: false } }, 'sleep').ok).toBe(false);
    const noisy = line({ ...good, focus: { quiet: false } }, 'notifications');
    expect(noisy.ok).toBe(false);
    expect(noisy.todo).toMatch(/Do Not Disturb/u);
    const unknownMac = line({ ...good, focus: { quiet: null } }, 'notifications');
    expect(unknownMac).toMatchObject({ ok: false, unknown: true });
    expect(unknownMac.said).toMatch(/can’t/u);
    const windows = line({ ...good, platform: 'win32', focus: { quiet: false } }, 'notifications');
    expect(windows.todo).toMatch(/Focus assist|Do not disturb/u);
  });

  it('says what it cannot check', () => {
    expect(READY_CANNOT_CHECK.length).toBeGreaterThanOrEqual(3);
    expect(READY_CANNOT_CHECK.join(' ')).toMatch(/projector/u);
  });
});
