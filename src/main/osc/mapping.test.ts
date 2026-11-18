import { describe, expect, it } from 'vitest';
import { LAYER_NAMES } from '../../shared/engine/state';
import { mapOsc } from './mapping';
import type { OscArgument } from './reader';

const s = (value: string): OscArgument => ({ type: 's', value });
const i = (value: number): OscArgument => ({ type: 'i', value });
const map = (address: string, ...args: OscArgument[]) =>
  mapOsc({ address: '/drashti/' + address, arguments: args, timetag: 1n });
const command = (args: unknown) => ({ op: 'command', args });

describe('OSC maps to the existing show actions', () => {
  it.each([
    ['next', 'next'],
    ['back', 'back'],
    ['previous', 'previous'],
    ['next-item', 'nextItem'],
    ['previous-item', 'previousItem'],
    ['clear/all', 'clearAll'],
    ['put-back', 'putBack'],
    ['timers/hide', 'hideAudienceTimer'],
    ['stage-message/clear', 'clearStageMessage'],
  ])('%s is the existing %s command', (address, type) => {
    expect(map(address)).toEqual(command({ type }));
    expect(map(address, i(1))).toBeNull();
  });

  it('clears every current layer and refuses nonexistent layers', () => {
    for (const layer of LAYER_NAMES)
      expect(map('clear/' + layer)).toEqual(command({ type: 'clearLayer', layer }));
    expect(map('clear/props')).toBeNull();
    expect(map('clear/masks')).toBeNull();
  });

  it('chooses a slide by presentation and playing-order index, optionally in an arrangement', () => {
    expect(map('slide', s('placeholder-presentation'), i(2))).toEqual(
      command({ type: 'goLive', presentationId: 'placeholder-presentation', slideIndex: 2 }),
    );
    expect(map('slide', s('placeholder-presentation'), i(0), s('placeholder-order'))).toEqual(
      command({
        type: 'goLive',
        presentationId: 'placeholder-presentation',
        slideIndex: 0,
        arrangementId: 'placeholder-order',
      }),
    );
    expect(map('item', s('placeholder-list'), s('placeholder-item'))).toEqual(
      command({ type: 'playItem', playlistId: 'placeholder-list', itemId: 'placeholder-item' }),
    );
  });

  it.each(['blackout', 'wallpaper'])(
    '%s accepts a toggle, explicit OSC booleans, and numeric 0/1',
    (address) => {
      const suffix = address === 'blackout' ? 'Blackout' : 'Wallpaper';
      expect(map(address)).toEqual(command({ type: 'toggle' + suffix }));
      for (const arg of [i(1), { type: 'f', value: 1 }, { type: 'T', value: true }])
        expect(map(address, arg)).toEqual(command({ type: 'set' + suffix, on: true }));
      for (const arg of [i(0), { type: 'f', value: 0 }, { type: 'F', value: false }])
        expect(map(address, arg)).toEqual(command({ type: 'set' + suffix, on: false }));
      expect(map(address, i(2))).toBeNull();
      expect(map(address, s('on'))).toBeNull();
    },
  );

  it.each([
    ['start', 'startTimer'],
    ['pause', 'pauseTimer'],
    ['reset', 'resetTimer'],
    ['show', 'showAudienceTimer'],
  ])('timers/%s is %s', (action, type) => {
    expect(map('timers/' + action, s('placeholder-timer'))).toEqual(
      command({ type, timerId: 'placeholder-timer' }),
    );
    expect(map('timers/' + action)).toBeNull();
  });

  it('fills message fields through the API template operation and hides by the same template id', () => {
    expect(map('messages/show', s('placeholder-message'))).toEqual({
      op: 'message.show',
      args: { templateId: 'placeholder-message', values: {} },
    });
    expect(map('messages/show', s('placeholder-message'), s('plate'), s('Placeholder'))).toEqual({
      op: 'message.show',
      args: { templateId: 'placeholder-message', values: { plate: 'Placeholder' } },
    });
    expect(map('messages/hide', s('placeholder-message'))).toEqual({
      op: 'message.hide',
      args: { templateId: 'placeholder-message' },
    });
    expect(map('messages/show', s('id'), s('missing-value'))).toBeNull();
    expect(map('messages/show', s('id'), s('field'), s('one'), s('field'), s('two'))).toBeNull();
    expect(map('messages/show', s('id'), s('__proto__'), s('unsafe'))).toBeNull();
    expect(map('messages/show', s('id'), s('field'), s('x'.repeat(201)))).toBeNull();
  });

  it('shows a stage message with the same optional size and flash as the API', () => {
    expect(map('stage-message', s('Placeholder stage call'))).toEqual(
      command({ type: 'setStageMessage', text: 'Placeholder stage call' }),
    );
    expect(map('stage-message', s('Placeholder'), s('huge'), i(1))).toEqual(
      command({ type: 'setStageMessage', text: 'Placeholder', size: 'huge', flash: true }),
    );
    expect(map('stage-message', s('Placeholder'), s('invalid'))).toBeNull();
    expect(map('stage-message', s('x'.repeat(301)))).toBeNull();
  });

  it.each([
    ['slide', [s('id'), i(-1)]],
    ['slide', [s('id'), i(100001)]],
    ['slide', [s(''), i(0)]],
    ['slide', [s('id'), { type: 'f', value: 1 }]],
    ['item', [s('id')]],
    ['macros/run', [s('retired')]],
    ['command', [s('setBackground')]],
    ['next/*', []],
    ['Next', []],
    ['stream/start', []],
    ['settings', []],
    ['stage-message', [s('   ')]],
  ] as [string, OscArgument[]][])('refuses unknown actions or bad argument shapes: %s', (address, args) => {
    expect(map(address, ...args)).toBeNull();
  });
});
