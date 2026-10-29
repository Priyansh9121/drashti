import { describe, expect, it } from 'vitest';
import { parseEngineCommand } from './commands';

describe('parseEngineCommand', () => {
  it('accepts every command type', () => {
    const valid: unknown[] = [
      { type: 'goLive', presentationId: 'p1', slideIndex: 0 },
      { type: 'next' },
      { type: 'previous' },
      { type: 'clearLayer', layer: 'ticker' },
      { type: 'clearAll' },
      { type: 'setBlackout', on: true },
      { type: 'toggleBlackout' },
      { type: 'setBackground', background: { kind: 'color', color: '#0a0B0c' } },
      { type: 'playAudio', audio: { id: 'a', title: 'Dhun', mediaId: null, volume: 1, loop: false } },
      { type: 'showMessage', message: { id: 'm', text: 'Car 123 please move' } },
      { type: 'hideMessage', messageId: 'm' },
      // The Wallpaper (Session 55, in the logo's place; props and masks went).
      { type: 'setWallpaper', on: true },
      { type: 'toggleWallpaper' },
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
      {
        type: 'setMask',
        mask: {
          id: 'k',
          name: 'Mask',
          width: 1920,
          height: 1080,
          mode: 'hide',
          shapes: [{ id: 's', kind: 'ellipse', frame: { x: 0, y: 0, width: -1, height: 5 } }],
        },
      },
      {
        type: 'setMask',
        mask: {
          id: 'k',
          name: 'Mask',
          width: 1920,
          height: 1080,
          mode: 'hide',
          shapes: [{ id: 's', kind: 'ellipse', frame: { x: Number.NaN, y: 0, width: 1, height: 5 } }],
        },
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
