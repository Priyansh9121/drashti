import { nextCaption } from '../../../shared/next-caption';
import { useLibrary } from '../library/library-store';
import { usePlaylists } from '../playlists/playlist-store';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { useFirstGroupLanguages } from '../screens/screens-store';
import { languageView } from '../../../shared/language-view';
import { deckSlideAt } from '../../../shared/deck-show';
import { Music } from '../ui/icons';
import type { UpNext } from '../../../shared/engine/state';
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
 * The picture of what Next will put up (Session 55, Part 4: also small beside Next, the owner's idea O): the next
 * slide with its background, the next picture or video's still, a sound's mark, or a video input live. It fills the
 * box it is in.
 */
export function NextPicture({ next }: { next: UpNext | null }) {
  // As the live preview: a kirtan's slide in the first audience group's languages.
  const shownAs = useFirstGroupLanguages('audience');
  return (
    <>
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
            <Music size={18} />
          </span>
        ) : (
          <MediaStill mediaId={next.mediaId} media={next.media} />
        ))}
      {next?.kind === 'input' && <NextInput name={next.name} />}
    </>
  );
}

/**
 * What Next will put up, in words (shared/next-caption.ts), as a phone says it too (Session 54, D5 review): its
 * presentation's (or row's) name, and a file it misses, before it goes up. Next up's picture beside Next says the same
 * (Session 55), and Simple Mode shows it in a line under Next and Back.
 */
export function useNextCaption(next: UpNext | null): string {
  const name = useLibrary((s) =>
    next?.kind === 'slide' ? s.presentations.find((p) => p.id === next.presentationId)?.name : undefined,
  );
  const itemLabel = usePlaylists((s) =>
    next?.kind === 'slide' && next.itemId ? s.items.find((i) => i.id === next.itemId)?.label : undefined,
  );
  // The video input behind the next slide (Session 51): whether this computer has one of its name (counted as there
  // until the list has been read).
  const behind = useInputNamed(next?.kind === 'slide' ? (next.input ?? null) : null) !== null;
  return nextCaption(next, { label: itemLabel ?? name ?? null, inputHere: behind });
}
