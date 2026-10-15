/*
 * The environment the stream's FFmpeg runs with (Session 28; the skills review's MED-4): only what it needs,
 * never what Drashti was started with. FFREPORT would have FFmpeg write a report of its whole command line,
 * a stream key in it, next to it; AV_LOG_FORCE_* would change what it says; Drashti's own switches and
 * anything else are no business of FFmpeg's. On Windows, Winsock needs SystemRoot, and the encoders and
 * TLS the system folders and a temporary folder.
 */

const POSIX = ['PATH', 'TMPDIR'];
const WINDOWS = [
  'Path',
  'SystemRoot',
  'windir',
  'SystemDrive',
  'TEMP',
  'TMP',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
];

/** The variables of `env` FFmpeg keeps, by the names `env` gives them (Windows' are any case). */
export function ffmpegEnv(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const wanted = (platform === 'win32' ? WINDOWS : POSIX).map((n) => n.toLowerCase());
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const allowed = platform === 'win32' ? wanted.includes(name.toLowerCase()) : POSIX.includes(name);
    if (allowed) out[name] = value;
  }
  return out;
}
