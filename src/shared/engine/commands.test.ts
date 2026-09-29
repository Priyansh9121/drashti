import { describe, expect, it } from 'vitest';
import { parseEngineCommand } from './commands';

describe('parseEngineCommand', () => {
  it('accepts every command type', () => {
    const valid: unknown[] = [
      { type: 'goLive', presentationId: 'p1', slideIndex: 0 },
      { type: 'next' },
      { type: 'previous' },
      { type: 'clearLayer', layer: 'masks' },
      { type: 'clearAll' },
      { type: 'setBlackout', on: true },
      { type: 'toggleBlackout' },
      { type: 'setBackground', background: { kind: 'color', color: '#0a0B0c' } },
      { type: 'playAudio', audio: { id: 'a', title: 'Dhun', mediaId: null, volume: 1, loop: false } },
      {
        type: 'showProp',
        prop: {
          id: 'logo',
          name: 'Logo',
          elements: [
            {
              id: 's',
              kind: 'shape',
              frame: { x: 0, y: 0, width: 10, height: 10 },
              fill: '#ffffff',
              cornerRadius: 0,
              opacity: 1,
            },
          ],
        },
      },
      { type: 'hideProp', propId: 'logo' },
      { type: 'showMessage', message: { id: 'm', text: 'Car 123 please move' } },
      { type: 'hideMessage', messageId: 'm' },
      { type: 'setMask', mask: { id: 'k', name: 'Mask', visible: { x: 0, y: 0, width: 5, height: 5 } } },
    ];
    for (const input of valid)
      expect(parseEngineCommand(input), JSON.stringify(input)).toMatchObject({ ok: true });
  });

  it('rejects malformed commands', () => {
    const invalid: unknown[] = [
      null,
      'next',
      { type: 'jump' },
      { type: 'goLive', presentationId: '', slideIndex: 0 },
      { type: 'goLive', presentationId: 'p', slideIndex: -1 },
      { type: 'goLive', presentationId: 'p', slideIndex: 1.5 },
      { type: 'clearLayer', layer: 'everything' },
      { type: 'setBackground', background: { kind: 'color', color: 'url(https://evil.example/x.png)' } },
      { type: 'setBackground', background: { kind: 'color', color: 'red' } },
      { type: 'showMessage', message: { id: 'm', text: '' } },
      { type: 'setMask', mask: { id: 'k', name: 'k', visible: { x: 0, y: 0, width: -1, height: 5 } } },
      {
        type: 'setMask',
        mask: { id: 'k', name: 'k', visible: { x: Number.NaN, y: 0, width: 1, height: 5 } },
      },
    ];
    for (const input of invalid)
      expect(parseEngineCommand(input), JSON.stringify(input)).toMatchObject({ ok: false });
  });

  it('drops unknown keys', () => {
    const r = parseEngineCommand({ type: 'next', __proto__: { polluted: true }, extra: 1 });
    expect(r).toEqual({ ok: true, command: { type: 'next' } });
  });

  it('explains what is wrong', () => {
    const r = parseEngineCommand({ type: 'goLive', presentationId: 'p', slideIndex: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/slideIndex/);
  });
});
