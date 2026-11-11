import { describe, expect, it } from 'vitest';
import { whisperCandidates, whisperDependencyProblem, whisperProblem } from './engine-place';

/* Where the captions engine is, and whether this computer can run it (Part 10). */

describe('the captions engine’s place (Part 10)', () => {
  it('is in the resources when packaged, in vendor/whisper from the repository', () => {
    const at = { resourcesPath: '/R', appPath: '/A', arch: 'arm64' };
    expect(whisperCandidates({ ...at, packaged: true, platform: 'darwin' })).toEqual([
      '/R/whisper/drashti-whisper',
    ]);
    expect(whisperCandidates({ ...at, packaged: false, platform: 'darwin' })).toEqual([
      '/A/vendor/whisper/darwin-arm64/drashti-whisper',
    ]);
    expect(whisperCandidates({ ...at, packaged: true, platform: 'win32', arch: 'x64' })[0]).toMatch(
      /whisper[\\/]whisper-server\.exe$/u,
    );
  });

  it('is written the way its own platform writes paths, whichever computer works it out (Windows CI, 5 Nov 2026)', () => {
    const at = { resourcesPath: 'C:\\R', appPath: 'C:\\A', packaged: true };
    expect(whisperCandidates({ ...at, platform: 'win32', arch: 'x64' })).toEqual([
      'C:\\R\\whisper\\whisper-server.exe',
    ]);
  });

  it('says plainly when this Mac is too old for it (whisper.cpp’s library needs macOS 13.3)', () => {
    expect(whisperProblem('darwin', '12.7.6')).toBe('Live captions need macOS 13.3 or later on this Mac.');
    expect(whisperProblem('darwin', '13.2.1')).toBe('Live captions need macOS 13.3 or later on this Mac.');
    expect(whisperProblem('darwin', '13.3')).toBeNull();
    expect(whisperProblem('darwin', '15.5')).toBeNull();
    expect(whisperProblem('win32', '10.0.19045')).toBeNull();
  });

  it('explains a missing Windows library and accepts either representation of the exit code', () => {
    const code = 0xc0000135;
    const message = whisperDependencyProblem('win32', code);
    expect(message).toMatch(/Reinstall Drashti/u);
    expect(whisperDependencyProblem('win32', code | 0)).toBe(message);
    expect(whisperDependencyProblem('win32', 3)).toBeNull();
    expect(whisperDependencyProblem('darwin', code)).toBeNull();
  });
});
