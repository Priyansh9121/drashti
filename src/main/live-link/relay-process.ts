import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constants, setPriority } from 'node:os';
import type { LocalProgress, RelayRun } from './live-link-service';
import { LOCAL_PLAYLIST, relayPolicy } from './relay-args';
import { CheckedHls } from './checked-hls';

/*
 * The stream link's FFmpeg as a process (alpha.20, slice 8): below normal priority, so the show always comes first,
 * yet never the lowest (Windows gives a program at the lowest almost no time while the computer is busy, as it is with
 * the screens and the stream on a computer without a graphics chip, and the hall's pictures would stop). It decodes
 * nothing, so its share is small. What it prints is never logged (an error can name the link). Written down while it
 * runs, so one a crash left running is stopped at the next start (src/main/system/leftovers.ts).
 */

export function startRelay(
  ffmpeg: string | null,
  args: string[],
  children: { started(pid: number): void; ended(pid: number): void },
): RelayRun | null {
  const policy = relayPolicy(args);
  const inputAt = args.indexOf('-i');
  const url = args[inputAt + 1];
  if (!ffmpeg || !policy || inputAt < 0 || !url) return null;
  const proxy = new CheckedHls(policy.authority, { guard: policy.guard });
  let child: ReturnType<typeof spawn> | null = null;
  const stopped = new AbortController();
  const done = (async (): Promise<{ code: number | null }> => {
    try {
      const input = await proxy.start(url);
      stopped.signal.throwIfAborted();
      const checked = [...args];
      checked[inputAt + 1] = input;
      const protocols = checked.indexOf('-protocol_whitelist');
      if (protocols < 0) return { code: null };
      // HTTPS and TLS are handled only by the gateway. No raw remote playlist reaches FFmpeg.
      checked[protocols + 1] = 'http,tcp,crypto';
      checked.splice(inputAt, 0, '-format_whitelist', 'hls,mpegts,mov,aac,mp3,webvtt');
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(http|https|all|no)_proxy$/iu.test(key)),
      );
      child = spawn(ffmpeg, checked, { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const running = child;
      const pid = running.pid;
      if (pid !== undefined) {
        try {
          setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL);
        } catch {
          /* Same priority policy. */
        }
        children.started(pid);
      }
      running.stderr?.resume();
      return await new Promise<{ code: number | null }>((resolve) => {
        running.once('error', () => resolve({ code: null }));
        running.once('close', (code) => {
          if (pid !== undefined) children.ended(pid);
          resolve({ code });
        });
      });
    } catch {
      return { code: null };
    } finally {
      await proxy.close();
    }
  })();
  return {
    done,
    stop: () => {
      stopped.abort();
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      void proxy.close();
    },
  };
}

/** How far a local stream has got, from its own playlist: its segments in order (each one's length), the newest. */
export function progressOf(text: string): LocalProgress {
  const segments: { n: number; seconds: number }[] = [];
  let targetSeconds: number | null = null;
  let seconds: number | null = null;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    const target = /^#EXT-X-TARGETDURATION:(\d+(?:\.\d+)?)$/u.exec(line);
    if (target?.[1]) targetSeconds = Number(target[1]);
    const inf = /^#EXTINF:(\d+(?:\.\d+)?)/u.exec(line);
    if (inf?.[1]) seconds = Number(inf[1]);
    const seg = /^seg-(\d{6})\.ts$/u.exec(line);
    if (seg?.[1]) {
      segments.push({ n: Number(seg[1]), seconds: seconds ?? 0 });
      seconds = null;
    }
  }
  const newest = segments.length > 0 ? Math.max(...segments.map((s) => s.n)) : null;
  return { newest, targetSeconds, segments };
}

/** A local stream's own playlist as it is now, or null while it is not written. */
export async function localPlaylist(dir: string): Promise<string | null> {
  try {
    return await readFile(join(dir, LOCAL_PLAYLIST), 'utf8');
  } catch {
    return null;
  }
}

/** A local stream's progress, read from its folder (none yet while its playlist is not written). */
export async function localProgress(dir: string): Promise<LocalProgress> {
  const text = await localPlaylist(dir);
  return text === null ? { newest: null, targetSeconds: null, segments: [] } : progressOf(text);
}
