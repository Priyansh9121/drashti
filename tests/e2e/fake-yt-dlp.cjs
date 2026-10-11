// A fake yt-dlp for Drashti's tests (Session 25c): never the real one, and never the internet. Drashti
// starts it instead of yt-dlp only when a test sets DRASHTI_TEST_FAKE_YT_DLP (a packaged Drashti ignores
// it), running it with Electron as Node. It answers as yt-dlp 2026.08.19 does, for made-up videos only:
//   --dump-single-json      made-up details: a title, a length, heights from 720p to 4320p, a sound
//   a download              a part-file named as yt-dlp names them, written a little at a time with
//                           progress printed through Drashti's --progress-template; a part-file left by a
//                           run that was stopped is carried on from; then an FFmpeg-made placeholder video
//                           (or sound) as download.mp4 (download.mp3), the part-file gone
// Like the one-file yt-dlp (and as yt-dlp starts Deno and FFmpeg), it starts a child process of its own,
// which lives until it ends: a test can see that stopping it stops that too.
// What it is told to do comes in DRASHTI_FAKE_YT_DLP_CONFIG (JSON): title, duration, heights, live
// (yt-dlp's live_status), failWith (a line for its error output, then it fails), steps, stepMs, and log (a
// file it notes each start, resume and finish in).
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (args[0] === '--fake-child') {
  // The child: it does nothing until it is stopped.
  setInterval(() => undefined, 1000);
} else main();

function main() {
  const config = JSON.parse(process.env.DRASHTI_FAKE_YT_DLP_CONFIG || '{}');
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const log = (line) => {
    if (config.log) fs.appendFileSync(config.log, `${line}\n`);
  };
  const link = args[args.indexOf('--') + 1] ?? '';
  const id = new URL(link).searchParams.get('v');
  const looking = args.includes('--dump-single-json');
  const child = spawn(process.execPath, [__filename, '--fake-child'], { stdio: 'ignore' });
  const end = (code) => {
    child.kill();
    process.exit(code);
  };
  log(`start ${looking ? 'look' : 'download'} ${id} pid ${process.pid} child ${child.pid}`);
  if (config.failWith) {
    process.stderr.write(`${config.failWith}\n`);
    end(1);
    return;
  }

  if (looking) {
    const heights = config.heights ?? [720, 1080, 1440, 2160, 4320];
    const duration = config.duration ?? 65;
    const formats = [
      ...heights.map((h) => ({
        format_id: String(h),
        height: h,
        // As YouTube offers them: H.264 up to 1080p, VP9 above.
        vcodec: h <= 1080 ? 'avc1.640028' : 'vp09.00.51.08',
        acodec: 'none',
        filesize_approx: h * 20_000,
      })),
      { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, filesize: 1_000_000 },
    ];
    process.stdout.write(
      `${JSON.stringify({
        id,
        title: config.title ?? 'Placeholder video',
        duration,
        live_status: config.live ?? 'not_live',
        formats,
      })}\n`,
    );
    end(0);
    return;
  }

  const dir = value('-P');
  const ffmpeg = value('--ffmpeg-location');
  const mp3 = args.includes('-x');
  const height = mp3 ? null : Number(/height<=(\d+)/u.exec(value('-f') ?? '')?.[1] ?? 0);
  const part = path.join(dir, mp3 ? 'download.f140.m4a.part' : `download.f${String(height)}.mp4.part`);
  const steps = config.steps ?? 10;
  const stepMs = config.stepMs ?? 150;
  const chunk = 1000;
  const total = steps * chunk;
  let done = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (done > 0) {
    process.stdout.write(`[download] Resuming download at byte ${String(done)}\n`);
    log(`resume ${String(done)}`);
  }
  const template = (value('--progress-template') ?? '').replace(/^download:/u, '');
  const say = () =>
    process.stdout.write(
      `${template
        .replace('%(progress.downloaded_bytes)s', String(done))
        .replace('%(progress.total_bytes)s', String(total))
        .replace('%(progress.total_bytes_estimate)s', 'NA')}\n`,
    );
  const finish = () => {
    // An FFmpeg-made placeholder where yt-dlp's own merge (or MP3) would leave its file.
    const out = path.join(dir, `download.${mp3 ? 'mp3' : 'mp4'}`);
    const size = `${String(Math.round((height * 16) / 9 / 2) * 2)}x${String(height)}`;
    const made = spawnSync(
      ffmpeg,
      mp3
        ? [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440:sample_rate=44100',
          ].concat(['-t', '1', '-c:a', 'libmp3lame', '-q:a', '2', out])
        : ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${size}:r=5`]
            .concat([
              '-f',
              'lavfi',
              '-i',
              'sine=r=48000',
              '-t',
              '1',
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
            ])
            .concat(['-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]),
    );
    if (made.status !== 0) {
      process.stderr.write('ERROR: the placeholder could not be made\n');
      end(1);
      return;
    }
    fs.rmSync(part, { force: true });
    log(`done ${mp3 ? 'mp3' : 'mp4'} ${String(height)}`);
    end(0);
  };
  const step = () => {
    if (done >= total) {
      finish();
      return;
    }
    fs.appendFileSync(part, Buffer.alloc(chunk, 0x61));
    done += chunk;
    say();
    setTimeout(step, stepMs);
  };
  say();
  setTimeout(step, stepMs);
}
