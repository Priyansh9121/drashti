import { useEffect, useMemo, useState } from 'react';
import { mediaUrl } from '../../../shared/media';
import type { MediaSummary } from '../../../shared/playlists';
import { loadMedia, useMedia } from '../library/library-store';
import { MediaStill } from '../render/MediaStill';
import { MissingBadge, UnplayableBadge } from '../ui/Badge';
import { Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Field';
import { Image } from '../ui/icons';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';

/*
 * Choosing a picture or video from the library to put on the slide (or
 * behind it). Pictures and videos are imported into the library first, by
 * dragging them onto it.
 */

/** A picture's or video's own size, for its proportions on the slide (null if it cannot be read). */
export async function naturalSize(media: {
  id: string;
  kind: 'image' | 'video';
}): Promise<{ width: number; height: number } | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  if (media.kind === 'image') {
    const img = new window.Image();
    img.src = mediaUrl(media.id);
    const size = img.decode().then(
      () => ({ width: img.naturalWidth, height: img.naturalHeight }),
      () => null,
    );
    return Promise.race([size, timeout]);
  }
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  const size = new Promise<{ width: number; height: number } | null>((resolve) => {
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => resolve(null);
  });
  video.src = mediaUrl(media.id);
  const found = await Promise.race([size, timeout]);
  video.removeAttribute('src');
  video.load();
  return found;
}

export function MediaPicker({
  title,
  onChoose,
  onClose,
}: {
  title: string;
  onChoose: (media: MediaSummary & { kind: 'image' | 'video' }) => void;
  onClose: () => void;
}) {
  const media = useMedia((s) => s.media);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void loadMedia();
  }, []);
  const shown = useMemo(
    () =>
      media.filter(
        (m): m is MediaSummary & { kind: 'image' | 'video' } =>
          (m.kind === 'image' || m.kind === 'video') &&
          m.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [media, query],
  );
  return (
    <Dialog
      title={title}
      size="lg"
      onClose={onClose}
      testId="media-picker"
      bodyClassName="flex min-h-0 flex-col gap-3"
    >
      <TextInput
        aria-label="Find a picture or video by name"
        placeholder="Find by name"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      {shown.length === 0 ? (
        <EmptyState icon={Image} title="No pictures or videos">
          Drag pictures and videos onto the library to import them, then choose one here.
        </EmptyState>
      ) : (
        <ul
          className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 overflow-y-auto"
          aria-label="Pictures and videos"
        >
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                data-testid="media-choice"
                aria-label={`${m.kind === 'video' ? 'Video' : 'Picture'}: ${m.name}${m.missing ? ' (missing)' : ''}`}
                disabled={m.missing}
                onClick={() => {
                  onChoose(m);
                }}
                className="w-full overflow-hidden rounded-lg border-2 border-line bg-black text-left hover:border-field disabled:opacity-50"
              >
                <span className="pointer-events-none relative block aspect-video w-full" data-a11y-picture>
                  {!m.missing && <MediaStill mediaId={m.id} media={m.kind} />}
                </span>
                <span className="flex h-7 items-center gap-2 bg-panel-2 px-2 text-xs text-muted">
                  <Truncate text={m.name} className="min-w-0 flex-1" />
                  {m.missing ? <MissingBadge /> : m.unplayable && <UnplayableBadge />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
