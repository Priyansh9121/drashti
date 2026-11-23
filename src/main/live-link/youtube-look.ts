import { mkdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { YtDlpLaunch } from '../links/youtube-run';
import { runYtDlp } from '../links/youtube-run';
import { toolFolders, type ToolFolders } from '../links/youtube-tools';
import { lookArgs, youtubeProblem } from '../links/youtube';

/*
 * A YouTube live link looked at (alpha.20, slice 8): Drashti's own yt-dlp, started as From a Link…'s look is (at the
 * lowest priority, nothing of the user's, never signed in; in a test, only the fake, never the real one), asked for the
 * video's details only (--dump-single-json): nothing is downloaded. In a work folder of its own, removed after. What it
 * prints is never logged; a failure is said in yt-dlp-free plain words (links/youtube.ts youtubeProblem).
 */

export interface LookDeps {
  /** How yt-dlp starts, with its folders in `work`; or why it cannot. */
  launch(folders: ToolFolders): { ok: true; launch: YtDlpLaunch } | { ok: false; message: string };
  /** Its work folder (made afresh, removed after). */
  work: string;
  children?: { started(pid: number, group: boolean): void; ended(pid: number): void };
}

export async function lookYoutube(
  link: string,
  signal: AbortSignal,
  deps: LookDeps,
): Promise<{ ok: true; json: string } | { ok: false; message: string }> {
  const folders = toolFolders(deps.work);
  try {
    rmSync(deps.work, { recursive: true, force: true });
    for (const dir of [folders.home, folders.temp, folders.deno]) mkdirSync(dir, { recursive: true });
  } catch {
    return {
      ok: false,
      message: 'Drashti could not make its folder to look at the YouTube link. Check the disk.',
    };
  }
  const made = deps.launch(folders);
  if (!made.ok) return made;
  const lines: string[] = [];
  const run = runYtDlp(made.launch, lookArgs(made.launch, link), deps.work, (line) => {
    if (line.trim() !== '') lines.push(line);
  });
  if (run.pid !== null) deps.children?.started(run.pid, process.platform !== 'win32');
  const stop = () => {
    run.stop();
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const { code, errors } = await run.done;
    if (signal.aborted) return { ok: false, message: 'Stopped.' };
    if (code !== 0) return { ok: false, message: youtubeProblem(errors).message };
    return { ok: true, json: lines.join('\n') };
  } finally {
    signal.removeEventListener('abort', stop);
    if (run.pid !== null) deps.children?.ended(run.pid);
    // Never waited for here: Windows may hold a stopped program's folder a moment.
    void rm(deps.work, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}
