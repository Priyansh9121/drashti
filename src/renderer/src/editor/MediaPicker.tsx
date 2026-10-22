import { useEffect, useMemo, useState } from 'react';
import { mediaUrl } from '../../../shared/media';
import type { MediaSummary } from '../../../shared/playlists';
import type { VideoInput } from '../../../shared/video-inputs';
import { loadMedia, useMedia } from '../library/library-store';
import { MediaStill } from '../render/MediaStill';
import { MissingBadge, UnplayableBadge } from '../ui/Badge';
import { Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Field';
import { Image, Music } from '../ui/icons';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { InputPicture, useSmallPicture } from '../video-inputs/InputPicture';
import { NO_INPUTS, useVideoInputs } from '../video-inputs/video-inputs-store';

/*
 * Choosing a picture or video from the library to put on the slide (or
 * behind it), or a sound for it. Media is imported into the library first,
 * by dragging it onto the library. Behind the slide, one of this computer's video inputs too (Session 51), by
 * its name: on another computer, that computer's input of the same name goes up.
 */

const KIND = { image: 'Picture', video: 'Video', audio: 'Sound' } as const;

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

/** One of this computer's video inputs to choose (Session 51), with its small live picture. */
function InputChoice({ input, onChoose }: { input: VideoInput; onChoose: (name: string) => void }) {
  const capture = useSmallPicture(input.device);
  return (
    <li>
      <button
        type="button"
        data-testid="input-choice"
        aria-label={`Video input: ${input.name}`}
        onClick={() => {
          onChoose(input.name);
        }}
        className="w-full overflow-hidden rounded-lg border-2 border-line bg-black text-left hover:border-field"
      >
        <InputPicture capture={capture} className="pointer-events-none w-full" />
        <span className="flex h-7 items-center gap-2 bg-panel-2 px-2 text-xs text-muted">
          <Truncate text={input.name} className="min-w-0 flex-1" />
        </span>
      </button>
    </li>
  );
}

export function MediaPicker({
  title,
  onChoose,
  onChooseInput,
  onClose,
  sounds = false,
}: {
  title: string;
  onChoose: (media: MediaSummary) => void;
  /** Offer this computer's video inputs too (Session 51: a slide's background), each chosen by its name. */
  onChooseInput?: (name: string) => void;
  onClose: () => void;
  /** Offer sounds (and videos, for their sound) instead of pictures and videos. */
  sounds?: boolean;
}) {
  const inputs = useVideoInputs((s) => s.inputs) ?? NO_INPUTS;
  const media = useMedia((s) => s.media);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void loadMedia();
  }, []);
  const shown = useMemo(
    () =>
      media.filter(
        (m) =>
          (sounds ? m.kind === 'audio' || m.kind === 'video' : m.kind === 'image' || m.kind === 'video') &&
          m.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [media, query, sounds],
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
        aria-label={sounds ? 'Find a sound by name' : 'Find a picture or video by name'}
        placeholder="Find by name"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      {onChooseInput && !sounds && inputs.length > 0 && (
        <section aria-label="Video inputs on this computer" className="max-h-48 shrink-0 overflow-y-auto">
          <h3 className="pb-1 text-xs font-bold text-muted">Video inputs on this computer</h3>
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3"
            data-testid="picker-inputs"
          >
            {inputs.map((input) => (
              <InputChoice key={input.id} input={input} onChoose={onChooseInput} />
            ))}
          </ul>
        </section>
      )}
      {shown.length === 0 ? (
        <EmptyState icon={sounds ? Music : Image} title={sounds ? 'No sounds' : 'No pictures or videos'}>
          Drag {sounds ? 'sound files' : 'pictures and videos'} onto the library to import them, then choose
          one here.
        </EmptyState>
      ) : (
        <ul
          className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 overflow-y-auto"
          aria-label={sounds ? 'Sounds' : 'Pictures and videos'}
        >
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                data-testid="media-choice"
                aria-label={`${KIND[m.kind]}: ${m.name}${m.missing ? ' (missing)' : ''}`}
                disabled={m.missing}
                onClick={() => {
                  onChoose(m);
                }}
                className="w-full overflow-hidden rounded-lg border-2 border-line bg-black text-left hover:border-field disabled:opacity-50"
              >
                <span
                  className="pointer-events-none relative flex aspect-video w-full items-center justify-center"
                  data-a11y-picture
                >
                  {m.kind === 'audio' ? (
                    <Music size={36} aria-hidden="true" className="text-muted" />
                  ) : (
                    !m.missing && <MediaStill mediaId={m.id} media={m.kind} />
                  )}
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
