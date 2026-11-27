import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_FILE, isNewInstall } from './appearance-file';
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

  it('cleans one’s own name as Rename… cleans one: nothing visible is no name, a hidden mark is left out (X14)', () => {
    const service = new AppearanceService({ userData: fresh(), say: () => undefined });
    service.start(new Computer(false));
    expect(service.make({ name: '\u200B\u2060\u00AD', base: 'dark', accent: '#5aa2ff' })).toMatchObject({
      ok: false,
    });
    const made = service.make({ name: 'Placeholder\u200E\town', base: 'dark', accent: '#5aa2ff' });
    expect(made.ok).toBe(true);
    expect(service.own().map((a) => a.name)).toEqual(['Placeholder own']);
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

  it('reads a file an earlier Drashti wrote (alpha.7: no second colours), so an updated computer keeps what it showed', () => {
    for (const [choice, shown] of [
      ['follow', 'black'],
      ['white', 'white'],
      ['saffron', 'saffron'],
      ['own-a1b2c3d4e5f6', 'own-a1b2c3d4e5f6'],
    ] as const) {
      const dir = fresh();
      writeFileSync(
        join(dir, APPEARANCE_FILE),
        JSON.stringify({
          version: 1,
          choice,
          motion: 'lively',
          own: [{ id: 'own-a1b2c3d4e5f6', name: 'Placeholder kept', base: 'light', accent: '#0b5c7a' }],
        }),
      );
      const said: string[] = [];
      const service = new AppearanceService({ userData: dir, say: (l) => said.push(l) });
      service.start(new Computer(true));
      expect(said, choice).toEqual([]);
      expect(service.choice).toBe(choice);
      expect(service.shown().id).toBe(shown);
      expect(service.now().motion).toBe('lively');
      expect(service.own()).toEqual([
        { id: 'own-a1b2c3d4e5f6', name: 'Placeholder kept', base: 'light', accent: '#0b5c7a' },
      ]);
    }
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

  it('a new install starts in Lively and keeps it; a computer that had Drashti before stays as it was, Calm until chosen (alpha.24)', () => {
    // The owner's QA24-UI-3 ("more interactive and more animated"), lead 2's recommendation answered as recommended.
    const dir = fresh();
    const said: string[] = [];
    const first = new AppearanceService({ userData: dir, say: (l) => said.push(l), newInstall: true });
    first.start(new Computer(true));
    expect(first.now().motion).toBe('lively');
    expect(first.view().motion).toBe('lively');
    expect(first.choice).toBe('follow');
    expect(kept(dir)).toMatchObject({ version: 1, choice: 'follow', motion: 'lively', own: [] });
    expect(said.join('\n')).toContain('interface motion lively');
    // Its next start is no new install: what was kept stands.
    expect(isNewInstall(dir)).toBe(false);
    const again = new AppearanceService({ userData: dir, say: () => undefined, newInstall: false });
    expect(again.now().motion).toBe('lively');
    // Chosen Calm, it stays Calm.
    expect(again.setMotion('calm')).toBe(true);
    expect(new AppearanceService({ userData: dir, say: () => undefined }).now().motion).toBe('calm');
    // A computer that had Drashti before, with nothing chosen: Calm, and nothing written.
    const old = fresh();
    const before = new AppearanceService({ userData: old, say: () => undefined, newInstall: false });
    expect(before.now().motion).toBe('calm');
    expect(existsSync(join(old, APPEARANCE_FILE))).toBe(false);
  });

  it('a new install is a data folder with no role, no library and no appearance kept', () => {
    const dir = fresh();
    expect(isNewInstall(dir)).toBe(true);
    expect(isNewInstall(join(dir, 'not-made-yet'))).toBe(true);
    for (const name of ['drashti-role.json', 'drashti.sqlite', APPEARANCE_FILE]) {
      const had = fresh();
      writeFileSync(join(had, name), '{}');
      expect(isNewInstall(had), name).toBe(false);
    }
  });

  it('Moving is On until turned Off (Session 60, his safety rule), kept for the next start, and every window told', () => {
    const dir = fresh();
    const service = new AppearanceService({ userData: dir, say: () => undefined });
    service.start(new Computer(true));
    const { win, sent } = aWindow();
    service.track(win as never);
    expect(service.now().moving).toBe(true);
    expect(service.view().moving).toBe(true);
    expect(service.setMoving(false)).toBe(true);
    expect(service.now().moving).toBe(false);
    expect((sent.at(-1) as { moving: boolean }).moving).toBe(false);
    expect(kept(dir)).toMatchObject({ moving: false });
    expect(new AppearanceService({ userData: dir, say: () => undefined }).now().moving).toBe(false);
  });

  it('a file from before Session 60 reads as Moving On with no favourites, keeping what it chose', () => {
    const dir = fresh();
    writeFileSync(
      join(dir, APPEARANCE_FILE),
      JSON.stringify({ version: 1, choice: 'diwali', motion: 'calm', own: [], seconds: {} }),
    );
    const service = new AppearanceService({ userData: dir, say: () => undefined });
    service.start(new Computer(true));
    expect(service.choice).toBe('diwali');
    expect(service.now().moving).toBe(true);
    expect(service.view().favourites).toEqual([]);
  });

  it('favourites (Session 60): starred and unstarred, kept in the order starred, one there is not refused', () => {
    const dir = fresh();
    const service = new AppearanceService({ userData: dir, say: () => undefined });
    service.start(new Computer(true));
    expect(service.setFavourite('diwali', true)).toBe(true);
    expect(service.setFavourite('dhaja', true)).toBe(true);
    expect(service.setFavourite('diwali', true)).toBe(true);
    expect(service.view().favourites).toEqual(['diwali', 'dhaja']);
    expect(service.setFavourite('diwali', false)).toBe(true);
    expect(service.setFavourite('nothing-at-all', true)).toBe(false);
    expect(service.view().favourites).toEqual(['dhaja']);
    expect(kept(dir)).toMatchObject({ favourites: ['dhaja'] });
    expect(new AppearanceService({ userData: dir, say: () => undefined }).view().favourites).toEqual([
      'dhaja',
    ]);
  });

  it('says what the shown appearance moves and whether this computer is slow (four logical cores or fewer)', () => {
    const dir = fresh();
    const slow = new AppearanceService({ userData: dir, say: () => undefined, cores: 4 });
    slow.start(new Computer(true));
    expect(slow.now().look).toEqual([]);
    expect(slow.now().slow).toBe(true);
    slow.choose('diwali');
    expect(slow.now().look).toEqual(['glow', 'shimmer']);
    slow.choose('dhaja');
    expect(slow.now().look).toEqual([]);
    const fast = new AppearanceService({ userData: dir, say: () => undefined, cores: 8 });
    fast.start(new Computer(true));
    expect(fast.now().slow).toBe(false);
  });

  it('says whether Chromium draws with a graphics chip: unknown until it has said, and every window told when it does', () => {
    const dir = fresh();
    let chip: 'unknown' | 'yes' | 'no' = 'unknown';
    const service = new AppearanceService({ userData: dir, say: () => undefined, chip: () => chip });
    service.start(new Computer(true));
    const { win, sent } = aWindow();
    service.track(win as never);
    expect(service.now().chip).toBe('unknown');
    chip = 'no';
    service.chipMayHaveChanged();
    expect(service.now().chip).toBe('no');
    expect((sent.at(-1) as { chip: string }).chip).toBe('no');
    // Told once: a second word that changes nothing tells no window again.
    const told = sent.length;
    service.chipMayHaveChanged();
    expect(sent.length).toBe(told);
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
