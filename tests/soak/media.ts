import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The soak's media (Session 15; shared with the DevTools comparison in Session 17): made on the runner
 * by the bundled FFmpeg, placeholder words and generated pictures, videos and tones only.
 */

/** Media made here by the bundled FFmpeg: videos with a tone, pictures, and tones for the music. */
export function makeMedia(ffmpeg: string, dir: string): string[] {
  const run = (args: string[]) => {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
    if (r.status !== 0)
      throw new Error(`FFmpeg could not make test media: ${r.stderr.toString().slice(0, 300)}`);
  };
  const files: string[] = [];
  for (const [i, hz] of [
    [1, 330],
    [2, 440],
    [3, 550],
  ] as const) {
    const out = join(dir, `Placeholder soak video ${String(i)}.mp4`);
    run([
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=1920x1080:rate=30`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${String(hz)}:sample_rate=48000`,
      '-t',
      '12',
      '-vf',
      `hue=h=${String(i * 90)}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-g',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      out,
    ]);
    files.push(out);
  }
  for (const [i, colour] of [
    [1, '0x1d4e89'],
    [2, '0x7f1d1d'],
  ] as const) {
    const out = join(dir, `Placeholder soak picture ${String(i)}.png`);
    run(['-f', 'lavfi', '-i', `color=c=${colour}:size=1920x1080`, '-frames:v', '1', out]);
    files.push(out);
  }
  for (const [i, hz] of [
    [1, 262],
    [2, 392],
  ] as const) {
    const out = join(dir, `Placeholder soak tone ${String(i)}.wav`);
    run(['-f', 'lavfi', '-i', `sine=frequency=${String(hz)}:sample_rate=44100`, '-t', '30', out]);
    files.push(out);
  }
  for (const i of [1, 2, 3]) {
    const out = join(dir, `Placeholder soak words ${String(i)}.txt`);
    const verses = Array.from(
      { length: 6 },
      (_, v) => `Placeholder words ${String(i)}, slide ${String(v + 1)}\nનમૂના પંક્તિ ${String(v + 1)}\n`,
    );
    writeFileSync(out, `[Verse]\n${verses.join('\n')}`);
    files.push(out);
  }
  return files;
}
