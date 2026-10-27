import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteScreens } from '../../../../shared/network-desktop';
import { answerKeep, answerOff, changeScreens, loadScreens, turnSwitch, useDesktop } from './desktop-store';

/*
 * A phone setting up the Drashti computer's screens (Session 54, the phone as a full Drashti): a change of its own
 * that waits for Keep these screens? stays its to answer until it goes, the window's question before a switch goes
 * off is asked here when Drashti says so and sent with its answer, and what Drashti refused is said in its words.
 * A stand-in for Drashti's answers; made-up ids.
 */

const drashti = vi.hoisted(() => ({
  asked: [] as { path: string; body: unknown }[],
  answers: new Map<string, unknown>(),
}));

vi.mock('../device', () => ({
  api: (path: string, init: { body?: unknown } = {}) => {
    drashti.asked.push({ path, body: init.body });
    return Promise.resolve(drashti.answers.get(path) ?? { ok: true });
  },
}));

const screens = (pending: RemoteScreens['pending'], asked: RemoteScreens['asked'] = null): RemoteScreens => ({
  displays: [],
  controlsDisplayId: null,
  groups: [],
  status: [],
  nodes: [],
  switches: { audience: true, stage: true },
  asksFirst: { audience: true, stage: false },
  pending,
  asked,
});

const WAITING = { deadline: 1_015_000, coversControls: false };

beforeEach(() => {
  drashti.asked = [];
  drashti.answers = new Map();
  useDesktop.setState({
    sheet: null,
    screens: null,
    busy: false,
    problem: null,
    mine: false,
    askingOff: null,
  });
});

describe('a phone setting up the computer’s screens (Session 54)', () => {
  it('keeps Keep these screens? its own to answer once its change waits, until the change no longer waits', async () => {
    drashti.answers.set('/api/v1/screen-groups/g-1/display', { ok: true, screens: screens(WAITING) });
    expect(await changeScreens('/api/v1/screen-groups/g-1/display', { displayId: 2 })).toBe(true);
    expect(useDesktop.getState()).toMatchObject({ mine: true, screens: { pending: WAITING } });
    // Still waiting as read again: still this phone's.
    drashti.answers.set('/api/v1/screens', { ok: true, screens: screens(WAITING) });
    await loadScreens();
    expect(useDesktop.getState().mine).toBe(true);
    // Answered elsewhere (the computer, or by itself): no longer.
    drashti.answers.set('/api/v1/screens', { ok: true, screens: screens(null) });
    await loadScreens();
    expect(useDesktop.getState().mine).toBe(false);
  });

  it('never takes another’s waiting change as its own, and answers its own with Keep or Go back', async () => {
    drashti.answers.set('/api/v1/screens', { ok: true, screens: screens(WAITING) });
    await loadScreens();
    expect(useDesktop.getState().mine).toBe(false);
    useDesktop.setState({ mine: true });
    await answerKeep(false);
    expect(drashti.asked.at(-1)).toEqual({ path: '/api/v1/screens/go-back', body: undefined });
    expect(useDesktop.getState().mine).toBe(false);
    await answerKeep(true);
    expect(drashti.asked.at(-1)).toEqual({ path: '/api/v1/screens/keep', body: undefined });
  });

  it('takes a change the computer agreed to for it as its own to answer, once it waits', async () => {
    // Asked on the computer: nothing waits yet.
    drashti.answers.set('/api/v1/screen-groups/g-1/display', {
      ok: true,
      asked: true,
      screens: screens(null, { state: 'waiting', message: 'Waiting for the Drashti computer to agree…' }),
    });
    await changeScreens('/api/v1/screen-groups/g-1/display', { displayId: 1 });
    expect(useDesktop.getState().mine).toBe(false);
    // The computer agreed, and the change waits for Keep these screens?: this phone's to answer.
    drashti.answers.set('/api/v1/screens', {
      ok: true,
      screens: screens(WAITING, { state: 'agreed', message: 'The Drashti computer agreed.' }),
    });
    await loadScreens();
    expect(useDesktop.getState().mine).toBe(true);
  });

  it('says what Drashti refused, in its words, and changes nothing', async () => {
    drashti.answers.set('/api/v1/screen-groups', {
      ok: false,
      status: 403,
      message: 'Simple Mode is on, so this cannot be changed.',
    });
    expect(await changeScreens('/api/v1/screen-groups', { name: 'Placeholder Hall' })).toBe(false);
    expect(useDesktop.getState()).toMatchObject({
      problem: 'Simple Mode is on, so this cannot be changed.',
      screens: null,
    });
  });

  it('asks the window’s question here before a switch goes off, when Drashti says to, and sends it with its answer', async () => {
    drashti.answers.set('/api/v1/switches/audience', {
      ok: false,
      status: 409,
      confirm: 'switch-off',
      message: 'Turning this off asks first: answer the question on the phone.',
    });
    await turnSwitch('audience', false);
    expect(useDesktop.getState()).toMatchObject({ askingOff: 'audience', problem: null });
    // Cancel: nothing more is sent.
    await answerOff(false);
    expect(drashti.asked).toEqual([{ path: '/api/v1/switches/audience', body: { on: false } }]);
    // Turn off: sent as answered.
    await turnSwitch('audience', false);
    drashti.answers.set('/api/v1/switches/audience', { ok: true });
    await answerOff(true);
    expect(drashti.asked.at(-1)).toEqual({
      path: '/api/v1/switches/audience',
      body: { on: false, confirmed: true },
    });
    expect(useDesktop.getState().askingOff).toBeNull();
    // On is never asked.
    await turnSwitch('stage', true);
    expect(drashti.asked.at(-1)).toEqual({ path: '/api/v1/switches/stage', body: { on: true } });
  });
});
