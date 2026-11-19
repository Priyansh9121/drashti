import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROGRAMS } from '../../../scripts/fetch-video-out.mjs';
import { videoOutProgram, videoOutSender } from './sender';

/*
 * Which way this computer's Drashti sends its picture (x30; the owner's "Go, all A"): Syphon on a Mac and Spout on
 * Windows, by the program scripts/fetch-video-out.mjs builds, where the installers put it; nothing elsewhere.
 */

const place = {
  standIn: null,
  arch: 'arm64',
  packaged: true,
  resourcesPath: join('/', 'Applications', 'Drashti.app', 'Contents', 'Resources'),
  appPath: join('/', 'repo'),
};

describe('video out’s way on this computer (x30)', () => {
  it('is Syphon on a Mac and Spout on Windows, by the program the installers put in the resources', () => {
    const all = () => true;
    expect(videoOutSender({ ...place, platform: 'darwin' }, all)).toEqual({
      way: 'syphon',
      program: join(place.resourcesPath, 'video-out', PROGRAMS.darwin.sender),
    });
    expect(videoOutSender({ ...place, platform: 'win32', arch: 'x64' }, all)).toEqual({
      way: 'spout',
      program: join(place.resourcesPath, 'video-out', PROGRAMS.win32.sender),
    });
  });

  it('runs the program scripts/fetch-video-out.mjs left in vendor/ when Drashti runs from the repository', () => {
    for (const [platform, arch] of [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['win32', 'x64'],
    ] as const)
      expect(videoOutProgram({ ...place, platform, arch, packaged: false })).toBe(
        join(place.appPath, 'vendor', 'video-out', `${platform}-${arch}`, PROGRAMS[platform].sender),
      );
  });

  it('offers nothing where there is no program, nor on another system', () => {
    expect(videoOutSender({ ...place, platform: 'darwin' }, () => false)).toBeNull();
    expect(videoOutSender({ ...place, platform: 'linux' }, () => true)).toBeNull();
  });

  it('uses the tests’ stand-in receiver when a test names its file', () => {
    expect(videoOutSender({ ...place, platform: 'linux', standIn: 'seen.json' }, () => false)).toEqual({
      way: 'stand-in',
      file: 'seen.json',
    });
  });
});
