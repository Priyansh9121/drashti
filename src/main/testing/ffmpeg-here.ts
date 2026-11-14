import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Whether the FFmpeg tests can run (Sessions 31–36, TST-12). Where Drashti's FFmpeg is not fetched (CI's
 * Ubuntu checks, a fresh checkout) they are skipped; on CI's Mac and Windows runners, which fetch it first,
 * a missing FFmpeg fails the tests rather than skipping them quietly.
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

/** RED (Session 58, CI-1): the FFmpeg a unit test runs, the bundled one's path everywhere, as before. */
export function testFfmpeg(
  _options: { linux?: boolean } = {},
  checkout: string = process.cwd(),
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return join(
    checkout,
    'vendor',
    'ffmpeg',
    `${platform}-${arch}`,
    platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  );
}
