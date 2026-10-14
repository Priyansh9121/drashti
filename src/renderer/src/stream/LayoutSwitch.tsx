import type { StreamLayout } from '../../../shared/stream';
import { cx } from '../ui/cx';
import { Camera, Presentation } from '../ui/icons';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { streamAction } from './stream-store';

/*
 * What the stream shows: the camera with the words, or the slides as the hall
 * has them. One setting, in the Stream panel and on YouTube's card in
 * Screens (Session 26), switchable at any time, also on air.
 */

const LAYOUTS: { id: StreamLayout; label: string; hint: string; icon: typeof Camera }[] = [
  {
    id: 'camera',
    label: 'Camera and words',
    hint: 'The camera, with the slide’s words along the bottom',
    icon: Camera,
  },
  { id: 'slides', label: 'Slides', hint: 'The slides as the hall sees them', icon: Presentation },
];

/** Camera or Slides: switchable at any time, also on air. */
export function LayoutSwitch({
  layout,
  testId = 'stream-layout',
  onChoose = (id) => void streamAction(() => window.drashti.stream.setLayout(id)),
}: {
  layout: StreamLayout;
  /** Each choice's test id is this, then its layout. */
  testId?: string;
  /** What choosing one does: set it at once (the setup wizard keeps it for Finish). */
  onChoose?: (layout: StreamLayout) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="What the stream shows"
      className="grid grid-cols-2 gap-2"
      onKeyDown={radioKeys(
        LAYOUTS.map((l) => l.id),
        layout,
        onChoose,
      )}
    >
      {LAYOUTS.map((l, i) => {
        const on = l.id === layout;
        const Icon = l.icon;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTabIndex(
              on,
              i,
              LAYOUTS.some((x) => x.id === layout),
            )}
            data-testid={`${testId}-${l.id}`}
            onClick={() => {
              onChoose(l.id);
            }}
            className={cx(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-left',
              on ? 'border-accent bg-panel-3' : 'border-field bg-panel-2 hover:border-muted',
            )}
          >
            <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{l.label}</span>
              <span className="block text-xs text-muted">{l.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What the stream shows in a layout, within Session 9's rules (shared/program.ts). */
export const LAYOUT_SHOWS: Record<StreamLayout, string> = {
  camera:
    'The camera, with the slide’s words as a lower third along the bottom (six lines at most). Black-out and the logo are for the hall: the camera stays and the words go. Messages run along the top; masks are left out; the stage message never shows.',
  slides:
    'What the hall sees, as the hall sees it, in the stream’s languages: black-out goes black, as in the hall. The stage message never shows.',
};
