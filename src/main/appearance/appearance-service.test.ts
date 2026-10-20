import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_FILE } from './appearance-file';
import { hexToOklch } from '../../shared/appearance/oklch';
import { AppearanceService, type ComputerTheme } from './appearance-service';

/*
 * The appearance this computer shows (Sessions 39–40), in the main process: kept per computer in its file, read
 * at the start (one that cannot be read set aside, the computer followed), Follow the computer following it
 * turning light or dark, one's own made only when every rule is met and deleted (the computer followed again
 * if it was in use), and interface motion kept with it. A stand-in computer theme and window; made-up names.
 */

class Computer extends EventEmitter implements ComputerTheme {
  source: 'system' | 'light' | 'dark' = 'system';
  constructor(public dark: boolean) {
    super();
  }
  get themeSource() {
    return this.source;
  }
  set themeSource(s: 'system' | 'light' | 'dark') {
    this.source = s;
    this.emit('updated');
  }
  get shouldUseDarkColors() {
    return this.source === 'system' ? this.dark : this.source === 'dark';
  }
  /** The computer turning light or dark by itself. */
  turn(dark: boolean) {
    this.dark = dark;
    this.emit('updated');
  }
}

/** A window of Drashti's own, as the service sees it. */
function aWindow() {
  const sent: unknown[] = [];
  const colours: string[] = [];
  const win = {
    isDestroyed: () => false,
    setBackgroundColor: (c: string) => colours.push(c),
    once: () => win,
    webContents: {
      isDestroyed: () => false,
      send: (_channel: string, payload: unknown) => sent.push(payload),
    },
  };
  return { win, sent, colours };
}

const fresh = () => mkdtempSync(join(tmpdir(), 'drashti-appearance-'));
const kept = (dir: string) =>
  JSON.parse(readFileSync(join(dir, APPEARANCE_FILE), 'utf8')) as Record<string, unknown>;

