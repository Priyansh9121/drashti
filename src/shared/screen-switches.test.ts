import { describe, expect, it } from 'vitest';
import { initialEngineState, type EngineState } from './engine/state';
import type { ScreenConfig, ScreenGroupConfig, ScreenRole, ScreenState, ScreensSnapshot } from './screens';
import {
  ALL_ON,
  asksFirst,
  openUnder,
  pictureWhile,
  showsSomething,
  SWITCH_NAMES,
  SWITCH_OFF_WORDS,
  switchFor,
  SWITCHED_OFF_PICTURE,
  switchOffQuestion,
  TURN_OFF,
} from './screen-switches';

/*
 * Audience and Stage (Session 50): which screens each switch covers, and when turning one off asks first.
 * Placeholder screens and an engine state with nothing up, then one thing at a time.
 */

const screen = (id: string, groupId: string, nodeId: string | null = null): ScreenConfig => ({
  id,
  groupId,
  name: id,
  displayKey: null,
  canvasWidth: 1920,
  canvasHeight: 1080,
  scaling: 'fit',
  enabled: true,
  feed: null,
  nodeId,
});

const group = (id: string, role: ScreenRole, screens: ScreenConfig[]): ScreenGroupConfig => ({
  id,
  name: id,
  role,
  screens,
});

function snapshot(
  groups: ScreenGroupConfig[],
  states: Record<string, ScreenState>,
): Pick<ScreensSnapshot, 'groups' | 'status'> {
  return {
    groups,
    status: Object.entries(states).map(([screenId, state]) => ({ screenId, state, displayId: null })),
  };
}

const nothing = (): EngineState => initialEngineState();

