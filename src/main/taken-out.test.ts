import { describe, expect, it } from 'vitest';
import { parseEngineCommand } from '../shared/engine/commands';
import { ENGINE_STATE_VERSION, LAYER_NAMES, readsEngineVersion } from '../shared/engine/state';
import { EVENT_KINDS, EVENT_NAMES } from '../shared/events-out';
import { IPC } from '../shared/ipc';
import { actionFor, KEY_GROUPS, KEYMAP, SINGLE_KEYS, SINGLE_KEYS_TEXT } from '../shared/keymap';
import { MIDI_ACTION_NAMES, MIDI_LEARNABLE, midiSettingsSchema } from '../shared/midi';
import { DEVICE_OPS, REMOTE_COMMANDS } from '../shared/network-api';
import { PANEL_HELP } from '../shared/panel-help';

/*
 * Taken out (Session 55, Part 12): Props, Looks, the Idle rotation, Masks, Themes (the top bar's button and the
 * theme editor) and the Logo (its button, F12 and L, its setting, MIDI's Logo), from the keys, the engine's
 * commands, the phone's and the API's commands, MIDI, the window's requests and the help cards; the Wallpaper in
 * the Logo's place (Part 13). A library's data of theirs stays (old-library-selftest, taken-out.spec.ts).
 */

/**
 * The words of what was taken out, as a key's name, a help card or a menu would say them ("look" alone stays: a lower
 * third's or a picture's look).
 */
const GONE = /\b(?:[Pp]rops?|Looks?|[Mm]asks?|[Ii]dle rotation|[Tt]hemes?|[Ll]ogo)\b/u;

const press = (key: string) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false });

describe('taken out (Session 55, Part 12)', () => {
  it('the keys: no clear of props or masks and no Logo; F4, F8 and L do nothing; F12 is the Wallpaper', () => {
    const actions = KEYMAP.map((b) => b.action as string);
    for (const gone of ['clearProps', 'clearMasks', 'toggleLogo']) expect(actions).not.toContain(gone);
    for (const platform of ['darwin', 'win32']) {
      for (const key of ['F4', 'F8', 'l', 'L']) expect(actionFor(press(key), platform), key).toBeNull();
      expect(actionFor(press('F12'), platform)).toBe('toggleWallpaper');
    }
    expect(KEYMAP.find((b) => b.action === 'toggleWallpaper')).toMatchObject({
      keys: ['F12'],
      label: 'Wallpaper',
    });
    expect(KEYMAP.filter((b) => GONE.test(b.label))).toEqual([]);
    expect(KEY_GROUPS.flatMap((g) => g.actions)).toContain('toggleWallpaper');
    // The single-letter keys the switch turns off: L went with the Logo.
    expect(SINGLE_KEYS).toEqual(['B', '.', '?']);
    expect(SINGLE_KEYS_TEXT).toBe('B, . and ?');
  });

  it('the engine: no props or masks layer, and none of their commands; the Wallpaper on and off', () => {
    expect(LAYER_NAMES as readonly string[]).not.toContain('props');
    expect(LAYER_NAMES as readonly string[]).not.toContain('masks');
    for (const command of [
      { type: 'showLogo', prop: { id: 'x', name: 'x', elements: [] } },
      { type: 'hideLogo' },
      { type: 'showProp', prop: { id: 'x', name: 'x', elements: [] } },
      { type: 'hideProp', propId: 'x' },
      { type: 'setMask', mask: { id: 'x', name: 'x', width: 1920, height: 1080, shapes: [] } },
      { type: 'setLook', lookId: 'x' },
      { type: 'startIdle' },
      { type: 'stopIdle' },
      { type: 'clearLayer', layer: 'props' },
      { type: 'clearLayer', layer: 'masks' },
    ])
      expect(parseEngineCommand(command).ok, command.type).toBe(false);
    expect(parseEngineCommand({ type: 'toggleWallpaper' }).ok).toBe(true);
    expect(parseEngineCommand({ type: 'setWallpaper', on: true }).ok).toBe(true);
    // 16: the wallpaper's switch in the logo's place; 17 (Part 15) messages' looks, the stage message's size, timers for
    // the audience; 18 (Part 6) the chosen wallpaper; 20 (Part 5) a picture's crop, turn, flips and blurred fill; 22
    // (Part 16) the Lower Thirds studio's lower thirds; 23 (Part 17a) a slide's words underlined, struck through,
    // glowing and listed; each only adds to 16, which with alpha.13's 15 (and 14, 13, 12) is still read whole.
    // 26 (Part 10) live captions, only adding to 23 (with 24 and 25 between, each only adding).
    expect(ENGINE_STATE_VERSION).toBe(26);
    for (const version of [26, 25, 24, 23, 22, 20, 18, 17, 16, 15, 14, 13, 12])
      expect(readsEngineVersion(version), String(version)).toBe(true);
  });

  it('a phone and the API: none of their commands or requests; the Wallpaper’s', () => {
    const commands = REMOTE_COMMANDS as readonly string[];
    for (const gone of ['setLook', 'hideProp', 'startIdle', 'stopIdle', 'showLogo', 'hideLogo'])
      expect(commands).not.toContain(gone);
    expect(commands).toContain('setWallpaper');
    expect(commands).toContain('toggleWallpaper');
    const requests = Object.keys(DEVICE_OPS);
    for (const gone of ['looks', 'logo', 'logo.set', 'props', 'prop.show', 'masks', 'mask.show'])
      expect(requests).not.toContain(gone);
  });

  it('MIDI: no Logo to learn or name; a pad mapped to it before is still read (and does nothing)', () => {
    expect(MIDI_LEARNABLE as readonly string[]).not.toContain('logo');
    expect(Object.values(MIDI_ACTION_NAMES)).not.toContain('Logo');
    const kept = midiSettingsSchema.safeParse({
      deviceName: 'Placeholder pad',
      mappings: [{ input: { type: 'note', channel: 0, number: 36 }, action: { kind: 'logo' } }],
    });
    expect(kept.success).toBe(true);
  });

  it('Events out: the wallpaper on or off, in the logo’s place', () => {
    expect(EVENT_KINDS as readonly string[]).not.toContain('logo.changed');
    expect(EVENT_KINDS as readonly string[]).toContain('wallpaper.changed');
    expect(Object.values(EVENT_NAMES).filter((n) => GONE.test(n))).toEqual([]);
  });

  it('the window’s requests: none of Props, Looks, Masks or the Idle rotation, and no theme editing', () => {
    const groups = IPC as unknown as Record<string, Record<string, string> | undefined>;
    for (const gone of ['props', 'looks', 'masks', 'idle']) expect(groups[gone], gone).toBeUndefined();
    const themes = Object.keys(groups['themes'] ?? {});
    for (const gone of ['save', 'remove', 'apply', 'setDefault', 'fromPresentation', 'fromSlide'])
      expect(themes, gone).not.toContain(gone);
  });

  it('the help cards: none for them, and none names them', () => {
    const cards = PANEL_HELP as unknown as Record<string, { title: string; text: string } | undefined>;
    for (const gone of ['props', 'looks', 'masks', 'idle']) expect(cards[gone], gone).toBeUndefined();
    for (const [key, card] of Object.entries(cards))
      expect(`${card?.title ?? ''} ${card?.text ?? ''}`, key).not.toMatch(GONE);
  });
});
