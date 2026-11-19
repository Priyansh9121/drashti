import { constants } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { LinkCaptionTrack, LinkSavedCaptions, VideoDetails } from '../../shared/links';
import { LINK_KEEP_FREE_BYTES, YOUTUBE_ID } from '../../shared/links';
import { cutText } from '../../shared/text';
import { claimFolder } from './names';

export const captionSuffix = (track: LinkCaptionTrack): string =>
  `.${track.language}${track.kind === 'automatic' ? '.auto' : ''}.srt`;

export const captionName = (media: string, track: LinkCaptionTrack): string => {
  const name = basename(media);
  return `${cutText(name, name.length - extname(name).length)}${captionSuffix(track)}`;
};

/** Save captions only; these paths never go through the library import. */
export async function saveCaptions(input: {
  media: string;
  tracks: (LinkCaptionTrack & { file: string })[];
  failed: LinkCaptionTrack[];
  video: VideoDetails;
  link: string;
  learning: { folder: string; create: boolean };
  freeBytes(folder: string): Promise<number>;
}): Promise<LinkSavedCaptions> {
  const result: LinkSavedCaptions = { files: [], failed: [], learningSkipped: false, learningFolder: null };
  const failed = (track: LinkCaptionTrack) =>
    `${track.language}${track.kind === 'automatic' ? ' (automatic)' : ''}`;
  result.failed.push(...input.failed.map(failed));
  const saved: { file: string; language: string; kind: LinkCaptionTrack['kind'] }[] = [];
  for (const track of input.tracks) {
    const target = join(dirname(input.media), captionName(input.media, track));
    let claimed = false;
    try {
      const source = await stat(track.file);
      if (!source.isFile() || source.size === 0) throw new Error('No caption');
      const handle = await open(target, 'wx');
      claimed = true;
      await handle.close();
      await rename(track.file, target);
      result.files.push(target);
      saved.push({ file: basename(target), language: track.language, kind: track.kind });
    } catch {
      if (claimed) await rm(target, { force: true }).catch(() => undefined);
      result.failed.push(failed(track));
    }
  }
  result.failed = [...new Set(result.failed)];
  if (!saved.length) return result;
  let learning: string | null = null;
  try {
    const base = input.learning.folder;
    if (input.learning.create) await mkdir(base, { recursive: true });
    if (!(await stat(base)).isDirectory()) throw new Error('No captions folder');
    const linkId = new URL(input.link).searchParams.get('v') ?? 'video';
    const id = input.video.id && YOUTUBE_ID.test(input.video.id) ? input.video.id : linkId;
    const manifest = `${JSON.stringify(
      {
        id,
        link: input.link,
        title: input.video.title,
        channel: input.video.channel ?? null,
        uploadDate: input.video.uploadDate ?? null,
        duration: input.video.duration,
        files: saved,
      },
      null,
      2,
    )}\n`;
    const sizes = await Promise.all(result.files.map(async (path) => (await stat(path)).size));
    const bytes = sizes.reduce((sum, size) => sum + size, 0) + Buffer.byteLength(manifest);
    if ((await input.freeBytes(base)) - bytes < LINK_KEEP_FREE_BYTES) throw new Error('Keep space free');
    const mediaName = basename(input.media);
    const stem = cutText(mediaName, mediaName.length - extname(mediaName).length);
    // The already safe media stem and a fixed video id fit within a 255-byte component.
    learning = await claimFolder(base, `${stem} [${id}]`);
    for (const file of saved)
      await copyFile(
        join(dirname(input.media), file.file),
        join(learning, file.file),
        constants.COPYFILE_EXCL,
      );
    await writeFile(join(learning, 'captions.json'), manifest, { flag: 'wx' });
    result.learningFolder = learning;
  } catch {
    if (learning) await rm(learning, { recursive: true, force: true }).catch(() => undefined);
    result.learningSkipped = true;
  }
  return result;
}
