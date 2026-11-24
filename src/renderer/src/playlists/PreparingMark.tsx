import { useEffect } from 'react';
import { create } from 'zustand';
import type { RenderSlide } from '../../../shared/model';
import { trimStatusWords, type TrimStatuses } from '../../../shared/trim';
import { Badge } from '../ui/Badge';
import { Loader } from '../ui/icons';
import { useDocs } from './docs-store';

/*
 * A deck's slides still being prepared (Session 56): imported, a deck's slides show as their pictures at once, and the
 * clips of those with animations are made meanwhile. Each such slide's row says "Preparing", and so does the row of
 * its presentation in a playlist, until its clips are in; Next waits for such a slide, saying so (the engine).
 */

const SLIDE_TITLE = 'Its animations are being made: it shows its picture for now, and Next waits for it.';

/** On a slide's row: its animations are still being made. */
export function PreparingMark({ slide }: { slide: RenderSlide }) {
  if (!slide.deck?.preparing) return null;
  return (
    <Badge tone="info" icon={Loader} data-testid="slide-preparing" title={SLIDE_TITLE}>
      Preparing
    </Badge>
  );
}

/** What a slide's row says of it to a screen reader, after its name, while its animations are being made. */
export const preparingWords = (slide: RenderSlide): string =>
  slide.deck?.preparing ? ', its animations still being prepared' : '';

/** On a presentation's row: how many of its slides are still being prepared, while any is. */
export function PresentationPreparing({ presentationId }: { presentationId: string }) {
  const count = useDocs((s) =>
    (s.docs[presentationId]?.groups ?? []).reduce(
      (n, g) => n + g.slides.filter((x) => x.slide.deck?.preparing).length,
      0,
    ),
  );
  if (count === 0) return null;
  return (
    <Badge
      tone="info"
      icon={Loader}
      data-testid="item-preparing"
      title={`${count === 1 ? 'A slide' : `${String(count)} slides`} of it still being prepared: ${count === 1 ? 'its animations are' : 'their animations are'} being made, and Next waits for ${count === 1 ? 'it' : 'each'}.`}
    >
      Preparing
    </Badge>
  );
}

const useTrimJobs = create<{ pending: ReadonlySet<string>; statuses: TrimStatuses }>(() => ({
  pending: new Set(),
  statuses: {},
}));
let connected = false;

function connectTrimJobs(): void {
  if (connected) return;
  connected = true;
  let received = false;
  window.drashti.media.onPreparingTrims((ids) => {
    received = true;
    useTrimJobs.setState({ pending: new Set(ids) });
  });
  void window.drashti.media.preparingTrims().then((ids) => {
    if (!received) useTrimJobs.setState({ pending: new Set(ids) });
  });
  // How each cut stands (alpha.22): why it waits, or how far it is.
  let told = false;
  window.drashti.media.onTrimStatuses((statuses) => {
    told = true;
    useTrimJobs.setState({ statuses });
  });
  void window.drashti.media.trimStatuses().then((statuses) => {
    if (!told) useTrimJobs.setState({ statuses });
  });
}

export function useTrimPreparing(itemId: string | undefined): boolean {
  useEffect(() => {
    if (itemId !== undefined) connectTrimJobs();
  }, [itemId]);
  return useTrimJobs((s) => itemId !== undefined && s.pending.has(itemId));
}

/**
 * On a playlist video's row while its trimmed video is made: Preparing, and under it how it stands (alpha.22, the
 * owner's "Trim on a row": it said nothing of why it waited), as "Waiting: a video is playing" or "Saving the trimmed
 * video: 40%".
 */
export function TrimPreparing({ itemId }: { itemId: string }) {
  const preparing = useTrimPreparing(itemId);
  const words = useTrimJobs((s) => trimStatusWords(s.statuses[itemId]));
  if (!preparing) return null;
  return (
    <>
      <Badge
        tone="info"
        icon={Loader}
        data-testid="trim-preparing"
        title="The trimmed video waits while a video or a sound plays, or the stream is on air or recording. The current video plays until it is ready."
      >
        Preparing
      </Badge>
      {words !== null && (
        <span
          className="block truncate text-xs text-muted"
          data-testid="trim-status"
          role="status"
          title={words}
        >
          {words}
        </span>
      )}
    </>
  );
}
