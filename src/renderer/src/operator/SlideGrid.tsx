import { memo, useEffect, useRef } from 'react';
import type { SlideInfo } from '../../../shared/library';
import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { goLive } from './actions';

const Thumb = memo(function Thumb({
  presentationId,
  info,
  live,
}: {
  presentationId: string;
  info: SlideInfo;
  live: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (live) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [live]);
  return (
    <li>
      <button
        ref={ref}
        type="button"
        data-testid="slide-thumb"
        data-index={info.index}
        aria-current={live ? 'true' : undefined}
        aria-label={`Slide ${info.index + 1}${info.label ? `: ${info.label}` : ''}${live ? ' (live)' : ''}`}
        onClick={() => void goLive(presentationId, info.index)}
        className={`group w-full overflow-hidden rounded-md border-2 bg-black text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          live ? 'border-live' : 'border-line hover:border-muted'
        }`}
      >
        <PlacedInParent
          content={info.slide}
          mode="fit"
          className="pointer-events-none relative aspect-video w-full"
        >
          <SlideView slide={info.slide} />
        </PlacedInParent>
        <span
          className={`flex items-center gap-2 px-2 py-1 text-xs ${live ? 'bg-live text-white' : 'bg-panel-2 text-muted'}`}
        >
          <span className="font-semibold">{info.index + 1}</span>
          <span className="truncate">{info.label}</span>
          {live && <span className="ml-auto font-bold tracking-wide">LIVE</span>}
        </span>
      </button>
    </li>
  );
});

export function SlideGrid() {
  const doc = useLibrary((s) => s.doc);
  const live = useEngine((s) => s.state?.live);
  const slideShown = useEngine((s) => s.state?.layers.slide !== null);
  if (!doc) return <div className="flex items-center justify-center text-muted">Choose a presentation</div>;
  const liveIndex = live?.presentationId === doc.id && slideShown ? live.slideIndex : null;
  return (
    <section
      aria-label={`Slides of ${doc.name}`}
      className="min-h-0 overflow-y-auto p-4"
      data-testid="slide-grid"
    >
      <h2 className="mb-3 text-lg font-semibold">{doc.name}</h2>
      {doc.groups.map((g) => (
        <div key={g.id} className="mb-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: g.color ?? '#4b5563' }}
              aria-hidden="true"
            />
            {g.name}
          </h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {g.slides.map((s) => (
              <Thumb key={s.id} presentationId={doc.id} info={s} live={s.index === liveIndex} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
