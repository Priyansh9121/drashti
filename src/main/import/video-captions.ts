import { constants } from 'node:fs';
import { open, opendir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { folderReadPath, OutsideImportFolder } from './folder-containment';
import type { ImportIssue } from '../../shared/import';
import {
  addedCaptionInfo,
  captionFileInfo,
  MAX_CAPTION_CHARS,
  MAX_CAPTION_TRACKS,
  readVideoCaptions,
  type VideoCaptionTrack,
} from '../../shared/video-captions';

export interface ReadCaptionFile {
  track: VideoCaptionTrack | null;
  problem: string | null;
}

/** Open nonblocking, check regular file/size, then read at most 2 MB plus one byte. Never follows a FIFO. */
export async function readCaptionFile(
  file: string,
  info = addedCaptionInfo(basename(file)),
  folderRoot?: string,
): Promise<ReadCaptionFile> {
  if (!/\.(srt|vtt)$/iu.test(file)) return { track: null, problem: 'Choose an SRT or WebVTT caption file.' };
  let handle;
  try {
    handle = await open(
      await folderReadPath({ path: file, folderRoot }),
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    const stat = await handle.stat();
    if (!stat.isFile()) return { track: null, problem: 'The caption file is not a regular file.' };
    if (stat.size > MAX_CAPTION_CHARS)
      return {
        track: null,
        problem: 'The caption file is too large (over 2 MB). Choose a smaller SRT or WebVTT file.',
      };
    const data = Buffer.alloc(Math.min(stat.size + 1, MAX_CAPTION_CHARS + 1));
    let done = 0;
    while (done < data.length) {
      const { bytesRead } = await handle.read(data, done, data.length - done, done);
      if (!bytesRead) break;
      done += bytesRead;
    }
    if (done > MAX_CAPTION_CHARS || done > stat.size)
      return {
        track: null,
        problem: 'The caption file changed while it was read. Add it again when it is saved.',
      };
    const bytes = data.subarray(0, done);
    let source: string;
    if (bytes[0] === 0xff && bytes[1] === 0xfe)
      source = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff)
      source = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    else source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const result = readVideoCaptions(source);
    return {
      track: result.cues.length
        ? {
            id: `${info.language}${info.automatic ? '-auto' : '-file'}`,
            ...info,
            name: basename(file),
            cues: result.cues,
          }
        : null,
      problem: result.problem,
    };
  } catch (error) {
    if (error instanceof OutsideImportFolder) return { track: null, problem: error.message };
    return {
      track: null,
      problem:
        'The caption file could not be read. Check that it is saved as UTF-8 or Unicode SRT or WebVTT, then add it again.',
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Runs in the import utility process, before database writes and never during playback. */
export async function discoverVideoCaptions(
  video: string,
  folderRoot?: string,
): Promise<{ tracks: VideoCaptionTrack[]; issues: ImportIssue[] }> {
  const tracks: VideoCaptionTrack[] = [];
  const issues: ImportIssue[] = [];
  const notice = (name: string, message: string) =>
    issues.push({
      severity: 'warning',
      code: 'video-captions',
      message: `${name}: ${message} The video can still play.`,
      fix: null,
    });
  try {
    const folder = await opendir(dirname(video));
    const names: string[] = [];
    let seen = 0;
    for await (const entry of folder) {
      if (++seen > 4096) {
        notice(
          basename(video),
          'Too many files beside this video to check every caption file. Add a caption file from its Captions menu.',
        );
        break;
      }
      if (captionFileInfo(video, entry.name)) names.push(entry.name);
      if (names.length > MAX_CAPTION_TRACKS) {
        notice(
          basename(video),
          'There are more than 12 caption files. Add the one you need from the Captions menu.',
        );
        break;
      }
    }
    for (const name of names.sort().slice(0, MAX_CAPTION_TRACKS)) {
      const info = captionFileInfo(video, name);
      if (!info) continue;
      const read = await readCaptionFile(join(dirname(video), name), info, folderRoot);
      if (read.track) tracks.push(read.track);
      if (read.problem) notice(name, read.problem);
    }
  } catch {
    notice(
      basename(video),
      'Caption files beside this video could not be checked. Add a caption file from its Captions menu.',
    );
  }
  return { tracks, issues };
}
