import type { VideoDetails, YouTubeType } from '../../shared/links';
import type { LinkErrorCode } from './http';
import type { YoutubeProblemCode } from './youtube';
import type { YtDlpLaunch } from './youtube-run';
import type { UnzipRule } from './unzip';

/*
 * Messages between the main process and the download process (Session 25b).
 * The download process makes every request and writes every byte; the main
 * process decides where files go, when to wait, and what is imported.
 */

/** Tests only: where requests go instead, and the guard that allows only 127.0.0.1. */
export interface WorkerRoute {
  testOrigin: string | null;
  guard: boolean;
}

export type ToWorker =
  | { type: 'look'; link: string; route: WorkerRoute }
  | { type: 'download'; link: string; part: string; keepFree: number; maxBytes: number; route: WorkerRoute }
  | {
      type: 'unpack';
      zip: string;
      parent: string;
      name: string;
      keepFree: number;
      maxFiles: number;
      maxBytes: number;
    }
  /** YouTube (Session 25c): ask yt-dlp for the video's details, in `cwd` (a Drashti work folder). */
  | { type: 'yt-look'; link: string; launch: YtDlpLaunch; cwd: string }
  /** YouTube: download it into `workDir` (a hidden folder in the folder chosen). */
  | {
      type: 'yt-download';
      link: string;
      launch: YtDlpLaunch;
      cwd: string;
      workDir: string;
      choice: { type: YouTubeType; height: number | null };
      keepFree: number;
    }
  /** The stream went on air (or off): wait (or go on). A YouTube download stops, and starts again. */
  | { type: 'hold'; on: boolean }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'looked'; name: string | null; size: number | null; zip: boolean }
  | { type: 'progress'; done: number; total: number | null }
  | { type: 'downloaded'; name: string | null; zip: boolean; bytes: number }
  /** The hidden folder a zip is unpacked into first (cleared after a crash). */
  | { type: 'work-folder'; path: string }
  | { type: 'unpacked'; folder: string; files: string[]; bytes: number }
  /** YouTube: the video's details. */
  | { type: 'yt-looked'; details: VideoDetails }
  /** YouTube: yt-dlp is running as this process (null: it ended), for the main process to stop at a quit. */
  | { type: 'tool'; pid: number | null }
  /** YouTube: downloaded, as this file in the work folder. */
  | { type: 'yt-downloaded'; file: string; bytes: number }
  | {
      type: 'failed';
      code: LinkErrorCode | 'unpack' | YoutubeProblemCode;
      message: string;
      /** For an unpack: which rule stopped it (a short code for the log, never a name). */
      rule?: UnzipRule;
    };