describe('Audience and Stage (Session 50)', () => {
  it('Audience covers the audience picture, key and fill included; Stage the stage view; the stream neither', () => {
    expect(switchFor('audience')).toBe('audience');
    expect(switchFor('keyfill')).toBe('audience');
    // An older group of no named kind shows the audience picture too (output/main.tsx).
    expect(switchFor('other')).toBe('audience');
    expect(switchFor('stage')).toBe('stage');
    expect(switchFor('stream')).toBeNull();
    expect(SWITCH_NAMES).toEqual({ audience: 'Audience', stage: 'Stage' });
    // Both on at every start.
    expect(ALL_ON).toEqual({ audience: true, stage: true });
  });

  it('says, in the words asked for, what turning one off does', () => {
    expect(SWITCH_OFF_WORDS.audience).toBe('The hall’s screens will show this computer’s desktop.');
    expect(SWITCH_OFF_WORDS.stage).toBe('The stage screens will show this computer’s desktop.');
  });

  it('counts the open windows each covers: this computer’s, showing or stopped, never a node’s', () => {
    const shot = snapshot(
      [
        group('hall', 'audience', [screen('hall-1', 'hall'), screen('hall-2', 'hall')]),
        group('atem', 'keyfill', [screen('fill', 'atem'), screen('key', 'atem')]),
        group('stage', 'stage', [screen('stage-1', 'stage'), screen('node-stage', 'stage', 'node-1')]),
        group('lobby', 'audience', [screen('node-lobby', 'lobby', 'node-1')]),
        group('stream', 'stream', [screen('stream-1', 'stream')]),
      ],
      {
        'hall-1': 'showing',
        'hall-2': 'missing-display',
        fill: 'showing',
        key: 'stopped',
        'stage-1': 'showing',
        'node-stage': 'showing',
        'node-lobby': 'showing',
        'stream-1': 'showing',
      },
    );
    expect(openUnder(shot, 'audience')).toBe(3);
    expect(openUnder(shot, 'stage')).toBe(1);
    // Switched off, disabled or never given a display: nothing of theirs is open.
    const off = snapshot(
      [group('hall', 'audience', [screen('a', 'hall'), screen('b', 'hall'), screen('c', 'hall')])],
      { a: 'switched-off', b: 'disabled', c: 'unassigned' },
    );
    expect(openUnder(off, 'audience')).toBe(0);
  });

  it('knows when the audience screens show something: any layer with a picture, black-out, the logo', () => {
    expect(showsSomething(nothing())).toBe(false);
    // Sound has no picture on the screens.
    const audio = nothing();
    audio.layers.audio = {
      id: 'a',
      title: 'Placeholder',
      mediaId: 'm',
      volume: 1,
      loop: false,
      startedAt: 0,
    };
    expect(showsSomething(audio)).toBe(false);
    // A black-out is still something the hall sees.
    expect(showsSomething({ ...nothing(), blackout: true })).toBe(true);
    expect(
      showsSomething({ ...nothing(), logo: { id: 'logo', name: 'Placeholder logo', elements: [] } }),
    ).toBe(true);
    const background = nothing();
    background.layers.background = { kind: 'color', color: '#123456' };
    expect(showsSomething(background)).toBe(true);
    const message = nothing();
    message.layers.messages = [{ id: 'm1', text: 'Placeholder message' }];
    expect(showsSomething(message)).toBe(true);
    const ticker = nothing();
    ticker.layers.ticker = { items: [{ id: 't1', text: 'Placeholder' }], startedAt: 0 };
    expect(showsSomething(ticker)).toBe(true);
  });

  it('counts the idle rotation once it is started, or on a lobby group always, with something to show', () => {
    const idle = nothing();
    idle.idle = {
      startedAt: null,
      items: [{ kind: 'picture', mediaId: 'm1' }],
      secondsEach: 10,
      dissolveMs: 1500,
    };
    // Pictures chosen, never started, and no group shows it always: nothing up.
    expect(showsSomething(idle)).toBe(false);
    expect(showsSomething({ ...idle, idle: { ...idle.idle, startedAt: 5 } })).toBe(true);
    const lobby: EngineState = {
      ...idle,
      look: {
        id: 'look',
        name: 'Placeholder',
        groups: {
          lobby: {
            layers: [],
            languages: null,
            slides: 'designed',
            stageLayout: null,
            mask: null,
            idle: 'always',
            movement: 'calm',
          },
        },
      },
    };
    expect(showsSomething(lobby)).toBe(true);
    // No pictures and no quote: the rotation has nothing to show.
    expect(showsSomething({ ...lobby, idle: { ...lobby.idle, items: [], startedAt: 5 } })).toBe(false);
  });

  it('asks first only while its screens are open and show something; Stage whenever one is open', () => {
    const busy: EngineState = { ...nothing(), blackout: true };
    // Nothing of its kind open: nothing for the hall to see change.
    expect(asksFirst('audience', 0, busy)).toBe(false);
    expect(asksFirst('stage', 0, busy)).toBe(false);
    expect(asksFirst('audience', 2, nothing())).toBe(false);
    expect(asksFirst('audience', 2, busy)).toBe(true);
    // The stage screens always show the stage view (the clock at least).
    expect(asksFirst('stage', 1, nothing())).toBe(true);
    // The state not known yet: ask, the safe side.
    expect(asksFirst('audience', 1, null)).toBe(true);
  });

  it('asks in the first moments, before the window knows which screens are open (Session 51, S2-4)', () => {
    expect(asksFirst('audience', null, nothing())).toBe(true);
    expect(asksFirst('audience', null, null)).toBe(true);
    expect(asksFirst('stage', null, nothing())).toBe(true);
  });

  it('says the question and its button in the app’s case, wherever it is asked (Session 51, S2-7)', () => {
    expect(switchOffQuestion('audience')).toBe('Turn Audience off?');
    expect(switchOffQuestion('stage')).toBe('Turn Stage off?');
    expect(TURN_OFF).toBe('Turn off');
  });

  it('never shows a switched-off screen’s last picture on the dashboard (Session 51, S2-5)', () => {
    expect(pictureWhile('switched-off', 'data:image/jpeg;base64,placeholder')).toBeNull();
    expect(pictureWhile('showing', 'data:image/jpeg;base64,placeholder')).toBe(
      'data:image/jpeg;base64,placeholder',
    );
    expect(pictureWhile(null, null)).toBeNull();
    expect(SWITCHED_OFF_PICTURE).toBe('This computer’s desktop');
  });
});
