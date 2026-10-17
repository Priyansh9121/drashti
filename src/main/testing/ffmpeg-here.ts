import { existsSync } from 'node:fs';

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
