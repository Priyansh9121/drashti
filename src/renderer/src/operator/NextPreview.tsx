import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { mediaKindLabel } from '../library/MediaList';
import { usePlaylists } from '../playlists/playlist-store';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Music } from '../ui/icons';

/** What Next will put up: the next slide (with its background), or the next picture, video or sound. */
export function NextPreview() {
  const next = useEngine((s) => s.state?.next ?? null);
  const name = useLibrary((s) =>
    next?.kind === 'slide' ? s.presentations.find((p) => p.id === next.presentationId)?.name : undefined,
  );
  const itemLabel = usePlaylists((s) =>
    next?.kind === 'slide' && next.itemId ? s.items.find((i) => i.id === next.itemId)?.label : undefined,
  );
  let caption = 'Nothing after this';
  if (next?.kind === 'slide')
    caption = `${itemLabel ?? name ?? 'Presentation'}, slide ${next.slideIndex + 1}${next.itemId ? ' (next item)' : ''}`;
  if (next?.kind === 'media') caption = `${mediaKindLabel[next.media]}: ${next.label}`;
  return (
    <section
      aria-labelledby="next-preview-title"
      className="flex items-start gap-3 px-3 pt-3"
      data-testid="next-preview"
      data-kind={next?.kind ?? 'none'}
    >
      <div
        className="relative aspect-video w-[45%] shrink-0 overflow-hidden rounded-md border border-line-strong bg-black"
        data-a11y-picture
        aria-hidden="true"
      >
        {next?.kind === 'slide' && (
          <>
            {next.background && (
              <MediaStill
                mediaId={next.background.mediaId}
                media={next.background.media}
                fit={next.background.fit}
              />
            )}
            <PlacedInParent content={next.slide} mode="fit" className="absolute inset-0">
              <SlideView slide={next.slide} media="still" />
            </PlacedInParent>
          </>
        )}
        {next?.kind === 'media' &&
          (next.media === 'audio' ? (
            <span className="absolute inset-0 flex items-center justify-center text-muted">
              <Music size={28} />
            </span>
          ) : (
            <MediaStill mediaId={next.mediaId} media={next.media} />
          ))}
      </div>
      <div className="min-w-0 pt-0.5 text-xs">
        <h2 id="next-preview-title" className="text-2xs font-bold tracking-wider text-muted uppercase">
          Next
        </h2>
        <p className="mt-1 break-words text-sm text-fg" data-testid="next-caption">
          {caption}
        </p>
      </div>
    </section>
  );
}
