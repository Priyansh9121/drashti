import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { YouTubeType } from '../../shared/links';
import type { FromWorker, ToWorker } from './protocol';
import {
  DOWNLOAD_STEM,
  downloadArgs,
  lookArgs,
  parseDetails,
  parseProgress,
  youtubeProblem,
  youtubeProblemMessage,
} from './youtube';
import { runYtDlp, type ToolRun, type YtDlpLaunch } from './youtube-run';

/*
 * YouTube in the download process (Session 25c): yt-dlp runs here, one run
 * at a time. While the stream is on air or recording nothing starts, and a
 * download going on stops (yt-dlp, Deno and FFmpeg alike) and starts again
 * afterwards with the same command, which carries on from its part-file.
 * It stops too when the disk would have less than 2 GB free.
 */

export interface YoutubeWorker {
  look(m: Extract<ToWorker, { type: 'yt-look' }>): void;
  download(m: Extract<ToWorker, { type: 'yt-download' }>): void;
  hold(on: boolean): void;
  stop(): void;
}

/** How often the free space is looked at while yt-dlp writes. */
const SPACE_EVERY_MS = 2000;

export function youtubeWorker(
  post: (message: FromWorker) => void,
  freeBytes: (dir: string) => number,
  run: (
    launch: YtDlpLaunch,
    args: string[],
    cwd: string,
    onLine: (line: string) => void,
  ) => ToolRun = runYtDlp,
): YoutubeWorker {
  let held = false;
  let stopped = false;
  let current: ToolRun | null = null;
  /** The download asked for, while it is still to finish (started again after a hold). */
  let pending: Extract<ToWorker, { type: 'yt-download' }> | null = null;
  let space: NodeJS.Timeout | null = null;
  let why: 'hold' | 'space' | null = null;
  /** The most said of the download's progress so far. */
  let said = 0;

  const fail = (code: Parameters<typeof youtubeProblemMessage>[0]) => {
    post({ type: 'failed', code, message: youtubeProblemMessage(code) });
  };

  const started = (r: ToolRun) => {
    current = r;
    post({ type: 'tool', pid: r.pid });
  };
  const ended = () => {
    current = null;
    post({ type: 'tool', pid: null });
  };

  /** The finished file yt-dlp left: download.mp4 or download.mp3, never a part-file. */
  const finished = (workDir: string, type: YouTubeType): string | null => {
    const name = `${DOWNLOAD_STEM}.${type}`;
    try {
      return readdirSync(workDir).includes(name) ? join(workDir, name) : null;
    } catch {
      return null;
    }
  };

  const startDownload = () => {
    const m = pending;
    if (!m || held || stopped || current) return;
    why = null;
    // yt-dlp counts each part on its own (the picture, then the sound): add them up, and only ever
    // say more than before (a run started again after a hold counts its parts again).
    let offset = 0;
    let partDone = 0;
    let partTotal: number | null = null;
    const r = run(m.launch, downloadArgs(m.launch, m.link, m.choice, m.workDir), m.cwd, (line) => {
      const p = parseProgress(line);
      if (!p) return;
      if (p.done < partDone) offset += partTotal ?? partDone;
      partDone = p.done;
      partTotal = p.total;
      if (offset + p.done > said) {
        said = offset + p.done;
        post({ type: 'progress', done: said, total: null });
      }
    });
    started(r);
    space = setInterval(() => {
      try {
        if (freeBytes(m.workDir) < m.keepFree) {
          why = 'space';
          r.stop();
        }
      } catch {
        // The folder is gone (a stop): nothing to look at.
      }
    }, SPACE_EVERY_MS);
    space.unref();
    void r.done.then(({ code, errors }) => {
      if (space) clearInterval(space);
      space = null;
      ended();
      if (stopped) return;
      // Stopped for the stream: it starts again when the hold ends (now, if it ended meanwhile).
      if (why === 'hold') {
        startDownload();
        return;
      }
      pending = null;
      if (why === 'space') {
        fail('space');
        return;
      }
      const file = code === 0 ? finished(m.workDir, m.choice.type) : null;
      if (file === null) {
        const problem = youtubeProblem(errors);
        post({ type: 'failed', code: problem.code, message: problem.message });
        return;
      }
      post({ type: 'yt-downloaded', file, bytes: statSync(file).size });
    });
  };

  return {
    look: (m) => {
      let json = '';
      const r = run(m.launch, lookArgs(m.launch, m.link), m.cwd, (line) => {
        if (line.trimStart().startsWith('{')) json = line;
      });
      started(r);
      void r.done.then(({ code, errors }) => {
        ended();
        if (stopped) return;
        if (code !== 0 || json === '') {
          const problem = youtubeProblem(errors);
          post({ type: 'failed', code: problem.code, message: problem.message });
          return;
        }
        const details = parseDetails(json);
        if (!details.ok)
          post({ type: 'failed', code: details.problem.code, message: details.problem.message });
        else post({ type: 'yt-looked', details: details.details });
      });
    },
    download: (m) => {
      pending = m;
      said = 0;
      startDownload();
    },
    hold: (on) => {
      held = on;
      if (on && current && pending) {
        why = 'hold';
        current.stop();
      } else if (!on) startDownload();
    },
    stop: () => {
      stopped = true;
      pending = null;
      current?.stop();
    },
  };
}
