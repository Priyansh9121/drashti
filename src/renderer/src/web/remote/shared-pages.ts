import type { PresentationDoc } from '../../../../shared/library';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { api } from '../device';
import { picturePage, slidePages, soundPage, videoPage } from '../viewer/pages';
import { openViewer, type ViewerPage } from '../viewer/viewer-store';
import { lookingAt, usePhoneFiles } from './phone-files-store';
import { type PageMakers, sharedPages, slidesToRead } from './shared-files';

/*
 * A shared playlist's file opened on this device (Session 54, D3) in D1's viewer (web/viewer/), the playlist's
 * other files before and after it: pictures sharp up to the original, videos at their own quality through D1's
 * signed link, sounds played here, a presentation's slides one by one, each zoomed with two fingers. Read-only:
 * nothing here changes the playlist. Its presentations are read first, one after another (each a request a phone
 * makes, counted by Drashti), while the list says "Opening…".
 */

/** D1's pages; a slide named with its presentation, as one file's slides run into the next file's. */
const VIEWER_PAGES: PageMakers<ViewerPage> = {
  picture: picturePage,
  video: videoPage,
  sound: soundPage,
  // A deck's slide a page for each click (D1/D2 review), each named with its presentation.
  slide: (presentationId, name, slide) =>
    slidePages(presentationId, slide).map((page) => ({ ...page, title: `${name} · ${page.title}` })),
};

/** A presentation (or a Shastra passage) for its slides; null when Drashti could not give it. */
async function readSlides(id: string): Promise<PresentationDoc | null> {
  const r = await api<{ presentation: PresentationDoc }>(`/api/v1/presentations/${encodeURIComponent(id)}`);
  return r.ok ? r.presentation : null;
}

/** Look at a shared playlist's files from the one tapped (`index` among `files`), full screen on this device. */
export async function lookAtShared(
  playlist: { id: string; name: string },
  files: PlaylistItemInfo[],
  index: number,
): Promise<void> {
  const tapped = files[index];
  if (!tapped) return;
  usePhoneFiles.setState({ opening: tapped.id, notOpened: null });
  const docs = new Map<string, PresentationDoc | null>();
  for (const id of slidesToRead(files)) docs.set(id, await readSlides(id));
  // Another file tapped meanwhile, or the playlist left: this one is let go.
  if (usePhoneFiles.getState().opening !== tapped.id) return;
  const made = sharedPages(files, index, (id) => docs.get(id) ?? null, VIEWER_PAGES);
  usePhoneFiles.setState({ opening: null, notOpened: made ? null : tapped.label });
  if (!made) return;
  openViewer(made.pages, made.start, playlist.name);
  lookingAt(playlist.id, made.pages);
}
