import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { mediaKindLabel } from '../library/MediaList';
import { usePlaylists } from '../playlists/playlist-store';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { useFirstGroupLanguages } from '../screens/screens-store';
import { languageView } from '../../../shared/language-view';
import { deckSlideAt } from '../../../shared/deck-show';
import { Music } from '../ui/icons';
import { InputPicture, useSmallPicture } from '../video-inputs/InputPicture';
import { useInputNamed } from '../video-inputs/video-inputs-store';

/**
 * A video input as it would go up (Session 51): this computer's input of that name, live, filling the preview's
 * picture; nothing where it has none.
 */
function NextInput({ name }: { name: string }) {
  const found = useInputNamed(name);
  // Not read yet (the window has just opened): no picture for a moment.
  const input = found === 'unread' ? null : found;
  const capture = useSmallPicture(input?.device ?? null);
  if (!input) return null;
  return (
    <span className="absolute inset-0" data-testid="next-input">
      <InputPicture capture={capture} className="h-full w-full" />
    </span>
  );
}

/**
 * What Next will put up: the next slide (with its background), or the next picture, video or sound; or a video
 * input (Session 51), as an item or behind the next slide.
 */
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
  // The video input behind the next slide (Session 51): whether this computer has one of its name (counted as there
  // until the list has been read).
  const behind = useInputNamed(next?.kind === 'slide' ? (next.input ?? null) : null) !== null;
  let caption = 'Nothing after this';
  if (next?.kind === 'slide')
    caption = `${itemLabel ?? name ?? 'Presentation'}, slide ${next.slideIndex + 1}${next.itemId ? ' (next item)' : ''}`;
  // A deck's next click on the slide up (Session 54, C2).
  if (next?.kind === 'slide' && (next.step ?? 0) > 0) caption += `, click ${String(next.step)}`;
  if (next?.kind === 'slide' && next.input !== undefined)
    caption += behind
      ? `, over the video input “${next.input}”`
      : `, over the video input “${next.input}”, which is not on this computer: the background stays as it is`;
  // Its background file missing (Session 52), said as a missing input is.
  if (next?.kind === 'slide' && next.fileMissing !== undefined)
    caption += `, over the file “${next.fileMissing}”, which is missing: the background stays as it is`;
  // Its sound file missing (Session 54), said as its background file is.
  if (next?.kind === 'slide' && next.soundMissing !== undefined)
    caption += `, with the sound “${next.soundMissing}”, which is missing: the sound stays as it is`;
  if (next?.kind === 'media') caption = `${mediaKindLabel[next.media]}: ${next.label}`;
  if (next?.kind === 'input') caption = `Video input: ${next.name}`;
  const heading = (
    <h2
      id="next-preview-title"
      className={`text-2xs font-bold tracking-wider text-heading uppercase ${stacked ? 'flex h-6 items-center' : ''}`}
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
            {next.input !== undefined && <NextInput name={next.input} />}
            {next.background && (
              <MediaStill
                mediaId={next.background.mediaId}
                media={next.background.media}
                fit={next.background.fit}
              />
            )}
            <PlacedInParent content={next.slide} mode="fit" className="absolute inset-0">
              {/* A deck's slide (Session 54, C2): as the step Next shows ends. */}
              <SlideView
                slide={languageView(deckSlideAt(next.slide, next.step ?? 0), shownAs?.languages ?? null)}
                media="still"
              />
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
        {next?.kind === 'input' && <NextInput name={next.name} />}
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
