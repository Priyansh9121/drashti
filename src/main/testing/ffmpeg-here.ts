import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Whether the FFmpeg tests can run (Sessions 31–36, TST-12). Where Drashti's FFmpeg is not fetched (CI's
 * Ubuntu checks, a fresh checkout) they are skipped; on CI's Mac and Windows runners, which fetch it first,
 * a missing FFmpeg fails the tests rather than skipping them quietly. CI's Ubuntu checks fetch an FFmpeg of
 * their own for the tests proven on Linux (testFfmpeg, below); one it could not download skips them there too.
 */
export function ffmpegHere(
  path: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (existsSync(path)) return true;
  if (env['CI'] && (platform === 'darwin' || platform === 'win32'))
    throw new Error(
      `FFmpeg is missing on a CI ${platform === 'darwin' ? 'Mac' : 'Windows'} runner (${path}): its tests must run there. Fetch it first: node scripts/fetch-ffmpeg.mjs`,
    );
  return false;
}

/**
 * The FFmpeg a unit test runs: the one Drashti bundles for this computer (vendor/ffmpeg/<platform>-<arch>, fetched
 * by scripts/fetch-ffmpeg.mjs). Drashti is never built for Linux; on Linux, a test proven there (`linux`) gets CI's
 * own Linux FFmpeg (Session 58, CI-1: vendor/ffmpeg-ci/linux-x64, fetched for CI's Ubuntu checks by
 * scripts/fetch-ci-ffmpeg.mjs, never shipped). Every other test keeps the bundled path, so Ubuntu skips it as before.
 */
export function testFfmpeg(
  options: { linux?: boolean } = {},
  checkout: string = process.cwd(),
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'linux' && options.linux === true)
    return join(checkout, 'vendor', 'ffmpeg-ci', `linux-${arch}`, 'ffmpeg');
  return join(
    checkout,
    'vendor',
    'ffmpeg',
    `${platform}-${arch}`,
    platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  );
}
