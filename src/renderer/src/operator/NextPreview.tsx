import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { mediaKindLabel } from '../library/MediaList';
import { usePlaylists } from '../playlists/playlist-store';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { useFirstGroupLanguages } from '../screens/screens-store';
import { languageView } from '../../../shared/language-view';
import { Music } from '../ui/icons';

/** What Next will put up: the next slide (with its background), or the next picture, video or sound. */
export function NextPreview({ stacked = false }: { stacked?: boolean }) {
  const next = useEngine((s) => s.state?.next ?? null);
  // As the live preview: a kirtan's slide in the first audience group's languages.
  const shownAs = useFirstGroupLanguages('audience');
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
  const heading = (
    <h2
      id="next-preview-title"
      className={`text-2xs font-bold tracking-wider text-muted uppercase ${stacked ? 'flex h-6 items-center' : ''}`}
    >
      Next
    </h2>
  );
  return (
    <section
      aria-labelledby="next-preview-title"
      className={stacked ? 'space-y-2 px-3 pt-3' : 'flex items-start gap-3 px-3 pt-3'}
      data-testid="next-preview"
      data-kind={next?.kind ?? 'none'}
    >
      {stacked && heading}
      <div
        className={`relative aspect-video shrink-0 overflow-hidden rounded-md border border-line-strong bg-black ${stacked ? 'w-full' : 'w-[45%]'}`}
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
              <SlideView slide={languageView(next.slide, shownAs?.languages ?? null)} media="still" />
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
        {!stacked && heading}
        <p className="mt-1 break-words text-sm text-fg" data-testid="next-caption">
          {caption}
        </p>
      </div>
    </section>
  );
}
