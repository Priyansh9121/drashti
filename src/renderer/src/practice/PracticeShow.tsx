import { useMemo } from 'react';
import { shortcutText } from '../../../shared/keymap';
import { practiceLabels, practiceSlides } from '../../../shared/practice';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { LogOut } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { openWelcome } from '../setup/Welcome';
import { Columns } from '../operator/Layout';
import { LivePreview } from '../operator/LivePreview';
import { runPractice, stopPractice, usePractice } from './practice-store';

/*
 * The practice show's window (Session 26g): a banner saying nothing is on the screens, the keys to
 * try, the placeholder slides in the middle and LIVE on the right, with the show controls along the
 * bottom as in a show. Nothing here reaches the main process (practice-store.ts).
 */

export function PracticeShow({ platform }: { platform: string }) {
  return (
    <>
      <div
        role="status"
        data-testid="practice-banner"
        className="flex shrink-0 items-center gap-3 border-b border-line border-l-4 border-l-accent bg-panel-2 px-4 py-2 text-sm"
      >
        <p className="min-w-0 flex-1">
          <b>Practice show.</b> Placeholder slides on this screen only: nothing is on the screens, and nothing
          is saved.
        </p>
        <Button
          size="sm"
          icon={LogOut}
          data-testid="practice-leave"
          onClick={() => {
            stopPractice();
            openWelcome();
          }}
        >
          Leave the practice show
        </Button>
      </div>
      <Columns
        left={<TryTheKeys platform={platform} />}
        middle={<PracticeSlides />}
        right={
          <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3" aria-label="Live">
            <LivePreview />
          </aside>
        }
      />
    </>
  );
}

/** The keys a show runs on, to try here. */
function TryTheKeys({ platform }: { platform: string }) {
  const keys: { what: string; key: string }[] = [
    { what: 'Next slide', key: shortcutText('next', platform) },
    { what: 'Back a slide', key: shortcutText('previous', platform) },
    { what: 'Black-out', key: shortcutText('toggleBlackout', platform) },
    { what: 'The logo', key: shortcutText('toggleLogo', platform) },
    { what: 'Clear all', key: shortcutText('clearAll', platform) },
  ];
  return (
    <section aria-labelledby="practice-keys" className="space-y-3 p-4 text-sm">
      <h2 id="practice-keys" className="text-2xs font-bold tracking-wider text-muted uppercase">
        Try the keys
      </h2>
      <p className="text-muted">They work here as in a show. Press a slide to put it up.</p>
      <ul className="space-y-2" data-testid="practice-keys">
        {keys.map((k) => (
          <li key={k.what} className="flex items-center justify-between gap-2 border-b border-line pb-2">
            <span>{k.what}</span>
            <Kbd>{k.key}</Kbd>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The placeholder slides, as the slide grid shows a presentation's. */
function PracticeSlides() {
  const slides = useMemo(() => practiceSlides(), []);
  const labels = useMemo(() => practiceLabels(), []);
  const live = usePractice((s) => s.practice.index);
  return (
    <section aria-labelledby="practice-slides" className="flex min-h-0 flex-1 flex-col">
      <h2 id="practice-slides" className="border-b border-line px-4 py-3 text-lg font-bold">
        Practice slides
      </h2>
      <ol
        className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] content-start gap-3 overflow-y-auto p-4"
        data-testid="practice-slides"
      >
        {slides.map((slide, i) => {
          const on = live === i;
          return (
            <li key={slide.id}>
              <button
                type="button"
                data-testid="practice-thumb"
                data-show-control
                aria-current={on ? 'true' : undefined}
                aria-label={`Practice slide ${String(i + 1)}, ${labels[i] ?? ''}${on ? ' (live)' : ''}`}
                onClick={() => {
                  runPractice({ goTo: i });
                }}
                className={cx(
                  'w-full overflow-hidden rounded-lg border-2 bg-black text-left',
                  on ? 'border-live shadow-live-thumb' : 'border-line shadow-card hover:border-field',
                )}
              >
                <span className="pointer-events-none relative block aspect-video w-full" data-a11y-picture>
                  <PlacedInParent content={slide} mode="fit" className="absolute inset-0">
                    <SlideView slide={slide} media="still" />
                  </PlacedInParent>
                </span>
                <span
                  className={cx(
                    'flex h-7 items-center gap-2 px-2 text-xs',
                    on ? 'bg-live text-white' : 'bg-panel-2 text-muted',
                  )}
                >
                  <span className="font-bold tabular-nums">{i + 1}</span>
                  <span className="flex-1 truncate font-bold">{labels[i]}</span>
                  {on && <span className="font-bold tracking-wider">LIVE</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
