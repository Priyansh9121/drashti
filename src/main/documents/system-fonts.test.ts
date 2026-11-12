import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSystemFontFamilies } from './system-fonts';

type OnExit = (error: Error | null, stdout: string) => void;
type ExecFile = (file: string, args: string[], options: unknown, done: OnExit) => void;

const execFile = vi.hoisted(() => vi.fn<ExecFile>());
vi.mock('node:child_process', () => ({ execFile }));

describe('the editor’s installed font families', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  it('asks AppKit only on the first request and shares the result with concurrent editors', async () => {
    const read = createSystemFontFamilies('darwin');
    expect(execFile).not.toHaveBeenCalled();
    execFile.mockImplementation((_file, _args, _options, done) => {
      queueMicrotask(() => done(null, '["Placeholder Serif"," Placeholder Sans ","placeholder sans"]'));
    });

    const expected = ['Placeholder Sans', 'Placeholder Serif'];
    expect(await Promise.all([read(), read()])).toEqual([expected, expected]);
    expect(await read()).toEqual(expected);
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, options, onExit] = execFile.mock.calls[0] ?? [];
    expect(file).toBe('/usr/bin/osascript');
    expect(args?.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
    expect(args?.[3]).toContain('availableFontFamilies');
    expect(options).toMatchObject({ windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
    expect(typeof onExit).toBe('function');
  });

  it('keeps Unicode Windows font names and discards paths and malformed entries', async () => {
    const read = createSystemFontFamilies('win32');
    const stdout = JSON.stringify([
      'Placeholder Sans',
      'નમૂના ફૉન્ટ',
      '',
      'C:\\Placeholder\\font.ttf',
      '/Placeholder/font.otf',
      'Placeholder\nFont',
      { family: 'Placeholder private record' },
    ]);
    execFile.mockImplementation((_file, _args, _options, done) => done(null, stdout));

    const names = await read();

    expect(names).toHaveLength(2);
    expect(names).toEqual(expect.arrayContaining(['Placeholder Sans', 'નમૂના ફૉન્ટ']));
    const [file, args, options, onExit] = execFile.mock.calls[0] ?? [];
    expect(file).toMatch(/powershell\.exe$/iu);
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-NonInteractive');
    expect(args?.at(-1)).toContain('InstalledFontCollection');
    expect(options).toMatchObject({ windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
    expect(typeof onExit).toBe('function');
  });

  it('keeps command errors and unparseable output inside Main', async () => {
    const readMac = createSystemFontFamilies('darwin');
    execFile.mockImplementation((_file, _args, _options, done) => {
      done(new Error('Placeholder private path /Placeholder/Fonts'), '["Placeholder incomplete font"]');
    });
    expect(await readMac()).toEqual([]);

    const readWindows = createSystemFontFamilies('win32');
    execFile.mockImplementation((_file, _args, _options, done) => done(null, 'Placeholder broken JSON'));
    expect(await readWindows()).toEqual([]);
  });

  it('returns an empty list on an unsupported platform without starting a process', async () => {
    const read = createSystemFontFamilies('linux');
    expect(await read()).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });
});
