/*
 * Whether a file is whole (Q60-31 (m2), the owner's own bug: a video still being copied into a folder Drashti follows,
 * its copy stalling longer than the folder's wait, was taken half-written and its row went black).
 */

/** whole: its own structure says it is all there; cut: it says it is longer than its bytes; unknown: it cannot tell. */
export type Wholeness = 'whole' | 'cut' | 'unknown';

/** Whether the file at `path` is whole, by its own structure. */
export function wholeFile(_path: string): Promise<Wholeness> {
  return Promise.resolve('unknown');
}
