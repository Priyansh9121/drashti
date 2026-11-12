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
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', expect.stringContaining('availableFontFamilies')],
      expect.objectContaining({
        windowsHide: true,
        timeout: expect.any(Number),
        maxBuffer: expect.any(Number),
      }),
      expect.any(Function),
    );
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
    expect(execFile).toHaveBeenCalledWith(
      expect.stringMatching(/powershell\.exe$/iu),
      expect.arrayContaining([
        '-NoProfile',
        '-NonInteractive',
        expect.stringContaining('InstalledFontCollection'),
      ]),
      expect.objectContaining({
        windowsHide: true,
        timeout: expect.any(Number),
        maxBuffer: expect.any(Number),
      }),
      expect.any(Function),
    );
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
