import { describe, expect, it } from 'vitest';
import { MIDI_ACTION_NAMES, MIDI_LEARNABLE, midiSettingsNow, NO_MIDI } from './midi';

/*
 * The MIDI controller's settings (Session 11). The Wallpaper took the Logo's place (Session 55, Part 13): a pad can
 * learn it, and a pad mapped to the Logo before then works it; a pad mapped to a macro before Session 44 is kept and
 * does nothing.
 */

const pad = (number: number) => ({ type: 'note' as const, channel: 0, number });

describe('MIDI settings', () => {
  it('lets a pad learn the Wallpaper, by its name', () => {
    expect(MIDI_LEARNABLE).toContain('wallpaper');
    expect(MIDI_ACTION_NAMES.wallpaper).toBe('Wallpaper');
  });

  it('reads a pad mapped to the Logo before Session 55 as the Wallpaper, and keeps the rest as they were', () => {
    const macroId = '00000000-0000-4000-8000-0000000000aa';
    expect(
      midiSettingsNow({
        deviceName: 'Placeholder pad',
        mappings: [
          { input: pad(40), action: { kind: 'macro', macroId } },
          { input: pad(41), action: { kind: 'logo' } },
          { input: pad(42), action: { kind: 'wallpaper' } },
          { input: pad(36), action: { kind: 'next' } },
        ],
      }),
    ).toEqual({
      deviceName: 'Placeholder pad',
      mappings: [
        { input: pad(40), action: { kind: 'macro', macroId } },
        { input: pad(41), action: { kind: 'wallpaper' } },
        { input: pad(42), action: { kind: 'wallpaper' } },
        { input: pad(36), action: { kind: 'next' } },
      ],
    });
  });

  it('reads nothing it cannot read as no settings', () => {
    expect(midiSettingsNow(undefined)).toEqual(NO_MIDI);
    expect(midiSettingsNow({ deviceName: 5, mappings: [] })).toEqual(NO_MIDI);
    expect(
      midiSettingsNow({ deviceName: null, mappings: [{ input: pad(1), action: { kind: 'props' } }] }),
    ).toEqual(NO_MIDI);
  });
});
