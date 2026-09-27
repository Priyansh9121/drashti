import { LANGS } from '../../../shared/model';
import { useEngine } from '../engine/engine-store';
import { selectPresentation, useLibrary } from '../library/library-store';

const trackLabel = { en: 'EN', gu: 'GU', hi: 'HI', translit: 'TR' } as const;

export function PresentationList() {
  const presentations = useLibrary((s) => s.presentations);
  const selectedId = useLibrary((s) => s.selectedId);
  const liveId = useEngine((s) => s.state?.live.presentationId ?? null);
  return (
    <nav aria-label="Presentations" className="flex min-h-0 flex-col border-r border-line bg-panel">
      <h2 className="px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Presentations
      </h2>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3" data-testid="presentation-list">
        {presentations.map((p) => {
          const selected = p.id === selectedId;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => void selectPresentation(p.id)}
                className={`w-full rounded-md px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-accent ${
                  selected ? 'bg-panel-2 ring-1 ring-accent' : 'hover:bg-panel-2'
                }`}
              >
                <span className="flex items-center gap-2">
                  {p.id === liveId && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-live" aria-label="Live" />
                  )}
                  <span className="truncate text-sm font-medium">{p.name}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  {p.slideCount} {p.slideCount === 1 ? 'slide' : 'slides'}
                  {p.kirtanTracks &&
                    LANGS.filter((l) => p.kirtanTracks?.includes(l)).map((l) => (
                      <span key={l} className="rounded border border-line px-1 text-[10px]">
                        {trackLabel[l]}
                      </span>
                    ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
