// What a fetch script unpacked into vendor/, as one SHA-256 (Session 30's optional extra): every file's path,
// size and bytes, every folder, and every link's target (yt-dlp's Mac build holds framework links), in order;
// the folder's own SOURCE.txt left out. A program reused from an earlier run is reused only while this still
// matches what its SOURCE.txt recorded when it was unpacked: one changed since is unpacked again.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

export function treeDigest(dir) {
  const h = createHash('sha256');
  const walk = (rel) => {
    for (const name of readdirSync(rel === '' ? dir : join(dir, rel)).sort()) {
      const r = rel === '' ? name : `${rel}/${name}`;
      if (r === 'SOURCE.txt') continue;
      const p = join(dir, r);
      const s = lstatSync(p);
      if (s.isSymbolicLink()) h.update(`link ${r} ${readlinkSync(p)}\n`);
      else if (s.isDirectory()) {
        h.update(`dir ${r}\n`);
        walk(r);
      } else if (s.isFile()) {
        h.update(`file ${r} ${String(s.size)}\n`);
        h.update(readFileSync(p));
      }
    }
  };
  walk('');
  return h.digest('hex');
}

/** The SOURCE.txt line that records it. */
export const digestLine = (dir) => `sha256 of what was unpacked ${treeDigest(dir)}`;

/** Whether a SOURCE.txt still matches its folder and names this download. */
export function stillAsUnpacked(stampText, dir, downloadSha256) {
  return stampText.includes(downloadSha256) && stampText.includes(digestLine(dir));
}
