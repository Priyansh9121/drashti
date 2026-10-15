import { describe, expect, it } from 'vitest';
import { ffmpegEnv } from './ffmpeg-env';

/*
 * FFmpeg's own environment (Session 28; the skills review's MED-4): only what it needs to run, never what
 * Drashti was started with. FFREPORT would have FFmpeg write a report of its whole command line (a stream
 * key in it) beside it; AV_LOG_FORCE_* changes what it says.
 */

const STARTED_WITH = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/placeholder',
  TMPDIR: '/var/folders/placeholder/T/',
  LANG: 'en_AU.UTF-8',
  FFREPORT: 'file=ffreport.log:level=32',
  AV_LOG_FORCE_COLOR: '1',
  AV_LOG_FORCE_NOCOLOR: '1',
  DRASHTI_TEST_LINK_GUARD: '1',
  ELECTRON_RUN_AS_NODE: '1',
  SSH_AUTH_SOCK: '/private/tmp/placeholder/Listeners',
};

describe("FFmpeg's environment", () => {
  it('on a Mac: the path and the temporary folder only', () => {
    expect(ffmpegEnv(STARTED_WITH, 'darwin')).toEqual({
      PATH: '/usr/bin:/bin',
      TMPDIR: '/var/folders/placeholder/T/',
    });
  });

  it('on Windows: what its networking and encoders need, as Windows names it, whatever the case', () => {
    const windows = {
      Path: 'C:\\Windows\\system32;C:\\Windows',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      TEMP: 'C:\\Users\\placeholder\\AppData\\Local\\Temp',
      TMP: 'C:\\Users\\placeholder\\AppData\\Local\\Temp',
      SystemDrive: 'C:',
      NUMBER_OF_PROCESSORS: '4',
      PROCESSOR_ARCHITECTURE: 'AMD64',
      USERPROFILE: 'C:\\Users\\placeholder',
      FFREPORT: 'file=ffreport.log',
      AV_LOG_FORCE_COLOR: '1',
      DRASHTI_PRIORITY: 'normal',
    };
    expect(ffmpegEnv(windows, 'win32')).toEqual({
      Path: 'C:\\Windows\\system32;C:\\Windows',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      TEMP: 'C:\\Users\\placeholder\\AppData\\Local\\Temp',
      TMP: 'C:\\Users\\placeholder\\AppData\\Local\\Temp',
      SystemDrive: 'C:',
      NUMBER_OF_PROCESSORS: '4',
      PROCESSOR_ARCHITECTURE: 'AMD64',
    });
  });

  it('never FFREPORT, AV_LOG_FORCE_*, or anything of Drashti’s own, on either', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const names = Object.keys(ffmpegEnv({ ...STARTED_WITH, SystemRoot: 'C:\\Windows' }, platform));
      expect(
        names.some((n) => /^(FFREPORT|AV_LOG_FORCE_|DRASHTI_|ELECTRON_)/iu.test(n)),
        platform,
      ).toBe(false);
    }
  });
});
