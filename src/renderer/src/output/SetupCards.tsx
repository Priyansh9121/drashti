import { useEffect, useState } from 'react';
import { languageView } from '../../../shared/language-view';
import type { Lang } from '../../../shared/model';
import type { OutputContext } from '../../../shared/screens';
import { sampleKirtanSlide } from '../../../shared/setup';
import { LANG_NAMES } from '../../../shared/themes';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';

/*
 * What the setup wizard puts on the outputs: a display's number while the
 * operator works out which output feeds which screens, and after Finish a
 * test slide on every screen, in that screen's own languages.
 */

/** A display's number and name, across the whole display. */
export function DisplayNumber({ number, label }: { number: string; label: string }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-4 border-[1.5vmin] border-accent bg-black"
      data-testid="display-number"
      data-number={number}
    >
      <div className="text-[30vmin] leading-none font-bold text-white">{number}</div>
      <div className="text-[5vmin] text-muted">{label}</div>
    </div>
  );
}

/**
 * The test slide: the screen's name, what it shows, and a sample kirtan
 * slide in its languages, until the time the main process gave.
 */
export function TestCard({
  context,
  languages,
}: {
  context: OutputContext;
  languages: readonly Lang[] | null;
}) {
  const until = context.testCardUntil;
  // The setup wizard's test card (never the show) is up for its seconds by this computer's clock, as Main
  // set `until` by it.
  // eslint-disable-next-line no-restricted-properties -- the setup wizard's test card, never a frame of the show
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    // eslint-disable-next-line no-restricted-syntax -- the setup wizard's test card, never a frame of the show
    const t = setTimeout(
      () => {
        // eslint-disable-next-line no-restricted-properties -- the setup wizard's test card, never a frame of the show
        setNow(Date.now());
      },
      // eslint-disable-next-line no-restricted-properties -- the setup wizard's test card, never a frame of the show
      Math.max(0, until - Date.now()) + 50,
    );
    return () => {
      clearTimeout(t);
    };
  }, [until]);
  if (until === null || now >= until) return null;
  const canvas = { width: context.canvasWidth, height: context.canvasHeight };
  const slide = languageView(sampleKirtanSlide(canvas.width, canvas.height), languages);
  const shows = context.role === 'stage' ? 'The stage view' : 'The audience picture';
  const langs = languages ? languages.map((l) => LANG_NAMES[l]).join(', ') : 'Every language';
  return (
    <div className="absolute inset-0 z-40 bg-black" data-testid="test-card">
      <PlacedInParent content={canvas} mode={context.scaling} className="absolute inset-0">
        <SlideView slide={slide} />
      </PlacedInParent>
      <div className="absolute inset-x-0 top-0 space-y-1 bg-black/60 px-[4vmin] py-[3vmin] text-white">
        <div className="text-[6vmin] leading-tight font-bold" data-testid="test-card-name">
          {context.screenName}
        </div>
        <div className="text-[3.2vmin] text-muted" data-testid="test-card-shows">
          {context.groupName} · {shows} · {langs}
        </div>
      </div>
    </div>
  );
}
