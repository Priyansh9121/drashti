/*
 * How FFmpeg checks the stream server's certificate (Session 23). FFmpeg 9
 * always checks it, and Drashti never turns that off. It needs to know which
 * certificate authorities to trust:
 *
 * - macOS: the bundled FFmpeg (OpenSSL) looks for them only where its builder
 *   kept them (/Volumes/ffmpeg_arm64/tool/openssl), so on any other Mac every
 *   check failed and an rtmps:// stream never went on air. It is given the
 *   system's own list, /etc/ssl/cert.pem, which macOS keeps up to date.
 * - Windows: the bundled FFmpeg (GnuTLS) uses Windows' own certificate store,
 *   as other programs do, and needs nothing. Checked on CI's Windows on 10 Oct
 *   2026: it refused a made-up authority, and went on air once that authority
 *   was in the machine's Trusted Root store, with no file given.
 */

/** The certificate authorities macOS trusts, in one file. */
export const MAC_AUTHORITIES = '/etc/ssl/cert.pem';

/** The authorities file FFmpeg is given for a secure stream on this system (null: its own way). */
export function streamAuthorities(
  platform: NodeJS.Platform,
  exists: (file: string) => boolean,
): string | null {
  return platform === 'darwin' && exists(MAC_AUTHORITIES) ? MAC_AUTHORITIES : null;
}
