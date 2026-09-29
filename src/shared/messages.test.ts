import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from './messages';
import { fillMessage, templateFields } from './messages';

const car: MessageTemplate = { id: 'car', name: 'Car', template: 'Car {plate} please move', fields: {} };

describe('message templates', () => {
  it('find their fields, each once', () => {
    expect(templateFields('Car {plate} please move')).toEqual(['plate']);
    expect(templateFields('{a} and {b} and {a}, not {} or {x.y}')).toEqual(['a', 'b']);
    expect(templateFields('નમૂના {નામ}')).toEqual(['નામ']);
  });

  it('fill typed fields, and ask for any left empty', () => {
    expect(fillMessage(car, { plate: '  PLACEHOLDER-1 ' }, () => '')).toEqual({
      message: {
        id: 'message:car',
        text: 'Car PLACEHOLDER-1 please move',
        parts: [
          { kind: 'text', text: 'Car ' },
          { kind: 'text', text: 'PLACEHOLDER-1' },
          { kind: 'text', text: ' please move' },
        ],
      },
      missing: [],
    });
    expect(fillMessage(car, {}, () => '')).toEqual({ message: null, missing: ['plate'] });
  });

  it('show a timer field live', () => {
    const start: MessageTemplate = {
      id: 'start',
      name: 'Start',
      template: 'Sabha starts in {time}',
      fields: { time: { kind: 'timer', timerId: 't1' } },
    };
    const filled = fillMessage(start, {}, () => 'Countdown');
    expect(filled.message?.parts).toEqual([
      { kind: 'text', text: 'Sabha starts in ' },
      { kind: 'timer', timerId: 't1' },
    ]);
    expect(filled.message?.text).toBe('Sabha starts in [Countdown]');
  });
});
