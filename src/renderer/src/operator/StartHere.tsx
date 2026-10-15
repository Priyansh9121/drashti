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

/*
 * The middle of the window with nothing chosen (Session 26g, "Skip for now" on the first start
 * leads here): the unlit lamp, and three steps to a sabha. Step 1's Import… is the one primary;
 * the steps arrive one after another as the place does (a one-off arrival), then nothing moves.
 */
export function StartHere() {
  const arriving = useArrival('empty');
  return (
    <div
      className="lamp-empty flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center text-muted"
      data-testid="start-here"
    >
      <div data-motion={arriving} style={{ ['--i' as string]: 0 }}>
        <UnlitLamp size={72} wisp={arriving !== undefined} />
      </div>
      <h2 data-motion={arriving} style={{ ['--i' as string]: 1 }} className="text-lg font-bold text-fg">
        Nothing chosen yet
      </h2>
      <p data-motion={arriving} style={{ ['--i' as string]: 2 }} className="max-w-sm text-sm">
        Pick a presentation in the library, or an item in a playlist, to see its slides here. New to Drashti?
        Start here: three steps, and it is ready for a sabha.
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
          title="Set up the screens"
          text="Which screen is the hall’s, and which the stage’s"
        >
          <Button size="sm" icon={Monitor} onClick={() => void openSetup(1)}>
            Set up…
          </Button>
        </Step>
      </ol>
    </div>
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
        now ? 'border-primary-edge shadow-ember [--ember-spread:-12px]' : 'border-line',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm font-bold',
          now ? 'border-primary-hi bg-primary text-white' : 'border-field text-muted',
        )}
      >
        {n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
      {children}
    </li>
  );
}
