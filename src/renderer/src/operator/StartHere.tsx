import type { ReactNode } from 'react';
import { importWithDialog } from '../library/import-store';
import { openLinkDialog } from '../links/link-store';
import { createNode } from '../playlists/playlist-store';
import { openSetup } from '../setup/setup-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { FileText, FolderOpen, Import, Link2, ListPlus, Monitor } from '../ui/icons';
import { UnlitLamp } from '../ui/Mark';
import { MenuButton } from '../ui/Menu';
import { useArrival } from '../ui/motion';
import { CentredPlace } from '../ui/States';
import { ShowOnButton, useDisplayOffer } from '../screens/ShowOn';

/*
 * The middle of the window with nothing chosen (Session 26g, "Skip for now" on the first start
 * leads here): the unlit lamp, and three steps to a sabha. Step 1's Import… is the one primary;
 * the steps arrive one after another as the place does (a one-off arrival), then nothing moves.
 * Centred while it fits, and from its top, scrolling, when it does not (Session 51: in a 1024 × 645
 * window step 3 had run under the status bar, its Show on out of reach).
 */
export function StartHere() {
  const arriving = useArrival('empty');
  const offered = useDisplayOffer();
  return (
    <CentredPlace data-testid="start-here">
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center text-muted">
        <div data-motion={arriving} style={{ ['--i' as string]: 0 }}>
          <UnlitLamp size={72} wisp={arriving !== undefined} />
        </div>
        <h2 data-motion={arriving} style={{ ['--i' as string]: 1 }} className="text-lg font-bold text-fg">
          Nothing chosen yet
        </h2>
        <p data-motion={arriving} style={{ ['--i' as string]: 2 }} className="max-w-sm text-sm">
          Pick a presentation in the library, or an item in a playlist, to see its slides here. New to
          Drashti? Start here: three steps, and it is ready for a sabha.
        </p>
        <ol className="mt-3 w-[min(26rem,100%)] space-y-2 text-left" aria-label="Three steps to a sabha">
          <Step
            n={1}
            now
            arriving={arriving}
            title="Bring in what you show"
            text="Presentations, kirtans, pictures and videos"
          >
            <MenuButton
              label="Import"
              icon={Import}
              variant="primary"
              size="sm"
              entries={[
                { label: 'Files…', icon: FileText, onSelect: () => void importWithDialog('files') },
                { label: 'A Folder…', icon: FolderOpen, onSelect: () => void importWithDialog('folder') },
                { label: 'From a Link…', icon: Link2, onSelect: openLinkDialog },
              ]}
            >
              Import…
            </MenuButton>
          </Step>
          <Step
            n={2}
            arriving={arriving}
            title="Make this week’s playlist"
            text="The running order for the sabha"
          >
            <Button size="sm" icon={ListPlus} onClick={() => void createNode(false)}>
              New playlist
            </Button>
          </Step>
          <Step
            n={3}
            arriving={arriving}
            title="The screens"
            text="Which screen is the hall’s, and which the stage’s"
          >
            {/* A display connected and no hall screen yet (Session 44): one click shows on it. A secondary:
                step 1's Import… is the one primary here (the offer under the header has its own). */}
            {offered && <ShowOnButton display={offered} size="sm" variant="secondary" />}
            <Button size="sm" icon={Monitor} onClick={() => void openSetup(1)}>
              Set Up Screens…
            </Button>
          </Step>
        </ol>
      </div>
    </CentredPlace>
  );
}

function Step({
  n,
  now = false,
  arriving,
  title,
  text,
  children,
}: {
  n: number;
  now?: boolean;
  /** How the steps arrive with their place (one after another), or not at all. */
  arriving: 'empty' | undefined;
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <li
      data-motion={arriving}
      style={{ ['--i' as string]: n + 2 }}
      data-testid="start-step"
      className={cx(
        'flex items-center gap-3 rounded-lg border bg-panel px-3 py-2.5 text-fg',
        now ? 'border-primary-edge shadow-primary [--glow-spread:-12px]' : 'border-line',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm font-bold',
          now ? 'border-primary-hi bg-primary text-on-primary' : 'border-field text-muted',
        )}
      >
        {n}
      </span>
      {/* Its buttons beside its words, or under them where there is no room for both (Session 51: step 3's
          Show on and Set Up Screens… ran out of the card in a 1024-wide window). */}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-32 flex-1">
          <span className="block font-medium">{title}</span>
          <span className="block text-xs text-muted">{text}</span>
        </span>
        <span className="flex flex-wrap gap-2">{children}</span>
      </span>
    </li>
  );
}