describe('AppearanceService', () => {
  it('follows the computer by default, turning with it, and tells each window at once', () => {
    const dir = fresh();
    const said: string[] = [];
    const service = new AppearanceService({ userData: dir, say: (l) => said.push(l) });
    const computer = new Computer(true);
    service.start(computer);
    const { win, sent, colours } = aWindow();
    service.track(win as never);
    expect(service.choice).toBe('follow');
    expect(computer.source).toBe('system');
    expect(service.shown().id).toBe('black');
    computer.turn(false);
    expect(service.shown().id).toBe('white');
    expect(colours.at(-1)).toBe(service.shown().colours.ink);
    expect((sent.at(-1) as { id: string }).id).toBe('white');
    expect(existsSync(join(dir, APPEARANCE_FILE))).toBe(false);
  });

  it('keeps a choice for the next start, and the native parts take its base', () => {
    const dir = fresh();
    const first = new AppearanceService({ userData: dir, say: () => undefined });
    const computer = new Computer(true);
    first.start(computer);
    expect(first.choose('sandalwood')).toBe(true);
    expect(computer.source).toBe('light');
    expect(first.choose('no-such-one')).toBe(false);
    expect(kept(dir)).toMatchObject({ version: 1, choice: 'sandalwood', motion: 'calm', own: [] });
    const again = new AppearanceService({ userData: dir, say: () => undefined });
    again.start(new Computer(true));
    expect(again.shown().id).toBe('sandalwood');
    // The computer turning dark changes nothing while another is chosen.
    expect(again.background()).toBe(again.shown().colours.ink);
  });

  it('sets aside a file it cannot read and follows the computer, saying so', () => {
    const dir = fresh();
    writeFileSync(join(dir, APPEARANCE_FILE), '{"version":1,"choice":');
    const said: string[] = [];
    const service = new AppearanceService({ userData: dir, say: (l) => said.push(l) });
    expect(service.choice).toBe('follow');
    expect(said.join('\n')).toContain(`${APPEARANCE_FILE} could not be read`);
    expect(readdirSync(dir).some((f) => f.startsWith('drashti-appearance.unreadable-'))).toBe(true);
  });

  it('makes one’s own only when every rule is met, chooses it, and deletes it back to the computer’s', () => {
    const dir = fresh();
    const service = new AppearanceService({ userData: dir, say: () => undefined });
    service.start(new Computer(false));
    const refused = service.make({ name: 'Placeholder near LIVE', base: 'dark', accent: '#d0302f' });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? '' : refused.message).toContain('LIVE’s red');
    expect(service.make({ name: 'Black', base: 'dark', accent: '#5aa2ff' })).toEqual({
      ok: false,
      message: 'There is already one called “Black”: give it another name.',
    });
    const made = service.make({ name: 'Placeholder own', base: 'dark', accent: '#5aa2ff' });
    expect(made.ok).toBe(true);
    const id = made.ok ? made.id : '';
    expect(service.choice).toBe(id);
    expect(service.shown().colours.primary).toBe('#5aa2ff');
    expect(service.list().map((a) => a.id)).toContain(id);
    expect(service.remove('black')).toBe(false);
    expect(service.remove(id)).toBe(true);
    expect(service.choice).toBe('follow');
    expect(kept(dir)).toMatchObject({ choice: 'follow', own: [] });
  });

  it('keeps one’s own second colour beside the list, so a Drashti from before Session 42 still reads the file', () => {
    const dir = fresh();
    const service = new AppearanceService({ userData: dir, say: () => undefined });
    service.start(new Computer(false));
    const refused = service.make({
      name: 'Placeholder marks near LIVE',
      base: 'dark',
      accent: '#5aa2ff',
      second: '#d0302f',
    });
    expect(refused.ok ? '' : refused.message).toContain('This second colour is too close to');
    const made = service.make({
      name: 'Placeholder second',
      base: 'dark',
      accent: '#5aa2ff',
      second: '#3aa0d8',
    });
    expect(made.ok).toBe(true);
    const id = made.ok ? made.id : '';
    // The list's entries keep exactly what they kept before (alpha.7 refuses any other field in them).
    const file = kept(dir) as { own: Record<string, unknown>[]; seconds: Record<string, string> };
    expect(Object.keys(file.own[0] ?? {}).sort()).toEqual(['accent', 'base', 'id', 'name']);
    expect(file.seconds).toEqual({ [id]: '#3aa0d8' });
    const again = new AppearanceService({ userData: dir, say: () => undefined });
    again.start(new Computer(false));
    expect(again.own()).toEqual([
      { id, name: 'Placeholder second', base: 'dark', accent: '#5aa2ff', second: '#3aa0d8' },
    ]);
    const shown = again.shown();
    expect(shown.id).toBe(id);
    // Its own hue, moved in lightness only as far as its rules need.
    expect(Math.abs(hexToOklch(shown.decoration.second).h - hexToOklch('#3aa0d8').h)).toBeLessThan(6);
    // Deleted, its second colour goes with it.
    expect(again.remove(id)).toBe(true);
    expect(kept(dir)).toMatchObject({ own: [], seconds: {} });
  });

  it('keeps the interface motion with it, and refuses one it does not know', () => {
    const dir = fresh();
    const service = new AppearanceService({ userData: dir, say: () => undefined });
    service.start(new Computer(true));
    expect(service.setMotion('lively')).toBe(true);
    expect(service.setMotion('bouncy')).toBe(false);
    expect(service.now().motion).toBe('lively');
    expect(kept(dir)).toMatchObject({ motion: 'lively' });
  });

  it('starts in the appearance a test names (never kept unless chosen)', () => {
    const dir = fresh();
    const service = new AppearanceService({ userData: dir, say: () => undefined, startIn: 'black' });
    service.start(new Computer(false));
    expect(service.shown().id).toBe('black');
    expect(new AppearanceService({ userData: dir, say: () => undefined, startIn: 'nothing' }).choice).toBe(
      'follow',
    );
  });
});
